const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../../config/db');
const { linkReferral } = require('../referrals/referrals.service');

exports.register = async (req, res, next) => {
    try {
        const { full_name, email, phone, password, role, referral_code } = req.body;

        // Authoritative security: ADMIN accounts cannot be created via standard user registration
        if (role === 'ADMIN') {
            return res.status(403).json({
                status: 'error',
                message: 'Admin accounts cannot be registered through this endpoint. Please use the dedicated admin provisioning portal.'
            });
        }

        const [existingUsers] = await db.query(
            'SELECT email, phone FROM users WHERE email = ? OR phone = ?',
            [email, phone]
        );

        // console.log(email,existingUsers[0].email)

        if (existingUsers.length > 0) {
            const conflictUser = existingUsers[0];

            if (conflictUser.phone === phone) {
                const [localPart, domain] = conflictUser.email.split('@');
                const maskedLocal = localPart.length > 2
                    ? localPart[0] + '***' + localPart[localPart.length - 1]
                    : localPart[0] + '***';
                const maskedEmail = `${maskedLocal}@${domain}`;

                return res.status(409).json({
                    status: 'error',
                    message: `This phone number is already registered with email: ${maskedEmail}. Please login instead.`
                });
            }

            if (conflictUser.email === email) {
                return res.status(409).json({
                    status: 'error',
                    message: 'This email is already registered. Please use a different email or login.'
                });
            }
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const [result] = await db.query(
            'INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [full_name, email, phone, password_hash, role]
        );

        const newUserId = result.insertId;

        // Optional: link this signup to whoever referred them, if a
        // referral_code was provided. Never blocks/fails registration --
        // see referrals.service.js's linkReferral for why.
        await linkReferral(newUserId, referral_code);

        // ==========================================
        // 🔄 NEW FEATURE: GUEST BOOKING SYNCHRONIZATION
        // ==========================================
        // Agar naya user STUDENT hai, toh uski purani guest bookings ko uske naye account se link kar do
        if (role === 'STUDENT') {
            await db.query(
                `UPDATE room_bookings 
                 SET student_id = ? 
                 WHERE (guest_email = ? OR guest_phone = ?) AND student_id IS NULL`,
                [newUserId, email, phone]
            );
        }

        const token = jwt.sign(
            { id: result.insertId, role: role, jti: crypto.randomUUID() }, // jti guarantees uniqueness even if two tokens are signed in the same second
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        res.status(201).json({
            status: "success",
            message: 'User registered successfully',
            token,
            data: { user: { id: result.insertId, full_name, email, role } },

        });

    } catch (error) {
         next(error);
        //res.status(500).json({ status: "error", message: error.message })
    }
};

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ status: "error", message: 'Invalid credentials' });
        }

        const user = users[0];

        if (user.deleted_at) {
            return res.status(401).json({ status: "error", message: 'This account has been deleted' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ status: "error", message: 'Invalid credentials' });
        }

        // Authoritative security: ADMIN accounts require two-factor authentication via the dedicated Admin Portal
        if (user.role === 'ADMIN') {
            return res.status(403).json({
                status: 'error',
                message: 'Admin accounts must log in via the dedicated Admin Portal at /admin with two-factor authentication.'
            });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, email: user.email, jti: crypto.randomUUID() }, // jti guarantees uniqueness even if two tokens are signed in the same second
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        const { password_hash, ...userWithoutPassword } = user;

        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token,
            data: {
                user: userWithoutPassword
            }
        });

    } catch (error) {
        //res.status(500).json({ status: "error", message: error.message })
         next(error);
    }
};

// Import at top if not already there
const sendEmail = require('../../utils/email');

// @route   POST /api/v1/auth/forgot-password
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;

        // 1. Check if user exists
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            // Security Best Practice: Don't reveal if email exists or not
            return res.status(200).json({ status: 'success', message: 'If this email is registered, an OTP will be sent.' });
        }

        const user = users[0];

        // 2. Generate 6-digit OTP and Expiry (10 minutes from now)
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

        // 3. Save OTP to DB
        await db.query(
            'UPDATE users SET reset_otp = ?, reset_otp_expires = ? WHERE id = ?',
            [otp, otpExpires, user.id]
        );

        // 4. Send Email
        const message = `Your password reset OTP is: ${otp}. It is valid for 10 minutes. Please do not share this with anyone.`;

        await sendEmail({
            email: user.email,
            subject: 'Quark Housing - Password Reset OTP',
            message: message,
            html: `<p>Your password reset OTP is: <strong>${otp}</strong></p><p>It is valid for 10 minutes.</p>`
        });

        res.status(200).json({
            status: 'success',
            message: 'If this email is registered, an OTP will be sent.'
        });

    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/auth/reset-password
exports.resetPassword = async (req, res, next) => {
    try {
        const { email, otp, new_password } = req.body;

        // 1. Find user and check OTP
        const [users] = await db.query(
            'SELECT * FROM users WHERE email = ? AND reset_otp = ?',
            [email, otp]
        );

        if (users.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Invalid OTP or Email' });
        }

        const user = users[0];

        // 2. Check if OTP is expired
        if (new Date() > new Date(user.reset_otp_expires)) {
            return res.status(400).json({ status: 'error', message: 'OTP has expired. Please request a new one.' });
        }

        // 3. Hash the new password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(new_password, salt);

        // 4. Update Password, set password_changed_at, and Clear OTP fields
        await db.query(
            'UPDATE users SET password_hash = ?, password_changed_at = NOW(), reset_otp = NULL, reset_otp_expires = NULL WHERE id = ?',
            [password_hash, user.id]
        );

        res.status(200).json({
            status: 'success',
            message: 'Password has been reset successfully. You can now login.'
        });

    } catch (error) {
        next(error);
    }
};
const { blocklistToken } = require('../../utils/token');
exports.blocklistToken = blocklistToken;


// @route   POST /api/v1/auth/logout
// @access  Private (any logged-in role)
exports.logout = async (req, res, next) => {
    try {
        const rawToken = req.headers.authorization.split(' ')[1];
        await exports.blocklistToken(req.user.id, rawToken);
        res.status(200).json({ status: 'success', message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
};