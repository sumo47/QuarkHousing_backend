// src/modules/vendor/vendor.schema.js
const { z } = require('zod');

exports.cancelOrderSchema = z.object({
    reason: z.string().min(3, "reason must be at least 3 characters").max(255)
});

exports.updateProfileSchema = z.object({
    full_name: z.string().min(2).max(100).optional(),
    phone: z.string().min(10).max(15).optional()
});

exports.updateSettingsSchema = z.object({
    accepting_orders: z.enum(['true', 'false', '1', '0'])
});

exports.bulkMenuScheduleSchema = z.object({
    days: z
        .array(
            z.object({
                menu_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "menu_date must be YYYY-MM-DD"),
                meal_type: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']),
                items: z.string().min(3).max(1000)
            })
        )
        .min(1, "At least one day is required")
        .max(31, "Cannot schedule more than 31 days at once")
});