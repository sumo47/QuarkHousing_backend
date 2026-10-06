const express = require('express');
const router = express.Router();
const authController = require('./auth.controller.js');
const { requireAuth } = require('../../middlewares/auth.middleware.js');

const validate = require('../../middlewares/validate.middleware.js');
const { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } = require('./auth.validation.js');

router.post('/register', validate(registerSchema),authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/logout', requireAuth, authController.logout);

// New Password Recovery Routes
router.post('/forgot-password',validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

module.exports = router;