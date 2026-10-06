// src/modules/reviews/reviews.routes.js
const express = require('express');
const router = express.Router();
const reviewsController = require('./reviews.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { createReviewSchema ,createTiffinReviewSchema} = require('./reviews.schema');

// --- Property Reviews ---

// Public: anyone can view a property's reviews (used on the property detail page)
router.get('/property/:propertyId', reviewsController.getPropertyReviews);
// Private: only a logged-in STUDENT with a confirmed/completed booking can review
router.post('/', requireAuth, restrictTo('STUDENT'), validate(createReviewSchema), reviewsController.createReview);

// --- Tiffin Reviews ---

// Public: anyone can view a tiffin service's reviews (used on the tiffin detail page)
router.get('/tiffin/:tiffinServiceId', reviewsController.getTiffinReviews);
// Private: only a logged-in STUDENT with a real order or subscription can review
router.post('/tiffin', requireAuth, restrictTo('STUDENT'), validate(createTiffinReviewSchema), reviewsController.createTiffinReview);

module.exports = router;