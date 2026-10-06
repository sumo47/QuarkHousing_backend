// src/modules/vendor/vendor.routes.js
const express = require('express');
const router = express.Router();
const vendorController = require('./vendor.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { cancelOrderSchema, updateProfileSchema, updateSettingsSchema, bulkMenuScheduleSchema } = require('./vendor.schema');

// Every route in this module is a logged-in Vendor only
router.use(requireAuth, restrictTo('VENDOR'));

// --- Overview ---
router.get('/overview', vendorController.getOverview);

// --- Orders ---
router.get('/orders', vendorController.getOrders);
router.get('/orders/:id', vendorController.getOrderDetails);
router.patch('/orders/:id/accept', vendorController.markOrderAccepted);
router.patch('/orders/:id/deliver', vendorController.markOrderDelivered);
router.patch('/orders/:id/cancel', validate(cancelOrderSchema), vendorController.cancelOrder);

// --- Subscriptions ---
router.get('/subscriptions', vendorController.getSubscriptions);
router.get('/subscriptions/:id', vendorController.getSubscriptionDetails);

// --- Reviews ---
router.get('/reviews', vendorController.getReviews);

// --- Earnings ---
router.get('/earnings', vendorController.getEarnings);

// --- Profile ---
router.get('/profile', vendorController.getProfile);
router.patch('/profile', validate(updateProfileSchema), vendorController.updateProfile);

// --- Settings ---
router.get('/settings', vendorController.getSettings);
router.patch('/settings', validate(updateSettingsSchema), vendorController.updateSettings); //After Turning this off vendors listings are hidden to customers 

// --- Meal Schedule (plan menus multiple days ahead) ---
router.get('/menu-schedule/:tiffinServiceId', vendorController.getMenuSchedule);
router.post('/menu-schedule/:tiffinServiceId/bulk', validate(bulkMenuScheduleSchema), vendorController.bulkSetMenuSchedule);

// NOTE: "My Menu" (single-day add/update) already exists at PUT
// /api/v1/tiffin/:id/menu, and full listing management under
// /api/v1/tiffin -- not duplicated here. Membership status/purchase already
// exists under /api/v1/membership. This dashboard's Overview pulls a
// summary of both for convenience.

module.exports = router;