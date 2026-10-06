// src/modules/coupons/coupons.controller.js
const db = require('../../config/db');
const { evaluateCoupon } = require('./coupons.service');

// @route   GET /api/v1/coupons/my-coupons
// @access  Private (STUDENT)
// Lists currently-valid coupons this customer hasn't already redeemed.
exports.getMyCoupons = async (req, res, next) => {
    try {
        const customerId = req.user.id;

        const [coupons] = await db.query(
            `SELECT c.id, c.code, c.discount_type, c.discount_value, c.min_order_amount, c.max_discount_amount, c.valid_until
             FROM coupons c
             WHERE c.is_active = 1 AND CURDATE() BETWEEN c.valid_from AND c.valid_until
               AND NOT EXISTS (
                   SELECT 1 FROM coupon_redemptions cr WHERE cr.coupon_id = c.id AND cr.customer_id = ?
               )
             ORDER BY c.valid_until ASC`,
            [customerId]
        );

        res.status(200).json({ status: 'success', results: coupons.length, data: { coupons } });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/coupons/validate
// @access  Private (STUDENT)
// Preview only -- does NOT redeem the coupon. Used at checkout before placing the order.
exports.validateCoupon = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { code } = req.body;
        const orderAmount = parseFloat(req.body.order_amount);

        const result = await evaluateCoupon(customerId, code, orderAmount);

        if (!result.valid) {
            return res.status(400).json({ status: 'error', message: result.message });
        }

        res.status(200).json({
            status: 'success',
            data: {
                discount_amount: result.discount_amount,
                final_amount: Math.round((orderAmount - result.discount_amount) * 100) / 100
            }
        });
    } catch (error) {
        next(error);
    }
};