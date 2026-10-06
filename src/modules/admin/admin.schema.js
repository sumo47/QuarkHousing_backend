// src/modules/admin/admin.schema.js
const { z } = require('zod');

exports.createCouponSchema = z.object({
    code: z.string().min(3).max(30).trim().toUpperCase(),
    discount_type: z.enum(['FLAT', 'PERCENTAGE']),
    discount_value: z.string().regex(/^\d+(\.\d{1,2})?$/, "discount_value must be a valid amount"),
    min_order_amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "min_order_amount must be a valid amount").optional(),
    max_discount_amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "max_discount_amount must be a valid amount").optional(),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "valid_from must be YYYY-MM-DD"),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "valid_until must be YYYY-MM-DD")
});

exports.updateCouponSchema = z.object({
    discount_type: z.enum(['FLAT', 'PERCENTAGE']).optional(),
    discount_value: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    min_order_amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    max_discount_amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    is_active: z.enum(['true', 'false', '1', '0']).optional()
});

exports.rejectKycSchema = z.object({
    rejection_reason: z.string().min(3).max(255)
});

exports.rejectPayoutSchema = z.object({
    remarks: z.string().min(3).max(255)
});

exports.suspendUserSchema = z.object({
    reason: z.string().min(3).max(255)
});