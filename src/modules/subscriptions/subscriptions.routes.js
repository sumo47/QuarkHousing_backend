// src/modules/subscriptions/subscriptions.routes.js
const express = require('express');
const router = express.Router();
const subscriptionsController = require('./subscriptions.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { purchaseSubscriptionSchema, updateCalendarSchema } = require('./subscriptions.schema');

// Every route in this module requires a logged-in STUDENT
router.use(requireAuth, restrictTo('STUDENT'));

// Fixed paths before '/:id'
router.get('/history', subscriptionsController.getSubscriptionHistory);

router.post('/', validate(purchaseSubscriptionSchema), subscriptionsController.purchaseSubscription);
router.get('/', subscriptionsController.getMySubscriptions);
router.get('/:id', subscriptionsController.getSubscriptionDetails);
router.patch('/:id/pause', subscriptionsController.pauseSubscription);
router.patch('/:id/resume', subscriptionsController.resumeSubscription);
router.post('/:id/renew', subscriptionsController.renewSubscription);

// --- Daily Preference Calendar ---
router.get('/:id/calendar', subscriptionsController.getCalendar);
router.put('/:id/calendar', validate(updateCalendarSchema), subscriptionsController.updateCalendar);

module.exports = router;