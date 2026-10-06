// src/modules/bookings/booking.schema.js
const { z } = require('zod');

exports.createBookingSchema = z.object({
    property_id: z.string().regex(/^\d+$/, "Valid Property ID is required"),
    full_name: z.string().min(2, "Full name is required"),
    email: z.string().email("Valid email is required"),
    phone: z.string().min(10, "Valid phone number is required"),
    check_in_date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Invalid check-in date" }),
    check_out_date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Invalid check-out date" }),
    purpose_of_stay: z.string().min(3).optional(),
    message: z.string().optional()
});