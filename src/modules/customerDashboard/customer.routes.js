// src/modules/customer/customer.routes.js
const express = require('express');
const router = express.Router();
const customerController = require('./customer.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { updateProfileSchema, createAddressSchema, updateAddressSchema, addToWishlistSchema, changePasswordSchema, updateNotificationsSchema } = require('./customer.schema');

router.use(requireAuth, restrictTo('STUDENT'));

// --- Overview ---
router.get('/overview', customerController.getOverview);

// --- Profile ---
router.get('/profile', customerController.getProfile);
router.patch('/profile', validate(updateProfileSchema), customerController.updateProfile);

// --- Timeline ---
router.get('/timeline', customerController.getTimeline);

// --- My Reviews ---
router.get('/reviews', customerController.getMyReviews);

// --- Saved Addresses ---
router.get('/addresses', customerController.getAddresses);
router.post('/addresses', validate(createAddressSchema), customerController.createAddress);
router.patch('/addresses/:id', validate(updateAddressSchema), customerController.updateAddress);
router.delete('/addresses/:id', customerController.deleteAddress);

// --- Wishlist ---
router.get('/wishlist', customerController.getWishlist);
router.post('/wishlist', validate(addToWishlistSchema), customerController.addToWishlist);
router.delete('/wishlist/:id', customerController.removeFromWishlist);

// --- Notifications ---
router.get('/notifications', customerController.getNotificationPreferences);
router.patch('/notifications', validate(updateNotificationsSchema), customerController.updateNotificationPreferences);

// --- Account Settings ---
router.patch('/change-password', validate(changePasswordSchema), customerController.changePassword);
router.delete('/account', customerController.deleteAccount);

// NOTE: Wallet (/api/v1/wallet), Referrals (/api/v1/referrals), and
// Coupons (/api/v1/coupons) already exist as their own modules -- not
// duplicated here. This dashboard's Overview pulls a summary of wallet
// balance and referral rewards for convenience.

module.exports = router;