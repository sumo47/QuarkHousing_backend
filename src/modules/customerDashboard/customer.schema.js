// src/modules/customer/customer.schema.js
const { z } = require('zod');

exports.updateProfileSchema = z.object({
    full_name: z.string().min(2).max(100).optional(),
    phone: z.string().min(10).max(15).optional()
});

exports.createAddressSchema = z.object({
    label: z.string().min(2).max(50),
    address_line: z.string().min(5),
    locality: z.string().min(2),
    city: z.string().min(2),
    state: z.string().min(2),
    pincode: z.string().length(6, "Must be a 6-digit pincode"),
    is_default: z.enum(['true', 'false', '1', '0']).optional()
});

exports.updateAddressSchema = exports.createAddressSchema.partial();

exports.addToWishlistSchema = z.object({
    item_type: z.enum(['PROPERTY', 'TIFFIN']),
    item_id: z.string().regex(/^\d+$/, "item_id must be a valid number")
});

exports.changePasswordSchema = z.object({
    current_password: z.string().min(1, "current_password is required"),
    new_password: z.string().min(8, "new_password must be at least 8 characters")
});

exports.updateNotificationsSchema = z.object({
    booking_updates: z.enum(['true', 'false', '1', '0']).optional(),
    delivery_updates: z.enum(['true', 'false', '1', '0']).optional(),
    promotional_offers: z.enum(['true', 'false', '1', '0']).optional()
});