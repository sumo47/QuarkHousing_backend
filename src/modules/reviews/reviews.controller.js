// src/modules/reviews/reviews.controller.js
const db = require('../../config/db');

// Booking statuses that count as a "real stay" a customer is allowed to review.
const REVIEW_ELIGIBLE_STATUSES = ['CONFIRMED', 'COMPLETED'];

// @route   POST /api/v1/reviews
// @access  Private (STUDENT)
exports.createReview = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { property_id, rating, comment } = req.body;

        // 1. Property must exist
        const [[property]] = await db.query(`SELECT id FROM properties WHERE id = ?`, [property_id]);
        if (!property) {
            return res.status(404).json({ status: 'error', message: 'Property not found' });
        }

        // 2. Verify the reviewer actually has a confirmed/completed booking on this property.
        const [eligibleBookings] = await db.query(
            `SELECT id FROM room_bookings
             WHERE property_id = ? AND student_id = ? AND status IN (?)`,
            [property_id, customerId, REVIEW_ELIGIBLE_STATUSES]
        );

        if (eligibleBookings.length === 0) {
            return res.status(403).json({
                status: 'error',
                message: 'You can only review a property after a confirmed or completed stay there.'
            });
        }

        // 3. Insert (unique constraint on property_id + customer_id stops duplicates)
        try {
            const [result] = await db.query(
                `INSERT INTO property_reviews (property_id, customer_id, rating, comment) VALUES (?, ?, ?, ?)`,
                [property_id, customerId, rating, comment || null]
            );

            res.status(201).json({
                status: 'success',
                message: 'Review submitted successfully',
                data: { review_id: result.insertId }
            });
        } catch (dbError) {
            if (dbError.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ status: 'error', message: 'You have already reviewed this property' });
            }
            throw dbError;
        }
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/reviews/property/:propertyId
// @access  Public
exports.getPropertyReviews = async (req, res, next) => {
    try {
        const { propertyId } = req.params;

        const [reviews] = await db.query(
            `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
             FROM property_reviews r
             JOIN users u ON r.customer_id = u.id
             WHERE r.property_id = ?
             ORDER BY r.created_at DESC`,
            [propertyId]
        );

        const [[summary]] = await db.query(
            `SELECT COUNT(*) AS total_reviews, COALESCE(ROUND(AVG(rating), 1), 0) AS average_rating
             FROM property_reviews WHERE property_id = ?`,
            [propertyId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                average_rating: Number(summary.average_rating),
                total_reviews: summary.total_reviews,
                reviews
            }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// TIFFIN REVIEWS
// =============================================================================
 
// Order statuses that count as "you actually received this tiffin" -- eligible to review
const ORDER_ELIGIBLE_STATUSES = ['CONFIRMED', 'DELIVERED'];
// Subscription statuses that count as "you're a real subscriber" -- also eligible
const SUBSCRIPTION_ELIGIBLE_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED'];
 
// @route   POST /api/v1/reviews/tiffin
// @access  Private (STUDENT)
exports.createTiffinReview = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { tiffin_service_id, rating, comment } = req.body;
 
        // 1. Tiffin service must exist
        const [[service]] = await db.query(`SELECT id FROM tiffin_services WHERE id = ?`, [tiffin_service_id]);
        if (!service) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found' });
        }
 
        // 2. Verify the reviewer has EITHER a real order OR a real subscription
        //    with this service -- either one is enough proof they actually used it.
        const [eligibleOrders] = await db.query(
            `SELECT id FROM tiffin_orders WHERE tiffin_service_id = ? AND customer_id = ? AND status IN (?)`,
            [tiffin_service_id, customerId, ORDER_ELIGIBLE_STATUSES]
        );
        const [eligibleSubscriptions] = await db.query(
            `SELECT id FROM tiffin_subscriptions WHERE tiffin_service_id = ? AND customer_id = ? AND status IN (?)`,
            [tiffin_service_id, customerId, SUBSCRIPTION_ELIGIBLE_STATUSES]
        );
 
        if (eligibleOrders.length === 0 && eligibleSubscriptions.length === 0) {
            return res.status(403).json({
                status: 'error',
                message: 'You can only review a tiffin service after ordering from it or subscribing to it.'
            });
        }
 
        // 3. Insert (unique constraint on tiffin_service_id + customer_id stops duplicates)
        try {
            const [result] = await db.query(
                `INSERT INTO tiffin_reviews (tiffin_service_id, customer_id, rating, comment) VALUES (?, ?, ?, ?)`,
                [tiffin_service_id, customerId, rating, comment || null]
            );
 
            res.status(201).json({
                status: 'success',
                message: 'Review submitted successfully',
                data: { review_id: result.insertId }
            });
        } catch (dbError) {
            if (dbError.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ status: 'error', message: 'You have already reviewed this tiffin service' });
            }
            throw dbError;
        }
    } catch (error) {
        next(error);
    }
};
 
// @route   GET /api/v1/reviews/tiffin/:tiffinServiceId
// @access  Public
exports.getTiffinReviews = async (req, res, next) => {
    try {
        const { tiffinServiceId } = req.params;
 
        const [reviews] = await db.query(
            `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
             FROM tiffin_reviews r
             JOIN users u ON r.customer_id = u.id
             WHERE r.tiffin_service_id = ?
             ORDER BY r.created_at DESC`,
            [tiffinServiceId]
        );
 
        const [[summary]] = await db.query(
            `SELECT COUNT(*) AS total_reviews, COALESCE(ROUND(AVG(rating), 1), 0) AS average_rating
             FROM tiffin_reviews WHERE tiffin_service_id = ?`,
            [tiffinServiceId]
        );
 
        res.status(200).json({
            status: 'success',
            data: {
                average_rating: Number(summary.average_rating),
                total_reviews: summary.total_reviews,
                reviews
            }
        });
    } catch (error) {
        next(error);
    }
};
 