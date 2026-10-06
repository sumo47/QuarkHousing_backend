const { z } = require('zod');
const { googleMapsUrlSchema } = require('../properties/property.schema');

// All fields optional -> Owner can edit just the parts they want to change.
// Mirrors createPropertySchema (properties/property.schema.js) but nothing is required.
exports.updatePropertySchema = z.object({
    title: z.string().min(5).max(150).optional(),
    property_type: z.enum(['EXAM_SPECIAL', 'SINGLE', 'SHARED', '1BHK']).optional(),
    gender_preference: z.enum(['MALE', 'FEMALE', 'BOTH']).optional(),
    monthly_rent: z.string().regex(/^\d+$/, "Must be a valid amount").optional(),
    confirmation_payment: z.string().regex(/^\d+$/, "Must be a valid amount").optional(),
    distance_from_college: z.string().optional(),

    address_line: z.string().min(5).optional(),
    locality: z.string().min(2).optional(),
    landmark: z.string().optional(),
    city: z.string().min(2).optional(),
    state: z.string().min(2).optional(),
    pincode: z.string().length(6, "Must be a 6-digit pincode").optional(),
    google_maps_url: googleMapsUrlSchema,

    attached_bathroom: z.string().optional(),
    wifi: z.string().optional(),
    quark_tiffin_available: z.string().optional(),
    veg_allowed: z.string().optional(),
    non_veg_allowed: z.string().optional(),
    parking: z.string().optional(),
    max_capacity: z.string().regex(/^\d+$/).optional(),
    delete_media_urls: z.union([z.string(), z.array(z.string())]).optional()
});

exports.togglePropertyStatusSchema = z.object({
    is_active: z.enum(['true', 'false', '1', '0'])
});

exports.updateOwnerProfileSchema = z.object({
    full_name: z.string().min(2).max(100).optional(),
    phone: z.string().min(10).max(15).optional()
});

exports.kycSchema = z.object({
    aadhaar_number: z.string().regex(/^\d{12}$/, "Aadhaar must be a 12-digit number").optional(),
    pan_number: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Invalid PAN format").optional()
});

exports.bankDetailsSchema = z.object({
    preferred_method: z.enum(['BANK', 'UPI']),
    account_holder_name: z.string().min(2).optional(),
    account_number: z.string().min(6).optional(),
    ifsc_code: z.string().min(4).optional(),
    upi_id: z.string().min(3).optional()
}).refine(
    (data) => data.preferred_method !== 'UPI' || !!data.upi_id,
    { message: 'upi_id is required when preferred_method is UPI', path: ['upi_id'] }
).refine(
    (data) => data.preferred_method !== 'BANK' || (!!data.account_number && !!data.ifsc_code && !!data.account_holder_name),
    { message: 'account_holder_name, account_number and ifsc_code are required when preferred_method is BANK', path: ['account_number'] }
);

exports.payoutRequestSchema = z.object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid amount")
});