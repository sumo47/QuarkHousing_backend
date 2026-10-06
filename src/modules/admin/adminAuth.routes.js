// src/modules/admin/adminAuth.routes.js
const express = require('express');
const router = express.Router();
const adminAuthController = require('./adminAuth.controller');
const validate = require('../../middlewares/validate.middleware');
const {
    sendRegisterOtpSchema,
    adminRegisterSchema,
    adminLoginInitSchema,
    adminLoginVerifySchema,
    adminForgotPasswordSchema,
    adminResetPasswordSchema
} = require('./adminAuth.validation');

const { adminLoginRateLimiter } = require('../../middlewares/adminRateLimit.middleware');

// --- Dedicated Admin Registration ---
router.post('/send-register-otp', validate(sendRegisterOtpSchema), adminAuthController.sendRegisterOtp);
router.post('/register', validate(adminRegisterSchema), adminAuthController.registerAdmin);

// --- Dedicated Admin Login (2FA) ---
router.post('/login-init', adminLoginRateLimiter, validate(adminLoginInitSchema), adminAuthController.loginInit);
router.post('/login-verify', validate(adminLoginVerifySchema), adminAuthController.loginVerify);
router.post('/login-resend-otp', adminLoginRateLimiter, validate(adminLoginInitSchema), adminAuthController.loginResendOtp);

// --- Dedicated Admin Password Recovery ---
router.post('/forgot-password', validate(adminForgotPasswordSchema), adminAuthController.adminForgotPassword);
router.post('/reset-password', validate(adminResetPasswordSchema), adminAuthController.adminResetPassword);

module.exports = router;
