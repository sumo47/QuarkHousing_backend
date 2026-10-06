// src/modules/subscriptions/subscriptions.schema.js
const { z } = require('zod');

exports.purchaseSubscriptionSchema = z.object({
    tiffin_service_id: z.string().regex(/^\d+$/, "tiffin_service_id must be a valid number"),
    plan_id: z.string().regex(/^\d+$/, "plan_id must be a valid number")
});

exports.updateCalendarSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    preferences: z
        .array(
            z.object({
                meal_type: z.enum(['LUNCH', 'DINNER']),
                preference: z.enum(['WILL_HAVE', 'SKIP', 'NOT_SURE'])
            })
        )
        .min(1, "At least one meal preference is required")
        .max(2, "A day only has Lunch and Dinner to set")
});