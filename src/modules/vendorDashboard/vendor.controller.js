// src/modules/vendor/vendor.controller.js
const db = require('../../config/db');
const sendEmail = require('../../utils/email');
const { creditReferralReward } = require('../referrals/referrals.service');

// =============================================================================
// Shared helper: a vendor's total earnings, reused by Overview and Earnings.
// Mirrors the pattern from owner.controller.js's computeBalance().
// =============================================================================
async function computeVendorEarnings(vendorId) {
    const [[orderEarnings]] = await db.query(
        `SELECT COALESCE(SUM(o.total_amount), 0) AS total
         FROM tiffin_orders o
         JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
         WHERE ts.vendor_id = ? AND o.status IN ('CONFIRMED', 'DELIVERED')`,
        [vendorId]
    );

    const [[subscriptionEarnings]] = await db.query(
        `SELECT COALESCE(SUM(s.price), 0) AS total
         FROM tiffin_subscriptions s
         JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
         WHERE ts.vendor_id = ? AND s.status IN ('ACTIVE', 'PAUSED', 'COMPLETED')`,
        [vendorId]
    );

    const from_orders = Number(orderEarnings.total);
    const from_subscriptions = Number(subscriptionEarnings.total);
    return { from_orders, from_subscriptions, total_earnings: from_orders + from_subscriptions };
}

// =============================================================================
// 1. OVERVIEW
// =============================================================================

