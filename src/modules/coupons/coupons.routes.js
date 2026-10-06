// src/modules/coupons/coupons.routes.js
const express = require('express');
const router = express.Router();
const couponsController = require('./coupons.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { validateCouponSchema } = require('./coupons.schema');

router.use(requireAuth, restrictTo('STUDENT'));

router.get('/my-coupons', couponsController.getMyCoupons);
router.post('/validate', validate(validateCouponSchema), couponsController.validateCoupon);

module.exports = router;