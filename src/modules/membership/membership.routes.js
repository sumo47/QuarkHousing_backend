// src/modules/membership/membership.routes.js
const express = require('express');
const router = express.Router();
const membershipController = require('./membership.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { purchaseMembershipSchema } = require('./membership.schema');

router.get('/plans', membershipController.getPlans); // public, so a vendor can see pricing before even registering

router.post('/purchase', requireAuth, restrictTo('VENDOR'), validate(purchaseMembershipSchema), membershipController.purchaseMembership);
router.get('/my-status', requireAuth, restrictTo('VENDOR'), membershipController.getMyMembershipStatus);
router.get('/history', requireAuth, restrictTo('VENDOR'), membershipController.getMembershipHistory);

module.exports = router;