// @route   GET /api/v1/vendor/overview
// @access  Private (VENDOR)
exports.getOverview = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const today = new Date().toISOString().slice(0, 10);

        const [[listingStats]] = await db.query(
            `SELECT COUNT(*) AS total_listings, SUM(CASE WHEN is_active = 1 AND approval_status = 'APPROVED' THEN 1 ELSE 0 END) AS active_listings
             FROM tiffin_services WHERE vendor_id = ?`,
            [vendorId]
        );

        // Today's orders -- specifically orders due for DELIVERY today, since
        // that's what a vendor operationally cares about each morning.
        const [todaysOrders] = await db.query(
            `SELECT o.id, o.meal_type, o.quantity, o.total_amount, o.status, o.delivery_address,
                    ts.name AS service_name, u.full_name AS customer_name, u.phone AS customer_phone
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             JOIN users u ON o.customer_id = u.id
             WHERE ts.vendor_id = ? AND o.delivery_date = ?
             ORDER BY FIELD(o.status, 'PENDING', 'CONFIRMED', 'DELIVERED', 'CANCELLED'), o.created_at ASC`,
            [vendorId, today]
        );

        const [[todaysEarningsRow]] = await db.query(
            `SELECT COALESCE(SUM(o.total_amount), 0) AS total
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             WHERE ts.vendor_id = ? AND o.delivery_date = ? AND o.status IN ('CONFIRMED', 'DELIVERED')`,
            [vendorId, today]
        );

        const [[orderStats]] = await db.query(
            `SELECT
                SUM(CASE WHEN o.status IN ('PENDING','CONFIRMED') THEN 1 ELSE 0 END) AS active_orders,
                SUM(CASE WHEN o.status = 'DELIVERED' THEN 1 ELSE 0 END) AS completed_orders,
                COUNT(*) AS total_orders
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             WHERE ts.vendor_id = ?`,
            [vendorId]
        );

        const [[subscriptionStats]] = await db.query(
            `SELECT
                SUM(CASE WHEN s.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_subscriptions,
                COUNT(*) AS total_subscriptions
             FROM tiffin_subscriptions s
             JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
             WHERE ts.vendor_id = ?`,
            [vendorId]
        );

        // "My own configured plans" -- how many subscription plans this
        // vendor has set up across all their listings (not subscriber count).
        const [[planStats]] = await db.query(
            `SELECT COUNT(*) AS subscription_plans_count
             FROM tiffin_subscription_plans p
             JOIN tiffin_services ts ON p.tiffin_service_id = ts.id
             WHERE ts.vendor_id = ? AND p.is_active = 1`,
            [vendorId]
        );

        // Active customers: distinct people currently engaged with this
        // vendor -- either a live order (not cancelled) or a live/paused
        // subscription. Counts each person once even if they have both.
        const [[activeCustomersRow]] = await db.query(
            `SELECT COUNT(DISTINCT customer_id) AS active_customers FROM (
                SELECT o.customer_id FROM tiffin_orders o
                JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
                WHERE ts.vendor_id = ? AND o.status != 'CANCELLED'
                UNION
                SELECT s.customer_id FROM tiffin_subscriptions s
                JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
                WHERE ts.vendor_id = ? AND s.status IN ('ACTIVE', 'PAUSED')
             ) AS combined`,
            [vendorId, vendorId]
        );

        const [[ratingSummary]] = await db.query(
            `SELECT COUNT(*) AS total_reviews, COALESCE(ROUND(AVG(r.rating), 1), 0) AS average_rating
             FROM tiffin_reviews r
             JOIN tiffin_services ts ON r.tiffin_service_id = ts.id
             WHERE ts.vendor_id = ?`,
            [vendorId]
        );

        // Live membership status -- same "never trust stored status alone" rule as membership.controller.js
        const [[membership]] = await db.query(
            `SELECT status, end_date FROM vendor_memberships
             WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 1`,
            [vendorId]
        );
        let membershipStatus = 'NONE';
        if (membership) {
            const endDateStr = membership.end_date
                ? (membership.end_date instanceof Date ? membership.end_date.toISOString().slice(0, 10) : String(membership.end_date).slice(0, 10))
                : null;
            const isActive = membership.status === 'ACTIVE' && endDateStr && endDateStr >= today;
            membershipStatus = isActive ? 'ACTIVE' : (membership.status === 'PENDING' ? 'PENDING' : 'EXPIRED');
        }

        const [[settingsRow]] = await db.query(`SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ?`, [vendorId]);
        const acceptingOrders = settingsRow ? !!settingsRow.accepting_orders : true; // defaults to true if no row yet

        const earnings = await computeVendorEarnings(vendorId);

        res.status(200).json({
            status: 'success',
            data: {
                accepting_orders: acceptingOrders,
                total_listings: listingStats.total_listings || 0,
                active_listings: listingStats.active_listings || 0,
                todays_orders: todaysOrders,
                todays_earnings: Number(todaysEarningsRow.total),
                active_orders: orderStats.active_orders || 0,
                completed_orders: orderStats.completed_orders || 0,
                total_orders: orderStats.total_orders || 0,
                active_customers: activeCustomersRow.active_customers || 0,
                active_subscriptions: subscriptionStats.active_subscriptions || 0,
                total_subscriptions: subscriptionStats.total_subscriptions || 0,
                subscription_plans_count: planStats.subscription_plans_count || 0,
                average_rating: Number(ratingSummary.average_rating),
                total_reviews: ratingSummary.total_reviews || 0,
                membership_status: membershipStatus,
                ...earnings
            }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 2. ORDERS
// =============================================================================

// @route   GET /api/v1/vendor/orders?status=&tiffin_service_id=
// @access  Private (VENDOR)
exports.getOrders = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const { status, tiffin_service_id } = req.query;

        let query = `
            SELECT o.id, o.meal_type, o.delivery_date, o.quantity, o.total_amount, o.delivery_address, o.status, o.created_at,
                   ts.id AS tiffin_service_id, ts.name AS service_name,
                   u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
            FROM tiffin_orders o
            JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
            JOIN users u ON o.customer_id = u.id
            WHERE ts.vendor_id = ?
        `;
        const params = [vendorId];

        if (status) {
            query += ` AND o.status = ?`;
            params.push(status);
        }
        if (tiffin_service_id) {
            query += ` AND ts.id = ?`;
            params.push(tiffin_service_id);
        }
        query += ` ORDER BY o.created_at DESC`;

        const [orders] = await db.query(query, params);

        res.status(200).json({ status: 'success', results: orders.length, data: { orders } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/vendor/orders/:id
// @access  Private (VENDOR, own only)
exports.getOrderDetails = async (req, res, next) => {
    try {
        const [[order]] = await db.query(
            `SELECT o.*, ts.name AS service_name, ts.vendor_id,
                    u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             JOIN users u ON o.customer_id = u.id
             WHERE o.id = ? AND ts.vendor_id = ?`,
            [req.params.id, req.user.id]
        );

        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }

        res.status(200).json({ status: 'success', data: { order } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/vendor/orders/:id/accept
// @access  Private (VENDOR, own only)
// This is the vendor's confirmation step for a tiffin order -- replaces the
// "manually flip to CONFIRMED in the DB" testing workaround. A real order
// now goes PENDING -> (vendor Accepts) -> CONFIRMED -> (vendor Delivers) -> DELIVERED.
exports.markOrderAccepted = async (req, res, next) => {
    //console.log(req.user.id)
    try {
        const vendorId = req.user.id;
        const orderId = req.params.id;

        const [[order]] = await db.query(
            `SELECT o.id, o.status, o.meal_type, o.delivery_date, ts.name AS service_name,
                    u.full_name AS customer_name, u.email AS customer_email
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             JOIN users u ON o.customer_id = u.id
             WHERE o.id = ? AND ts.vendor_id = ?`,
            [orderId, vendorId]
        );

        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        if (order.status !== 'PENDING') {
            return res.status(400).json({ status: 'error', message: `Cannot accept an order that is already ${order.status}` });
        }

        await db.query(`UPDATE tiffin_orders SET status = 'CONFIRMED' WHERE id = ?`, [orderId]);

        await sendEmail({
            email: order.customer_email,
            subject: `Your Tiffin Order Was Accepted - ${order.service_name}`,
            html: `
                <h3>Hello ${order.customer_name},</h3>
                <p>Your ${order.meal_type.toLowerCase()} order from <b>${order.service_name}</b> for ${order.delivery_date} has been accepted and is being prepared.</p>
            `
        }).catch((err) => console.error('Order-accepted email failed to send:', err));

        res.status(200).json({ status: 'success', message: 'Order accepted' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/vendor/orders/:id/deliver
// @access  Private (VENDOR, own only)
exports.markOrderDelivered = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const orderId = req.params.id;

        const [[order]] = await db.query(
            `SELECT o.id, o.status, o.meal_type, o.delivery_date, o.customer_id, ts.name AS service_name,
                    u.full_name AS customer_name, u.email AS customer_email
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             JOIN users u ON o.customer_id = u.id
             WHERE o.id = ? AND ts.vendor_id = ?`,
            [orderId, vendorId]
        );

        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        if (order.status !== 'CONFIRMED') {
            return res.status(400).json({ status: 'error', message: `Cannot mark as delivered while order is ${order.status}` });
        }

        await db.query(`UPDATE tiffin_orders SET status = 'DELIVERED' WHERE id = ?`, [orderId]);

        // Credit ₹20 to whoever referred this customer, if anyone did.
        // Never blocks or fails the delivery itself -- see referrals.service.js.
        await creditReferralReward(order.customer_id, orderId);

        await sendEmail({
            email: order.customer_email,
            subject: `Your Tiffin Has Been Delivered - ${order.service_name}`,
            html: `
                <h3>Hello ${order.customer_name},</h3>
                <p>Your ${order.meal_type.toLowerCase()} from <b>${order.service_name}</b> for ${order.delivery_date} has been delivered. Enjoy your meal!</p>
            `
        }).catch((err) => console.error('Delivery email failed to send:', err));

        res.status(200).json({ status: 'success', message: 'Order marked as delivered' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/vendor/orders/:id/cancel
// @access  Private (VENDOR, own only)
exports.cancelOrder = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const orderId = req.params.id;
        const { reason } = req.body;

        const [[order]] = await db.query(
            `SELECT o.id, o.status, o.meal_type, o.delivery_date, ts.name AS service_name,
                    u.full_name AS customer_name, u.email AS customer_email
             FROM tiffin_orders o
             JOIN tiffin_services ts ON o.tiffin_service_id = ts.id
             JOIN users u ON o.customer_id = u.id
             WHERE o.id = ? AND ts.vendor_id = ?`,
            [orderId, vendorId]
        );

        if (!order) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
            return res.status(400).json({ status: 'error', message: `Cannot cancel an order that is already ${order.status}` });
        }

        await db.query(`UPDATE tiffin_orders SET status = 'CANCELLED', cancellation_reason = ? WHERE id = ?`, [reason, orderId]);

        await sendEmail({
            email: order.customer_email,
            subject: `Your Tiffin Order Was Cancelled - ${order.service_name}`,
            html: `
                <h3>Hello ${order.customer_name},</h3>
                <p>Unfortunately your ${order.meal_type.toLowerCase()} order from <b>${order.service_name}</b> for ${order.delivery_date} has been cancelled by the vendor.</p>
                <p><b>Reason:</b> ${reason}</p>
                <p>If you were already charged, please contact support for a refund.</p>
            `
        }).catch((err) => console.error('Cancellation email failed to send:', err));

        res.status(200).json({ status: 'success', message: 'Order cancelled' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 3. SUBSCRIPTIONS
// =============================================================================

// @route   GET /api/v1/vendor/subscriptions?status=&tiffin_service_id=
// @access  Private (VENDOR)
exports.getSubscriptions = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const { status, tiffin_service_id } = req.query;

        let query = `
            SELECT s.id, s.plan_type, s.meal_coverage, s.price, s.status, s.start_date, s.end_date, s.created_at,
                   ts.id AS tiffin_service_id, ts.name AS service_name,
                   u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
            FROM tiffin_subscriptions s
            JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
            JOIN users u ON s.customer_id = u.id
            WHERE ts.vendor_id = ?
        `;
        const params = [vendorId];

        if (status) {
            query += ` AND s.status = ?`;
            params.push(status);
        }
        if (tiffin_service_id) {
            query += ` AND ts.id = ?`;
            params.push(tiffin_service_id);
        }
        query += ` ORDER BY s.created_at DESC`;

        const [subscriptions] = await db.query(query, params);

        res.status(200).json({ status: 'success', results: subscriptions.length, data: { subscriptions } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/vendor/subscriptions/:id
// @access  Private (VENDOR, own only)
exports.getSubscriptionDetails = async (req, res, next) => {
    try {
        const [[subscription]] = await db.query(
            `SELECT s.*, ts.name AS service_name, ts.vendor_id,
                    u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
             FROM tiffin_subscriptions s
             JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
             JOIN users u ON s.customer_id = u.id
             WHERE s.id = ? AND ts.vendor_id = ?`,
            [req.params.id, req.user.id]
        );

        if (!subscription) {
            return res.status(404).json({ status: 'error', message: 'Subscription not found' });
        }

        res.status(200).json({ status: 'success', data: { subscription } });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 4. REVIEWS
// =============================================================================

// @route   GET /api/v1/vendor/reviews?tiffin_service_id=
// @access  Private (VENDOR)
exports.getReviews = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const { tiffin_service_id } = req.query;

        let query = `
            SELECT r.id, r.rating, r.comment, r.created_at,
                   u.full_name AS reviewer_name,
                   ts.id AS tiffin_service_id, ts.name AS service_name
            FROM tiffin_reviews r
            JOIN tiffin_services ts ON r.tiffin_service_id = ts.id
            JOIN users u ON r.customer_id = u.id
            WHERE ts.vendor_id = ?
        `;
        const params = [vendorId];

        if (tiffin_service_id) {
            query += ` AND ts.id = ?`;
            params.push(tiffin_service_id);
        }
        query += ` ORDER BY r.created_at DESC`;

        const [reviews] = await db.query(query, params);

        const [ratingByService] = await db.query(
            `SELECT ts.id AS tiffin_service_id, ts.name,
                    COUNT(r.id) AS total_reviews,
                    COALESCE(ROUND(AVG(r.rating), 1), 0) AS average_rating
             FROM tiffin_services ts
             LEFT JOIN tiffin_reviews r ON r.tiffin_service_id = ts.id
             WHERE ts.vendor_id = ?
             GROUP BY ts.id, ts.name`,
            [vendorId]
        );

        res.status(200).json({
            status: 'success',
            results: reviews.length,
            data: { rating_by_service: ratingByService, reviews }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 5. EARNINGS
// =============================================================================

// @route   GET /api/v1/vendor/earnings
// @access  Private (VENDOR)
exports.getEarnings = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const earnings = await computeVendorEarnings(vendorId);

        const [earningsByService] = await db.query(
            `SELECT ts.id AS tiffin_service_id, ts.name,
                COALESCE((
                    SELECT SUM(o.total_amount) FROM tiffin_orders o
                    WHERE o.tiffin_service_id = ts.id AND o.status IN ('CONFIRMED','DELIVERED')
                ), 0) AS from_orders,
                COALESCE((
                    SELECT SUM(s.price) FROM tiffin_subscriptions s
                    WHERE s.tiffin_service_id = ts.id AND s.status IN ('ACTIVE','PAUSED','COMPLETED')
                ), 0) AS from_subscriptions
             FROM tiffin_services ts
             WHERE ts.vendor_id = ?`,
            [vendorId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                ...earnings,
                earnings_by_service: earningsByService.map((row) => ({
                    tiffin_service_id: row.tiffin_service_id,
                    name: row.name,
                    from_orders: Number(row.from_orders),
                    from_subscriptions: Number(row.from_subscriptions),
                    total: Number(row.from_orders) + Number(row.from_subscriptions)
                }))
            }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 6. PROFILE
// =============================================================================

// @route   GET /api/v1/vendor/profile
// @access  Private (VENDOR)
exports.getProfile = async (req, res, next) => {
    try {
        const [[user]] = await db.query(
            `SELECT id, full_name, email, phone, role, created_at FROM users WHERE id = ?`,
            [req.user.id]
        );
        res.status(200).json({ status: 'success', data: { user } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/vendor/profile
// @access  Private (VENDOR)
exports.updateProfile = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const { full_name, phone } = req.body;

        const fields = Object.entries({ full_name, phone }).filter(([, v]) => v !== undefined);
        if (fields.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Nothing to update' });
        }

        const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
        const values = fields.map(([, v]) => v);

        await db.query(`UPDATE users SET ${setClause} WHERE id = ?`, [...values, vendorId]);

        res.status(200).json({ status: 'success', message: 'Profile updated successfully' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 7. SETTINGS
// =============================================================================

// @route   GET /api/v1/vendor/settings
// @access  Private (VENDOR)
exports.getSettings = async (req, res, next) => {
    try {
        const [[settings]] = await db.query(`SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ?`, [req.user.id]);
        res.status(200).json({
            status: 'success',
            data: { accepting_orders: settings ? !!settings.accepting_orders : true }
        });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/vendor/settings
// @access  Private (VENDOR)
// The vendor-wide "I'm not accepting orders right now" switch. When set to
// false, EVERY listing this vendor has becomes invisible/unorderable across
// search, detail, cart, checkout, and subscriptions -- checked live via
// COALESCE(vendor_settings.accepting_orders, 1) in each of those queries.
exports.updateSettings = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const acceptingOrders = req.body.accepting_orders === 'true' || req.body.accepting_orders === '1';

        await db.query(
            `INSERT INTO vendor_settings (vendor_id, accepting_orders) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE accepting_orders = VALUES(accepting_orders)`,
            [vendorId, acceptingOrders ? 1 : 0]
        );

        res.status(200).json({
            status: 'success',
            message: acceptingOrders ? 'You are now accepting orders' : 'You are now marked as not accepting orders — your listings are hidden from customers until you turn this back on',
            data: { accepting_orders: acceptingOrders }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 8. MEAL SCHEDULE (plan menus multiple days ahead)
// =============================================================================

async function assertOwnsTiffinService(vendorId, tiffinServiceId) {
    const [[row]] = await db.query(`SELECT id FROM tiffin_services WHERE id = ? AND vendor_id = ?`, [tiffinServiceId, vendorId]);
    return !!row;
}

// @route   GET /api/v1/vendor/menu-schedule/:tiffinServiceId?start=YYYY-MM-DD&end=YYYY-MM-DD
// @access  Private (VENDOR, own listing only)
// Shows the planning calendar -- what's already scheduled and what's still empty.
exports.getMenuSchedule = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const tiffinServiceId = req.params.tiffinServiceId;

        const owns = await assertOwnsTiffinService(vendorId, tiffinServiceId);
        if (!owns) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or does not belong to you' });
        }

        const today = new Date().toISOString().slice(0, 10);
        const defaultEnd = new Date();
        defaultEnd.setDate(defaultEnd.getDate() + 6); // default: next 7 days including today
        const start = req.query.start || today;
        const end = req.query.end || defaultEnd.toISOString().slice(0, 10);

        const [rows] = await db.query(
            `SELECT menu_date, meal_type, items FROM tiffin_daily_menu
             WHERE tiffin_service_id = ? AND menu_date BETWEEN ? AND ?
             ORDER BY menu_date ASC`,
            [tiffinServiceId, start, end]
        );

        // Group by date so the frontend can render one calendar cell per day
        const byDate = {};
        rows.forEach((r) => {
            const dateStr = r.menu_date.toISOString().slice(0, 10);
            if (!byDate[dateStr]) byDate[dateStr] = {};
            byDate[dateStr][r.meal_type] = r.items;
        });

        res.status(200).json({ status: 'success', data: { start, end, schedule: byDate } });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/vendor/menu-schedule/:tiffinServiceId/bulk
// @access  Private (VENDOR, own listing only)
// Body: { days: [{ menu_date, meal_type, items }, ...] } -- set multiple
// days/meals in one call, e.g. planning a whole week ahead at once.
exports.bulkSetMenuSchedule = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const tiffinServiceId = req.params.tiffinServiceId;
        const { days } = req.body;

        const owns = await assertOwnsTiffinService(vendorId, tiffinServiceId);
        if (!owns) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or does not belong to you' });
        }

        for (const day of days) {
            await db.query(
                `INSERT INTO tiffin_daily_menu (tiffin_service_id, menu_date, meal_type, items)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE items = VALUES(items)`,
                [tiffinServiceId, day.menu_date, day.meal_type, day.items]
            );
        }

        res.status(200).json({ status: 'success', message: `${days.length} menu entr${days.length === 1 ? 'y' : 'ies'} saved` });
    } catch (error) {
        next(error);
    }
};