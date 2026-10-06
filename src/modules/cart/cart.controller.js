// src/modules/cart/cart.controller.js
const db = require('../../config/db');

const todayStr = () => new Date().toISOString().slice(0, 10);

// @route   POST /api/v1/cart
// @access  Private (STUDENT)
exports.addToCart = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { tiffin_service_id, meal_type, delivery_date } = req.body;
        const quantity = parseInt(req.body.quantity || '1');

        if (delivery_date < todayStr()) {
            return res.status(400).json({ status: 'error', message: 'delivery_date cannot be in the past' });
        }

        const [[service]] = await db.query(
            `SELECT ts.id, ts.name, ts.price_per_meal, ts.breakfast_available, ts.lunch_available, ts.dinner_available
             FROM tiffin_services ts
             WHERE ts.id = ? AND ts.approval_status = 'APPROVED' AND ts.is_active = 1
               AND EXISTS (
                   SELECT 1 FROM vendor_memberships vm
                   WHERE vm.vendor_id = ts.vendor_id AND vm.status = 'ACTIVE' AND vm.end_date >= CURDATE()
               )
               AND COALESCE((SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ts.vendor_id), 1) = 1`,
            [tiffin_service_id]
        );

        if (!service) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or not currently available' });
        }

        const mealFlagMap = { BREAKFAST: 'breakfast_available', LUNCH: 'lunch_available', DINNER: 'dinner_available' };
        if (!service[mealFlagMap[meal_type]]) {
            return res.status(400).json({ status: 'error', message: `${service.name} does not offer ${meal_type.toLowerCase()}` });
        }

        // Adding the same service+meal+date again bumps quantity instead of erroring
        await db.query(
            `INSERT INTO tiffin_cart_items (customer_id, tiffin_service_id, meal_type, delivery_date, quantity, price_per_meal_snapshot)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), price_per_meal_snapshot = VALUES(price_per_meal_snapshot)`,
            [customerId, tiffin_service_id, meal_type, delivery_date, quantity, service.price_per_meal]
        );

        const [[cartItem]] = await db.query(
            `SELECT * FROM tiffin_cart_items WHERE customer_id = ? AND tiffin_service_id = ? AND meal_type = ? AND delivery_date = ?`,
            [customerId, tiffin_service_id, meal_type, delivery_date]
        );

        res.status(201).json({ status: 'success', message: 'Added to cart', data: { cart_item: cartItem } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/cart
// @access  Private (STUDENT)
exports.getCart = async (req, res, next) => {
    try {
        const customerId = req.user.id;

        const [items] = await db.query(
            `SELECT ci.id, ci.tiffin_service_id, ts.name AS service_name,
                    (SELECT image_url FROM tiffin_media WHERE tiffin_service_id = ts.id LIMIT 1) AS thumbnail,
                    ci.meal_type, ci.delivery_date, ci.quantity, ci.price_per_meal_snapshot,
                    (ci.quantity * ci.price_per_meal_snapshot) AS line_total
             FROM tiffin_cart_items ci
             JOIN tiffin_services ts ON ci.tiffin_service_id = ts.id
             WHERE ci.customer_id = ?
             ORDER BY ci.delivery_date ASC`,
            [customerId]
        );

        const grand_total = items.reduce((sum, item) => sum + Number(item.line_total), 0);

        res.status(200).json({ status: 'success', results: items.length, data: { items, grand_total } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/cart/:itemId
// @access  Private (STUDENT)
exports.updateCartItem = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const itemId = req.params.itemId;
        const quantity = parseInt(req.body.quantity);

        const [result] = await db.query(
            `UPDATE tiffin_cart_items SET quantity = ? WHERE id = ? AND customer_id = ?`,
            [quantity, itemId, customerId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Cart item not found' });
        }

        res.status(200).json({ status: 'success', message: 'Cart item updated' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/cart/:itemId
// @access  Private (STUDENT)
exports.removeCartItem = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const itemId = req.params.itemId;

        const [result] = await db.query(
            `DELETE FROM tiffin_cart_items WHERE id = ? AND customer_id = ?`,
            [itemId, customerId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Cart item not found' });
        }

        res.status(200).json({ status: 'success', message: 'Item removed from cart' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/cart
// @access  Private (STUDENT)
exports.clearCart = async (req, res, next) => {
    try {
        await db.query(`DELETE FROM tiffin_cart_items WHERE customer_id = ?`, [req.user.id]);
        res.status(200).json({ status: 'success', message: 'Cart cleared' });
    } catch (error) {
        next(error);
    }
};