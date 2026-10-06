const { z } = require('zod');

const isValidGoogleMapsUrl = (val) => {
    if (!val || val.trim() === '') return true;
    try {
        const urlStr = val.startsWith('http://') || val.startsWith('https://') ? val.trim() : `https://${val.trim()}`;
        const parsed = new URL(urlStr);
        const host = parsed.hostname.toLowerCase();
        
        // Allowed Google domains and shortlinks:
        // maps.google.com, maps.app.goo.gl, goo.gl/maps, google.com/maps, etc.
        const isGoogleMapsHost =
            host === 'maps.google.com' ||
            host === 'maps.app.goo.gl' ||
            (host === 'goo.gl' && parsed.pathname.startsWith('/maps')) ||
            ((host === 'google.com' || host === 'www.google.com' || host.endsWith('.google.com') || /^([a-z0-9-]+\.)?google\.[a-z.]+$/.test(host)) &&
             parsed.pathname.includes('/maps'));

        return isGoogleMapsHost;
    } catch {
        return false;
    }
};

const googleMapsUrlSchema = z.string().trim().optional().refine(isValidGoogleMapsUrl, {
    message: 'Please enter a valid Google Maps URL (e.g., https://maps.google.com/... or https://maps.app.goo.gl/...)'
});

exports.isValidGoogleMapsUrl = isValidGoogleMapsUrl;
exports.googleMapsUrlSchema = googleMapsUrlSchema;

exports.createPropertySchema = z.object({
    // Basic Info
    title: z.string().min(5).max(150),
    property_type: z.enum(['EXAM_SPECIAL', 'SINGLE', 'SHARED', '1BHK']),
    gender_preference: z.enum(['MALE', 'FEMALE', 'BOTH']),
    monthly_rent: z.string().regex(/^\d+$/, "Must be a valid amount"), // Form data often comes as string
    confirmation_payment: z.string().regex(/^\d+$/, "Must be a valid amount"),
    distance_from_college: z.string().optional(),
    
    // Address
    address_line: z.string().min(5),
    locality: z.string().min(2),
    landmark: z.string().optional(),
    city: z.string().min(2),
    state: z.string().min(2),
    pincode: z.string().length(6, "Must be a 6-digit pincode"),
    google_maps_url: googleMapsUrlSchema,

    // Facilities (Send as strings 'true'/'false' or '1'/'0' from frontend formData)
    attached_bathroom: z.string().optional(),
    wifi: z.string().optional(),
    quark_tiffin_available: z.string().optional(),
    veg_allowed: z.string().optional(),
    non_veg_allowed: z.string().optional(),
    parking: z.string().optional(),
    max_capacity: z.string().regex(/^\d+$/)
});