// src/modules/bookings/booking.routes.js
const express = require('express');
const router = express.Router();
const bookingController = require('./booking.controller');
const validate = require('../../middlewares/validate.middleware');
const { createBookingSchema } = require('./booking.schema');
const { uploadMedia } = require('../../middlewares/upload.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');

// PRIVATE Route: only  STUDENT can access
router.post(
    '/',
    requireAuth,
    restrictTo('STUDENT'),
    uploadMedia.single('id_proof'), 
    validate(createBookingSchema),
    bookingController.createBooking
);

router.get(
    '/my-bookings',
    requireAuth,
    restrictTo('STUDENT'),
    bookingController.getMyBookings
);

module.exports = router;