const express = require('express');
const router = express.Router();
const propertyController = require('./property.controller.js');
const validate = require('../../middlewares/validate.middleware');
const { createPropertySchema } = require('./property.schema');
const { requireAuth, restrictTo, requireVerifiedOwner } = require('../../middlewares/auth.middleware');
const { uploadMedia } = require('../../middlewares/upload.middleware.js'); // Sprint 0 me banaya tha

// Route to Add a New Property
// 1. Authenticate -> 2. Restrict to Owner/Admin -> 3. Authoritative KYC Verification Guard -> 4. Upload up to 15 images -> 5. Validate Text Data -> 6. Controller
router.post(
    '/',
    requireAuth,
    restrictTo('OWNER', 'ADMIN'),
    requireVerifiedOwner,
    uploadMedia.array('room_images', 15),
    validate(createPropertySchema),
    propertyController.createProperty
);

// GET Routes for fetching properties (Public)
router.get('/search', propertyController.searchProperties);
router.get('/:id', propertyController.getPropertyDetails);

module.exports = router;