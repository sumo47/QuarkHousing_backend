// src/modules/reviews/reviews.schema.js
const { z } = require('zod');

exports.createReviewSchema = z.object({
    property_id: z.string().regex(/^\d+$/, "property_id must be a valid number"),
    rating: z.string().regex(/^[1-5]$/, "rating must be a whole number between 1 and 5"),
    comment: z.string().max(1000, "Comment cannot exceed 1000 characters").optional()
});

exports.createTiffinReviewSchema = z.object({
    tiffin_service_id: z.string().regex(/^\d+$/, "tiffin_service_id must be a valid number"),
    rating: z.string().regex(/^[1-5]$/, "rating must be a whole number between 1 and 5"),
    comment: z.string().max(1000, "Comment cannot exceed 1000 characters").optional()
});