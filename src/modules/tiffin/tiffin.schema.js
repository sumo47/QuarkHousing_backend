const { z } = require('zod');

const isTrueFalseString = z.string().optional();

exports.createTiffinServiceSchema = z.object({
    // Basic Info
    name: z.string().min(3).max(150),
    description: z.string().max(1000).optional(),
    veg_type: z.enum(['VEG', 'NON_VEG', 'BOTH']),
    breakfast_available: isTrueFalseString,
    lunch_available: isTrueFalseString,
    dinner_available: isTrueFalseString,
    price_per_meal: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid amount"),
    delivery_start_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM (24hr)").optional(),
    delivery_end_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM (24hr)").optional(),

    // Address
    address_line: z.string().min(5),
    locality: z.string().min(2),
    landmark: z.string().optional(),
    city: z.string().min(2),
    state: z.string().min(2),
    pincode: z.string().length(6, "Must be a 6-digit pincode"),
    google_maps_url: z.string().url().optional()
});

exports.updateTiffinServiceSchema = exports.createTiffinServiceSchema.partial();

exports.toggleStatusSchema = z.object({
    is_active: z.enum(['true', 'false', '1', '0'])
});

exports.rejectSchema = z.object({
    rejection_reason: z.string().min(3).max(255)
});

exports.createPlanSchema = z.object({
    plan_type: z.enum(['WEEKLY', 'MONTHLY']),
    meal_coverage: z.enum(['LUNCH', 'DINNER', 'BOTH']),
    price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid amount")
});

exports.upsertMenuSchema = z.object({
    menu_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
    meal_type: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']),
    items: z.string().min(3).max(1000)
});