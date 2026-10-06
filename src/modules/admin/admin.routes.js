// src/modules/admin/admin.routes.js
const express = require('express');
const router = express.Router();

// Controllers
const adminController = require('./admin.controller');
const adminAuthController = require('./adminAuth.controller');

// Middlewares
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');

// Schemas
const { rejectSchema } = require('../tiffin/tiffin.schema');
const {
    createCouponSchema,
    updateCouponSchema,
    rejectKycSchema,
    rejectPayoutSchema,
    suspendUserSchema
} = require('./admin.schema');
const {
    updateAdminProfileSchema,
    adminChangePasswordSchema
} = require('./adminAuth.validation');

// Every route in this module is ADMIN-only
router.use(requireAuth, restrictTo('ADMIN'));

// --- Platform Overview ---
router.get('/overview', adminController.getPlatformOverview);

// --- Tiffin Service Approval ---
router.get('/tiffin/pending', adminController.getPendingTiffinServices);
router.patch('/tiffin/:id/approve', adminController.approveTiffinService);
router.patch('/tiffin/:id/reject', validate(rejectSchema), adminController.rejectTiffinService);

// --- Coupon Management ---
router.get('/coupons', adminController.getAllCoupons);
router.post('/coupons', validate(createCouponSchema), adminController.createCoupon);
router.patch('/coupons/:id', validate(updateCouponSchema), adminController.updateCoupon);
router.delete('/coupons/:id', adminController.deleteCoupon);

// --- Owner KYC Verification ---
router.get('/kyc/pending', adminController.getPendingKyc);
router.patch('/kyc/:ownerId/verify', adminController.verifyKyc);
router.patch('/kyc/:ownerId/reject', validate(rejectKycSchema), adminController.rejectKyc);

// --- Owner Payout Processing ---
router.get('/payouts/pending', adminController.getPendingPayouts);
router.patch('/payouts/:id/mark-paid', adminController.markPayoutPaid);
router.patch('/payouts/:id/reject', validate(rejectPayoutSchema), adminController.rejectPayout);

// --- User Management ---
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserDetails);
router.patch('/users/:id/suspend', validate(suspendUserSchema), adminController.suspendUser);
router.patch('/users/:id/unsuspend', adminController.unsuspendUser);

// --- Admin Profile & Security ---
router.get('/profile', adminAuthController.getAdminProfile);
router.patch('/profile', validate(updateAdminProfileSchema), adminAuthController.updateAdminProfile);
router.post('/change-password/send-otp', adminAuthController.sendChangePasswordOtp);
router.post('/change-password', validate(adminChangePasswordSchema), adminAuthController.changeAdminPassword);

module.exports = router;