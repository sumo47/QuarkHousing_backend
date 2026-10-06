// src/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const { isEmailAllowlistedAdmin } = require('../utils/adminAuth');

// 1. Verify Token Middleware
exports.requireAuth = async (req, res, next) => {
    try {
        // Token usually comes in headers as: "Authorization: Bearer <token>"
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                status: 'error',
                message: 'Access denied. No token provided or invalid format.'
            });
        }

        // Extract the token part
        const token = authHeader.split(' ')[1];

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Combined DB check: token_blocklist, user suspended/deleted, password_changed_at, and authoritative role/email
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const [[status]] = await db.query(
            `SELECT u.email, u.role, u.is_suspended, u.deleted_at, u.password_changed_at,
                    EXISTS (SELECT 1 FROM token_blocklist WHERE token_hash = ?) AS is_blocklisted
             FROM users u WHERE u.id = ?`,
            [tokenHash, decoded.id]
        );

        if (!status) {
            return res.status(401).json({ status: 'error', message: 'Invalid token.' });
        }
        if (status.is_blocklisted) {
            return res.status(401).json({ status: 'error', message: 'Session has been logged out. Please login again.' });
        }
        if (status.deleted_at) {
            return res.status(401).json({ status: 'error', message: 'This account has been deleted.' });
        }
        if (status.is_suspended) {
            return res.status(401).json({ status: 'error', message: 'This account has been suspended.' });
        }
        
        // Session invalidation across all tokens: If password was changed after token issuance
        if (status.password_changed_at && decoded.iat) {
            const passwordChangedTimestamp = Math.floor(new Date(status.password_changed_at).getTime() / 1000);
            if (decoded.iat < passwordChangedTimestamp) {
                return res.status(401).json({
                    status: 'error',
                    message: 'Session invalidated due to password change. Please login again.'
                });
            }
        }

        // Strict Admin Allowlist Guard: If an account is an ADMIN, its email MUST still be in ADMIN_IDS
        if (status.role === 'ADMIN' && !isEmailAllowlistedAdmin(status.email)) {
            return res.status(403).json({
                status: 'error',
                message: 'Administrator authorization revoked. Email is not in the admin allowlist.'
            });
        }

        // Attach verified user payload (id, role, email) to the request object
        req.user = {
            ...decoded,
            email: status.email,
            role: status.role
        }; 
        
        next(); // Move to the next middleware or controller
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ status: 'error', message: 'Session expired. Please login again.' });
        }
        return res.status(401).json({ status: 'error', message: 'Invalid token.' });
    }
};

// 2. Role-Based Access Control (RBAC) Middleware
exports.restrictTo = (...allowedRoles) => {
    return (req, res, next) => {
        // console.log(req.user)
        // req.user requireAuth se aayega, isliye restrictTo hamesha requireAuth ke baad chalna chahiye
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                status: 'error',
                message: 'You do not have permission to perform this action.'
            });
        }
        next();
    };
};

// 3. Authoritative Owner Verification Guard Middleware
// Ensures that only owners whose KYC documents have been reviewed and marked VERIFIED by ADMIN can perform protected owner operations (e.g. creating properties).
exports.requireVerifiedOwner = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                status: 'error',
                message: 'Access denied. Authentication required.'
            });
        }

        // ADMINs have supervisory bypass
        if (req.user.role === 'ADMIN') {
            return next();
        }

        if (req.user.role !== 'OWNER') {
            return res.status(403).json({
                status: 'error',
                message: 'Only registered owners can perform this action.'
            });
        }

        const [[kyc]] = await db.query(
            `SELECT verification_status FROM owner_kyc_documents WHERE owner_id = ?`,
            [req.user.id]
        );

        if (!kyc || kyc.verification_status !== 'VERIFIED') {
            return res.status(403).json({
                status: 'error',
                message: 'Owner verification is required before you can list a property.'
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};

