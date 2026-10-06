// src/modules/coupons/coupons.schema.js
const { z } = require('zod');

exports.validateCouponSchema = z.object({
    code: z.string().min(3).max(30),
    order_amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "order_amount must be a valid amount")
});