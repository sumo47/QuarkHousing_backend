// src/modules/owner/owner.routes.js
const express = require('express');
const router = express.Router();
const ownerController = require('./owner.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { uploadMedia } = require('../../middlewares/upload.middleware');
const {
    updatePropertySchema,
    togglePropertyStatusSchema,
    updateOwnerProfileSchema,
    kycSchema,
    bankDetailsSchema,
    payoutRequestSchema
} = require('./owner.schema');

// Every route in this module is a logged-in Owner only
router.use(requireAuth, restrictTo('OWNER'));

// --- Overview ---
router.get('/overview', ownerController.getOverview);

// --- My Properties ---
router.get('/properties', ownerController.getMyProperties);
router.get('/properties/:id', ownerController.getPropertyById);
router.patch(
    '/properties/:id',
    uploadMedia.array('room_images', 15),
    validate(updatePropertySchema),
    ownerController.updateProperty
);
router.patch(
    '/properties/:id/status',
    validate(togglePropertyStatusSchema),
    ownerController.togglePropertyStatus
);
router.delete('/properties/:id', ownerController.deleteProperty);

// --- Bookings ---
router.get('/bookings', ownerController.getBookings);
router.get('/bookings/:id', ownerController.getBookingDetails);
router.patch('/bookings/:id/accept', ownerController.acceptBooking);
router.patch('/bookings/:id/reject', ownerController.rejectBooking);

// --- Earnings & Payouts ---
router.get('/earnings', ownerController.getEarnings);
router.post('/payouts', validate(payoutRequestSchema), ownerController.requestPayout); //needs admin
router.put('/bank-details', validate(bankDetailsSchema), ownerController.upsertBankDetails);


// --- Reviews ---
router.get('/reviews', ownerController.getMyReviews);

// --- Profile & KYC ---
router.get('/profile', ownerController.getOwnerProfile);
router.patch('/profile', validate(updateOwnerProfileSchema), ownerController.updateOwnerProfile);
router.post( //needs admin
    '/kyc',
    uploadMedia.fields([
        { name: 'aadhaar_doc', maxCount: 1 },
        { name: 'pan_doc', maxCount: 1 },
        { name: 'address_proof', maxCount: 1 }
    ]),
    validate(kycSchema),
    ownerController.submitKyc
);

module.exports = router;