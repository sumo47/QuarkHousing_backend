// src/modules/admin/adminAuth.controller.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../config/db');
const { isEmailAllowlistedAdmin } = require('../../utils/adminAuth');
const otpManager = require('../../utils/otpManager');
const { blocklistToken, generateAuthToken } = require('../../utils/token');
const { recordAdminLoginFailure, recordAdminLoginSuccess } = require('../../middlewares/adminRateLimit.middleware');

/**
 * Normalizes email address (trimmed and lowercase).
 */
function normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
}

// =============================================================================
// 1. ADMIN REGISTRATION / PROVISIONING
// =============================================================================

// @route   POST /api/v1/admin/auth/send-register-otp
// @access  Public (Enforces ADMIN_IDS allowlist)
exports.sendRegisterOtp = async (req, res, next) => {
    try {
        const email = normalizeEmail(req.body.email);

        // 1. Authoritative check: Is email in ADMIN_IDS?
        if (!isEmailAllowlistedAdmin(email)) {
            return res.status(403).json({
                status: 'error',
                message: 'This email is not authorized for administrator registration.'
            });
        }

        // 2. Check if an account already exists for this email
        const [existing] = await db.query(
            'SELECT id, role FROM users WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'An account with this email already exists. Please proceed to Admin Login.'
            });
        }

        // 3. Issue and send secure OTP (DB-authoritative)
        await otpManager.generateAndSendOtp({
            email,
            purpose: 'ADMIN_REGISTER',
            subject: 'Quark Housing - Admin Account Verification Code',
            actionDescription: 'verify your email and create your administrator account'
        });

        res.status(200).json({
            status: 'success',
            message: 'Verification OTP sent to your authorized admin email address.'
        });

    } catch (error) {
        if (error.statusCode === 429) {
            return res.status(429).json({ status: 'error', message: error.message });
        }
        if (error.statusCode === 502) {
            return res.status(502).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

// @route   POST /api/v1/admin/auth/register
// @access  Public (Enforces ADMIN_IDS + Verified OTP)
exports.registerAdmin = async (req, res, next) => {
    try {
        const { full_name, email, password, otp, phone } = req.body;
        const normEmail = normalizeEmail(email);

        // 1. Authoritative check: Is email in ADMIN_IDS?
        if (!isEmailAllowlistedAdmin(normEmail)) {
            return res.status(403).json({
                status: 'error',
                message: 'This email is not authorized for administrator registration.'
            });
        }

        // 2. Authoritatively verify single-use OTP for ADMIN_REGISTER
        const otpResult = await otpManager.verifyOtp({
            email: normEmail,
            otp,
            purpose: 'ADMIN_REGISTER'
        });

        if (!otpResult.valid) {
            return res.status(400).json({
                status: 'error',
                message: otpResult.message || 'Invalid or expired OTP.'
            });
        }

        // 3. Check for existing user (race-condition protection)
        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ?',
            [normEmail]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'An account with this email already exists. Please login instead.'
            });
        }

        // 4. Hash password securely
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const adminPhone = phone ? phone.trim() : null;

        // 5. Authoritative insert into users table with email_verified_at
        const [result] = await db.query(
            `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
             VALUES (?, ?, ?, ?, 'ADMIN', NOW())`,
            [full_name.trim(), normEmail, adminPhone, password_hash]
        );

        res.status(201).json({
            status: 'success',
            message: 'Administrator account created successfully. Please login with your password and two-factor code.',
            data: {
                user: {
                    id: result.insertId,
                    full_name: full_name.trim(),
                    email: normEmail,
                    role: 'ADMIN'
                }
            }
        });

    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 2. ADMIN LOGIN (PASSWORD + OTP TWO-FACTOR AUTH)
// =============================================================================

// @route   POST /api/v1/admin/auth/login-init
// @access  Public (Protected by adminLoginRateLimiter)
exports.loginInit = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const normEmail = normalizeEmail(email);

        // 1. Authoritative check: Is email in ADMIN_IDS?
        if (!isEmailAllowlistedAdmin(normEmail)) {
            recordAdminLoginFailure(req, normEmail);
            return res.status(401).json({ status: 'error', message: 'Invalid admin credentials' });
        }

        // 2. Check if ADMIN user exists
        const [users] = await db.query('SELECT * FROM users WHERE email = ? AND role = "ADMIN"', [normEmail]);
        if (users.length === 0) {
            recordAdminLoginFailure(req, normEmail);
            return res.status(401).json({ status: 'error', message: 'Invalid admin credentials' });
        }

        const user = users[0];

        // 3. Check account status
        if (user.deleted_at) {
            return res.status(401).json({ status: 'error', message: 'This account has been deleted' });
        }
        if (user.is_suspended) {
            return res.status(401).json({ status: 'error', message: 'This account has been suspended' });
        }

        // 4. Verify password hash
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            recordAdminLoginFailure(req, normEmail);
            return res.status(401).json({ status: 'error', message: 'Invalid admin credentials' });
        }

        // Credentials are valid -> reset rate limit failures
        recordAdminLoginSuccess(req, normEmail);

        // 5. Create short-lived challenge identifier tied to this login session
        const challengeId = crypto.randomUUID();

        // 6. Generate and send 2FA OTP tied to this challenge
        await otpManager.generateAndSendOtp({
            email: normEmail,
            purpose: 'ADMIN_LOGIN',
            challengeId,
            subject: 'Quark Housing - Admin Login Two-Factor Code',
            actionDescription: 'authenticate your admin session'
        });

        // 7. Step 1 complete: Password alone NEVER issues JWT
        res.status(200).json({
            status: 'success',
            message: 'Credentials verified. Two-factor authentication code sent to your admin email.',
            step: 'OTP_REQUIRED',
            challenge_id: challengeId
        });

    } catch (error) {
        if (error.statusCode === 429) {
            return res.status(429).json({ status: 'error', message: error.message });
        }
        if (error.statusCode === 502) {
            return res.status(502).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

// @route   POST /api/v1/admin/auth/login-verify
// @access  Public
exports.loginVerify = async (req, res, next) => {
    try {
        const { email, otp, challenge_id } = req.body;
        const normEmail = normalizeEmail(email);

        // 1. Authoritative check: Is email in ADMIN_IDS?
        if (!isEmailAllowlistedAdmin(normEmail)) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Email is not in the admin allowlist.'
            });
        }

        // 2. Fetch admin user
        const [users] = await db.query('SELECT * FROM users WHERE email = ? AND role = "ADMIN"', [normEmail]);
        if (users.length === 0) {
            return res.status(401).json({ status: 'error', message: 'Invalid admin credentials' });
        }

        const user = users[0];

        if (user.deleted_at || user.is_suspended) {
            return res.status(401).json({ status: 'error', message: 'This account is not active' });
        }

        // 3. Authoritatively verify OTP for ADMIN_LOGIN bound to challenge_id if supplied
        const otpResult = await otpManager.verifyOtp({
            email: normEmail,
            otp,
            purpose: 'ADMIN_LOGIN',
            challengeId: challenge_id || null
        });

        if (!otpResult.valid) {
            return res.status(400).json({
                status: 'error',
                message: otpResult.message || 'Invalid or expired OTP code.'
            });
        }

        // 4. Issue authoritative JWT access token using shared utility
        const token = generateAuthToken({
            id: user.id,
            role: user.role,
            email: user.email
        });

        const { password_hash, reset_otp, reset_otp_expires, ...safeUser } = user;

        res.status(200).json({
            status: 'success',
            message: 'Admin authentication successful',
            token,
            data: {
                user: safeUser
            }
        });

    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/admin/auth/login-resend-otp
// @access  Public (Protected by adminLoginRateLimiter)
exports.loginResendOtp = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const normEmail = normalizeEmail(email);

        if (!isEmailAllowlistedAdmin(normEmail)) {
            recordAdminLoginFailure(req, normEmail);
            return res.status(401).json({ status: 'error', message: 'Invalid admin credentials' });
        }

        const [users] = await db.query('SELECT * FROM users WHERE email = ? AND role = "ADMIN"', [normEmail]);
        if (users.length === 0) {
            recordAdminLoginFailure(req, normEmail);
            return res.status(401).json({ status: 'error', message: 'Invalid admin credentials' });
        }

        const user = users[0];
        if (user.deleted_at || user.is_suspended) {
            return res.status(401).json({ status: 'error', message: 'Account not active' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            recordAdminLoginFailure(req, normEmail);
            return res.status(401).json({ status: 'error', message: 'Invalid admin credentials' });
        }

        recordAdminLoginSuccess(req, normEmail);

        const challengeId = crypto.randomUUID();

        await otpManager.generateAndSendOtp({
            email: normEmail,
            purpose: 'ADMIN_LOGIN',
            challengeId,
            subject: 'Quark Housing - Admin Login Two-Factor Code (Resent)',
            actionDescription: 'authenticate your admin session'
        });

        res.status(200).json({
            status: 'success',
            message: 'New two-factor code sent to registered admin email.',
            challenge_id: challengeId
        });

    } catch (error) {
        if (error.statusCode === 429) {
            return res.status(429).json({ status: 'error', message: error.message });
        }
        if (error.statusCode === 502) {
            return res.status(502).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

// =============================================================================
// 3. ADMIN FORGOT & RESET PASSWORD
// =============================================================================

// @route   POST /api/v1/admin/auth/forgot-password
// @access  Public
exports.adminForgotPassword = async (req, res, next) => {
    try {
        const email = normalizeEmail(req.body.email);

        // Security best practice: Check allowlist without leaking arbitrary email status
        if (!isEmailAllowlistedAdmin(email)) {
            return res.status(200).json({
                status: 'success',
                message: 'If this email is an authorized administrator, an OTP has been sent.'
            });
        }

        const [users] = await db.query('SELECT id FROM users WHERE email = ? AND role = "ADMIN"', [email]);
        if (users.length === 0) {
            return res.status(200).json({
                status: 'success',
                message: 'If this email is an authorized administrator, an OTP has been sent.'
            });
        }

        await otpManager.generateAndSendOtp({
            email,
            purpose: 'ADMIN_RESET_PASSWORD',
            subject: 'Quark Housing - Admin Password Reset Code',
            actionDescription: 'reset your administrator account password'
        });

        res.status(200).json({
            status: 'success',
            message: 'If this email is an authorized administrator, an OTP has been sent.'
        });

    } catch (error) {
        if (error.statusCode === 429) {
            return res.status(429).json({ status: 'error', message: error.message });
        }
        if (error.statusCode === 502) {
            return res.status(502).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

// @route   POST /api/v1/admin/auth/reset-password
// @access  Public
exports.adminResetPassword = async (req, res, next) => {
    try {
        const { email, otp, new_password } = req.body;
        const normEmail = normalizeEmail(email);

        if (!isEmailAllowlistedAdmin(normEmail)) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Email is not in the admin allowlist.'
            });
        }

        const [users] = await db.query('SELECT * FROM users WHERE email = ? AND role = "ADMIN"', [normEmail]);
        if (users.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Invalid password reset request.' });
        }

        const user = users[0];

        // Authoritatively verify OTP
        const otpResult = await otpManager.verifyOtp({
            email: normEmail,
            otp,
            purpose: 'ADMIN_RESET_PASSWORD'
        });

        if (!otpResult.valid) {
            return res.status(400).json({
                status: 'error',
                message: otpResult.message || 'Invalid or expired OTP code.'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(new_password, salt);

        // Update password AND set password_changed_at = NOW()
        // This invalidates all existing JWT tokens across all sessions immediately
        await db.query(
            `UPDATE users 
             SET password_hash = ?, password_changed_at = NOW(), reset_otp = NULL, reset_otp_expires = NULL 
             WHERE id = ?`,
            [password_hash, user.id]
        );

        res.status(200).json({
            status: 'success',
            message: 'Administrator password reset successfully. All previous sessions have been invalidated. You can now login with your new credentials.'
        });

    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 4. ADMIN PROFILE MANAGEMENT
// =============================================================================

// @route   GET /api/v1/admin/profile
// @access  Private (ADMIN)
exports.getAdminProfile = async (req, res, next) => {
    try {
        const adminId = req.user.id;

        const [users] = await db.query(
            `SELECT id, full_name, email, phone, role, email_verified_at, password_changed_at,
                    is_suspended, deleted_at, created_at, updated_at 
             FROM users WHERE id = ? AND role = "ADMIN"`,
            [adminId]
        );

        if (users.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Administrator account not found.' });
        }

        const user = users[0];

        if (!isEmailAllowlistedAdmin(user.email)) {
            return res.status(403).json({
                status: 'error',
                message: 'Administrator authorization revoked. Email is not in the admin allowlist.'
            });
        }

        const emailVerifiedAt = user.email_verified_at || user.created_at;

        res.status(200).json({
            status: 'success',
            data: {
                admin: {
                    id: user.id,
                    full_name: user.full_name,
                    email: user.email,
                    phone: user.phone || null,
                    role: user.role,
                    email_verified: !!emailVerifiedAt,
                    email_verified_at: emailVerifiedAt,
                    is_suspended: !!user.is_suspended,
                    account_status: user.is_suspended ? 'SUSPENDED' : (user.deleted_at ? 'DELETED' : 'ACTIVE'),
                    created_at: user.created_at,
                    updated_at: user.updated_at
                }
            }
        });

    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/profile
// @access  Private (ADMIN)
exports.updateAdminProfile = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { full_name, phone } = req.body;

        const [users] = await db.query('SELECT * FROM users WHERE id = ? AND role = "ADMIN"', [adminId]);
        if (users.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Administrator account not found.' });
        }

        const user = users[0];

        if (!isEmailAllowlistedAdmin(user.email)) {
            return res.status(403).json({
                status: 'error',
                message: 'Administrator authorization revoked. Email is not in the admin allowlist.'
            });
        }

        // Only full_name and phone may be modified; ignore or preserve everything else
        const updatedName = full_name ? full_name.trim() : user.full_name;
        const updatedPhone = phone !== undefined ? (phone ? phone.trim() : null) : user.phone;

        await db.query(
            'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
            [updatedName, updatedPhone, adminId]
        );

        res.status(200).json({
            status: 'success',
            message: 'Admin profile updated successfully.',
            data: {
                admin: {
                    id: user.id,
                    full_name: updatedName,
                    email: user.email,
                    phone: updatedPhone,
                    role: user.role,
                    email_verified: true,
                    email_verified_at: user.email_verified_at || user.created_at,
                    account_status: 'ACTIVE',
                    created_at: user.created_at
                }
            }
        });

    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 5. ADMIN CHANGE PASSWORD (CURRENT + NEW + OTP)
// =============================================================================

// @route   POST /api/v1/admin/change-password/send-otp
// @access  Private (ADMIN)
exports.sendChangePasswordOtp = async (req, res, next) => {
    try {
        const email = req.user.email;

        if (!isEmailAllowlistedAdmin(email)) {
            return res.status(403).json({
                status: 'error',
                message: 'Administrator authorization revoked. Email is not in the admin allowlist.'
            });
        }

        await otpManager.generateAndSendOtp({
            email,
            purpose: 'ADMIN_PASSWORD_CHANGE',
            subject: 'Quark Housing - Admin Password Change Verification Code',
            actionDescription: 'authorize a password change for your administrator account'
        });

        res.status(200).json({
            status: 'success',
            message: 'Password change verification code sent to your registered admin email.'
        });

    } catch (error) {
        if (error.statusCode === 429) {
            return res.status(429).json({ status: 'error', message: error.message });
        }
        if (error.statusCode === 502) {
            return res.status(502).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

// @route   POST /api/v1/admin/change-password
// @access  Private (ADMIN)
exports.changeAdminPassword = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const email = req.user.email;
        const { current_password, new_password, otp } = req.body;

        if (!isEmailAllowlistedAdmin(email)) {
            return res.status(403).json({
                status: 'error',
                message: 'Administrator authorization revoked. Email is not in the admin allowlist.'
            });
        }

        // 1. Fetch current password hash
        const [users] = await db.query('SELECT password_hash FROM users WHERE id = ? AND role = "ADMIN"', [adminId]);
        if (users.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Admin account not found.' });
        }

        const user = users[0];

        // 2. Verify current password
        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ status: 'error', message: 'Current password is incorrect.' });
        }

        // 3. Authoritatively verify OTP
        const otpResult = await otpManager.verifyOtp({
            email,
            otp,
            purpose: 'ADMIN_PASSWORD_CHANGE'
        });

        if (!otpResult.valid) {
            return res.status(400).json({
                status: 'error',
                message: otpResult.message || 'Invalid or expired OTP code.'
            });
        }

        // 4. Hash new password
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(new_password, salt);

        // 5. Update users table setting password_hash AND password_changed_at = NOW()
        // This causes requireAuth to immediately invalidate ALL tokens issued prior to this timestamp
        await db.query(
            'UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?',
            [newHash, adminId]
        );

        // 6. Explicitly blocklist the current active token
        const rawToken = req.headers.authorization?.split(' ')[1];
        if (rawToken) {
            await blocklistToken(adminId, rawToken);
        }

        res.status(200).json({
            status: 'success',
            message: 'Password changed successfully. All active administrator sessions have been terminated. Please login again with your new password.'
        });

    } catch (error) {
        next(error);
    }
};
