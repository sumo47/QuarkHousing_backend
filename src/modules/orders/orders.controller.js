// src/modules/orders/orders.controller.js
const db = require('../../config/db');
const sendEmail = require('../../utils/email');
const { redeemCoupon } = require('../coupons/coupons.service');

const ADMIN_EMAIL = process.env.SMTP_USER; // Same convention as booking.controller.js

// @route   POST /api/v1/orders/checkout
// @access  Private (STUDENT)
exports.checkout = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { delivery_address, coupon_code } = req.body;

        // 1. Pull the cart, joined with LIVE tiffin_service data (never trust
        //    the cart's price snapshot for the actual charge -- always
        //    re-verify against the current price + availability at checkout).
        //    Uses the pool directly (no dedicated connection needed yet --
        //    that's only acquired once we're sure we actually need to write).
        const [cartItems] = await db.query(
            `SELECT ci.id AS cart_item_id, ci.tiffin_service_id, ci.meal_type, ci.delivery_date, ci.quantity,
                    ts.name AS service_name, ts.price_per_meal, ts.approval_status, ts.is_active,
                    ts.breakfast_available, ts.lunch_available, ts.dinner_available,
                    ts.vendor_id, v.full_name AS vendor_name, v.email AS vendor_email,
                    EXISTS (
                        SELECT 1 FROM vendor_memberships vm
                        WHERE vm.vendor_id = ts.vendor_id AND vm.status = 'ACTIVE' AND vm.end_date >= CURDATE()
                    ) AS vendor_membership_active,
                    COALESCE((SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ts.vendor_id), 1) AS vendor_accepting_orders
             FROM tiffin_cart_items ci
             JOIN tiffin_services ts ON ci.tiffin_service_id = ts.id
             JOIN users v ON ts.vendor_id = v.id
             WHERE ci.customer_id = ?`,
            [customerId]
        );

        if (cartItems.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Your cart is empty' });
        }

        // 2. Re-validate every line is still orderable (a vendor may have
        //    paused/edited their listing after it was added to the cart).
        //    All-or-nothing checkout: if anything's invalid, reject the whole
        //    checkout with a clear list, rather than silently dropping items.
        const mealFlagMap = { BREAKFAST: 'breakfast_available', LUNCH: 'lunch_available', DINNER: 'dinner_available' };
        const problems = cartItems
            .filter((item) => item.approval_status !== 'APPROVED' || !item.is_active || !item.vendor_membership_active || !item.vendor_accepting_orders || !item[mealFlagMap[item.meal_type]])
            .map((item) => `${item.service_name} (${item.meal_type})`);

        if (problems.length > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'Some items in your cart are no longer available. Please remove or update them before checking out.',
                unavailable_items: problems
            });
        }

        // 3. Create one order row per cart line, using the LIVE price.
        //    Connection is only acquired now, right before the transaction.
        const connection = await db.getConnection();
        let createdOrders;
        try {
            await connection.beginTransaction();

            createdOrders = [];
            for (const item of cartItems) {
                const totalAmount = item.quantity * Number(item.price_per_meal);
                const [result] = await connection.query(
                    `INSERT INTO tiffin_orders
                        (customer_id, tiffin_service_id, meal_type, delivery_date, quantity, price_per_meal, total_amount, delivery_address, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
                    [customerId, item.tiffin_service_id, item.meal_type, item.delivery_date, item.quantity, item.price_per_meal, totalAmount, delivery_address]
                );
                createdOrders.push({
                    order_id: result.insertId,
                    tiffin_service_id: item.tiffin_service_id,
                    service_name: item.service_name,
                    vendor_id: item.vendor_id,
                    vendor_name: item.vendor_name,
                    vendor_email: item.vendor_email,
                    meal_type: item.meal_type,
                    delivery_date: item.delivery_date,
                    quantity: item.quantity,
                    price_per_meal: item.price_per_meal,
                    total_amount: totalAmount
                });
            }

            await connection.query(`DELETE FROM tiffin_cart_items WHERE customer_id = ?`, [customerId]);

            await connection.commit();
        } catch (txError) {
            await connection.rollback();
            throw txError;
        } finally {
            connection.release();
        }

        const grandTotal = createdOrders.reduce((sum, o) => sum + o.total_amount, 0);

        // ---------------------------------------------------------
        // Coupon (optional). IMPORTANT: this only affects what the customer
        // is shown as owing -- it deliberately does NOT touch each order
        // row's total_amount, since that's what feeds vendor earnings
        // (see vendor.controller.js's computeVendorEarnings). The discount
        // is a platform cost, not something deducted from the vendor's cut.
        // ---------------------------------------------------------
        let discountAmount = 0;
        let couponMessage = null;
        if (coupon_code) {
            const couponResult = await redeemCoupon(customerId, coupon_code, grandTotal);
            if (couponResult.valid) {
                discountAmount = couponResult.discount_amount;
            } else {
                // Order is already placed at this point -- a bad coupon code
                // shouldn't undo a successful checkout, just gets reported back.
                couponMessage = couponResult.message;
            }
        }
        const finalAmount = Math.round((grandTotal - discountAmount) * 100) / 100;

        // ---------------------------------------------------------
        // Notification emails (non-blocking, same pattern as bookings):
        //   - one email to the customer, summarizing the whole order
        //   - one email PER VENDOR, showing only that vendor's line items
        //     (a cart can span multiple vendors)
        //   - one email to the platform admin, summarizing everything
        // ---------------------------------------------------------
        const [[customer]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [customerId]);

        const orderRowsHtml = createdOrders
            .map((o) => `<li>${o.service_name} - ${o.meal_type} x${o.quantity} on ${o.delivery_date} - ₹${o.total_amount}</li>`)
            .join('');

        const customerMail = sendEmail({
            email: customer.email,
            subject: `Order Confirmed - Quark Housing Tiffin`,
            html: `
                <h3>Hello ${customer.full_name},</h3>
                <p>Your tiffin order has been placed successfully.</p>
                <ul>${orderRowsHtml}</ul>
                <p><b>Subtotal:</b> ₹${grandTotal}</p>
                ${discountAmount > 0 ? `<p><b>Coupon Discount:</b> -₹${discountAmount}</p><p><b>You Paid:</b> ₹${finalAmount}</p>` : ''}
                <p><b>Delivery Address:</b> ${delivery_address}</p>
                <p>We'll notify you once each vendor confirms your order.</p>
            `
        });

        const vendorGroups = createdOrders.reduce((groups, o) => {
            (groups[o.vendor_id] = groups[o.vendor_id] || []).push(o);
            return groups;
        }, {});

        const vendorMails = Object.values(vendorGroups).map((orders) => {
            const vendor = orders[0];
            const rows = orders
                .map((o) => `<li>${o.meal_type} x${o.quantity} on ${o.delivery_date} - ₹${o.total_amount} (Order #${o.order_id})</li>`)
                .join('');
            const vendorSubtotal = orders.reduce((sum, o) => sum + o.total_amount, 0);

            return sendEmail({
                email: vendor.vendor_email,
                subject: `New Tiffin Order Received`,
                html: `
                    <h3>Hello ${vendor.vendor_name},</h3>
                    <p>You have new tiffin order(s):</p>
                    <ul>${rows}</ul>
                    <p><b>Subtotal:</b> ₹${vendorSubtotal}</p>
                    <p><b>Delivery Address:</b> ${delivery_address}</p>
                    <p><b>Customer Contact:</b> ${customer.full_name} (${customer.email})</p>
                `
            });
        });

        const adminMail = sendEmail({
            email: ADMIN_EMAIL,
            subject: `[ADMIN ALERT] New Tiffin Order - Customer #${customerId}`,
            html: `
                <h3>New Tiffin Order Placed</h3>
                <p><b>Customer:</b> ${customer.full_name} (${customer.email})</p>
                <ul>${orderRowsHtml}</ul>
                <p><b>Grand Total:</b> ₹${grandTotal}</p>
            `
        });

        await Promise.all([customerMail, adminMail, ...vendorMails]).catch((err) => {
            console.error('Email sending failed, but order was saved:', err);
        });

        res.status(201).json({
            status: 'success',
            message: 'Order placed successfully. Confirmation emails sent.',
            data: {
                order_ids: createdOrders.map((o) => o.order_id),
                grand_total: grandTotal,
                discount_amount: discountAmount,
                final_amount: finalAmount,
                coupon_message: couponMessage
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/orders/my-orders
// @access  Private (STUDENT)
exports.getMyOrders = async (req, res, next) => {
    try {
        const customerId = req.user.id;

        const [orders] = await db.query(
            `SELECT o.id, o.meal_type, o.delivery_date, o.quantity, o.total_amount, o.status, o.created_at,
                    ts.name AS service_name
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             WHERE o.customer_id = ?
             ORDER BY o.created_at DESC`,
            [customerId]
        );

        res.status(200).json({ status: 'success', results: orders.length, data: { orders } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/orders/:id
// @access  Private (STUDENT, own orders only)
exports.getOrderDetails = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const orderId = req.params.id;

        const [[order]] = await db.query(
            `SELECT o.*, ts.name AS service_name
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             WHERE o.id = ? AND o.customer_id = ?`,
            [orderId, customerId]
        );

        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }

        res.status(200).json({ status: 'success', data: { order } });
    } catch (error) {
        next(error);
    }
};