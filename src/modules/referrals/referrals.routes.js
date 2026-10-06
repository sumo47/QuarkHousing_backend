// src/modules/referrals/referrals.routes.js
const express = require('express');
const router = express.Router();
const referralsController = require('./referrals.controller');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');

router.use(requireAuth, restrictTo('STUDENT'));

//USED TO GET REFERRAL CODE
router.get('/my-code', referralsController.getMyReferralCode);
router.get('/', referralsController.getMyReferrals);

module.exports = router;