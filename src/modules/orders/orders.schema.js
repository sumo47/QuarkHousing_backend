// src/modules/orders/orders.schema.js
const { z } = require('zod');

exports.checkoutSchema = z.object({
    delivery_address: z.string().min(5, "delivery_address must be at least 5 characters"),
    coupon_code: z.string().min(3).max(30).optional()
});