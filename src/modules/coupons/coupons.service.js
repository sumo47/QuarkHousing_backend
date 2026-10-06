// src/modules/coupons/coupons.service.js
const db = require('../../config/db');

// Computes what a coupon is worth against a given order amount, without
// redeeming it. Returns { valid, message, discount_amount }.
async function evaluateCoupon(customerId, code, orderAmount) {
    const [[coupon]] = await db.query(
        `SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND CURDATE() BETWEEN valid_from AND valid_until`,
        [code]
    );
    if (!coupon) {
        return { valid: false, message: 'Invalid or expired coupon code' };
    }

    if (orderAmount < Number(coupon.min_order_amount)) {
        return { valid: false, message: `This coupon requires a minimum order of ₹${coupon.min_order_amount}` };
    }

    const [[alreadyUsed]] = await db.query(
        `SELECT id FROM coupon_redemptions WHERE coupon_id = ? AND customer_id = ?`,
        [coupon.id, customerId]
    );
    if (alreadyUsed) {
        return { valid: false, message: 'You have already used this coupon' };
    }

    let discount = coupon.discount_type === 'FLAT'
        ? Number(coupon.discount_value)
        : orderAmount * (Number(coupon.discount_value) / 100);

    if (coupon.max_discount_amount !== null && discount > Number(coupon.max_discount_amount)) {
        discount = Number(coupon.max_discount_amount);
    }
    // Never let a discount exceed the order total itself
    discount = Math.min(discount, orderAmount);

    return { valid: true, coupon, discount_amount: Math.round(discount * 100) / 100 };
}

// Actually redeems the coupon (records it) -- call only once you're sure
// the order is really being placed, e.g. inside checkout.
async function redeemCoupon(customerId, code, orderAmount) {
    const result = await evaluateCoupon(customerId, code, orderAmount);
    if (!result.valid) return result;

    await db.query(
        `INSERT INTO coupon_redemptions (coupon_id, customer_id, discount_applied) VALUES (?, ?, ?)`,
        [result.coupon.id, customerId, result.discount_amount]
    );

    return result;
}

module.exports = { evaluateCoupon, redeemCoupon };