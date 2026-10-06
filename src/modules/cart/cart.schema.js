// src/modules/cart/cart.schema.js
const { z } = require('zod');

exports.addToCartSchema = z.object({
    tiffin_service_id: z.string().regex(/^\d+$/, "tiffin_service_id must be a valid number"),
    meal_type: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']),
    delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "delivery_date must be YYYY-MM-DD"),
    quantity: z.string().regex(/^[1-9]\d*$/, "quantity must be a whole number of at least 1").optional()
});

exports.updateCartItemSchema = z.object({
    quantity: z.string().regex(/^[1-9]\d*$/, "quantity must be a whole number of at least 1")
});