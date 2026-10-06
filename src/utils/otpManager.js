// src/utils/otpManager.js
// Authoritative Database-Backed OTP Management for QuarkHousing Admin System
const crypto = require('crypto');
const db = require('../config/db');
const sendEmail = require('./email');

const OTP_EXPIRY_MINUTES = 10;
const OTP_COOLDOWN_SECONDS = process.env.NODE_ENV === 'test' ? 0 : 60;
const MAX_VERIFY_ATTEMPTS = 5;

// Test-only memory cache of plaintext OTPs for automated test assertions
// Strictly disabled outside process.env.NODE_ENV === 'test'
const testPlainOtpCache = new Map();

/**
 * Normalizes email address (trimmed and lowercase).
 */
function normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
}

/**
 * Computes SHA-256 hash of an OTP string.
 */
function hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

/**
 * Generates a cryptographically secure 6-digit integer string.
 */
function generateSecureOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Generates, persists to MySQL, and emails a one-time password.
 * 
 * @param {Object} options
 * @param {string} options.email
 * @param {string} options.purpose - 'ADMIN_REGISTER' | 'ADMIN_LOGIN' | 'ADMIN_PASSWORD_CHANGE' | 'ADMIN_RESET_PASSWORD'
 * @param {string} [options.challengeId] - Optional short-lived challenge identifier
 * @param {string} options.subject
 * @param {string} [options.actionDescription]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function generateAndSendOtp({ email, purpose, challengeId = null, subject, actionDescription }) {
    const normEmail = normalizeEmail(email);

    // 1. Authoritative DB Cooldown Check
    const [recentOtps] = await db.query(
        `SELECT created_at FROM auth_otps
         WHERE email = ? AND purpose = ? AND consumed_at IS NULL
         ORDER BY id DESC LIMIT 1`,
        [normEmail, purpose]
    );

    if (recentOtps && recentOtps.length > 0) {
        const lastCreated = new Date(recentOtps[0].created_at).getTime();
        const diffSeconds = (Date.now() - lastCreated) / 1000;
        if (diffSeconds < OTP_COOLDOWN_SECONDS) {
            const remaining = Math.ceil(OTP_COOLDOWN_SECONDS - diffSeconds);
            const err = new Error(`Please wait ${remaining} seconds before requesting a new OTP.`);
            err.statusCode = 429;
            throw err;
        }
    }

    // 2. Generate secure OTP and hash
    const plainOtp = generateSecureOtp();
    const otpHash = hashOtp(plainOtp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // 3. Insert authoritative OTP record into MySQL
    let insertId;
    try {
        const [insertResult] = await db.query(
            `INSERT INTO auth_otps (email, otp_hash, purpose, challenge_id, attempts, max_attempts, expires_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)`,
            [normEmail, otpHash, purpose, challengeId, MAX_VERIFY_ATTEMPTS, expiresAt]
        );
        insertId = insertResult.insertId;
    } catch (dbErr) {
        console.error('Database error creating auth_otps record:', dbErr.message);
        const err = new Error('Authentication service temporarily unavailable.');
        err.statusCode = 500;
        throw err;
    }

    if (process.env.NODE_ENV === 'test') {
        testPlainOtpCache.set(`${purpose}:${normEmail}`, plainOtp);
    }

    // 4. Dispatch Email via existing Nodemailer infrastructure
    const desc = actionDescription || 'verify your identity';
    const emailBody = `Your one-time verification code to ${desc} is: ${plainOtp}. This code expires in ${OTP_EXPIRY_MINUTES} minutes. If you did not request this, please contact administrator immediately.`;
    const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #0f172a; margin-top: 0;">Quark Housing Security</h2>
            <p style="color: #475569; font-size: 14px;">Use the following verification code to ${desc}:</p>
            <div style="background-color: #f1f5f9; padding: 16px; border-radius: 6px; text-align: center; margin: 24px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">${plainOtp}</span>
            </div>
            <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">This OTP will expire in ${OTP_EXPIRY_MINUTES} minutes. Never share this code with anyone.</p>
        </div>
    `;

    try {
        await sendEmail({
            email: normEmail,
            subject: subject || 'Quark Housing - Verification Code',
            message: emailBody,
            html: emailHtml
        });
    } catch (mailErr) {
        // Log technical failure server-side without leaking credentials or OTP
        console.error('Mail delivery failed for OTP record ID', insertId, 'Error:', mailErr.message);

        // Authoritatively invalidate the OTP in the database so a phantom code never lingers
        try {
            await db.query(
                `UPDATE auth_otps SET consumed_at = NOW() WHERE id = ?`,
                [insertId]
            );
        } catch (cleanupErr) {
            console.error('Failed to cleanup invalidated OTP record:', cleanupErr.message);
        }

        const err = new Error('Failed to deliver verification email. Please check your email address or try again later.');
        err.statusCode = 502; // Bad Gateway / Mail delivery error
        throw err;
    }

    return {
        success: true,
        message: 'Verification code sent to registered email address.'
    };
}

/**
 * Authoritatively verifies a provided OTP against MySQL database using transactions
 * and row-level locking to prevent concurrent race conditions.
 * 
 * @param {Object} options
 * @param {string} options.email
 * @param {string} options.otp
 * @param {string} options.purpose
 * @param {string} [options.challengeId]
 * @returns {Promise<{ valid: boolean, message?: string }>}
 */
async function verifyOtp({ email, otp, purpose, challengeId = null }) {
    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
        return { valid: false, message: 'Invalid OTP format. Must be a 6-digit code.' };
    }

    const normEmail = normalizeEmail(email);
    const cleanOtp = otp.trim();
    const providedHash = hashOtp(cleanOtp);

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        let query = `
            SELECT id, otp_hash, attempts, max_attempts, expires_at, consumed_at, challenge_id
            FROM auth_otps
            WHERE email = ? AND purpose = ? AND consumed_at IS NULL
        `;
        const params = [normEmail, purpose];

        if (challengeId) {
            query += ` AND challenge_id = ?`;
            params.push(challengeId);
        }

        query += ` ORDER BY id DESC LIMIT 1 FOR UPDATE`;

        const [rows] = await connection.query(query, params);

        if (!rows || rows.length === 0) {
            await connection.rollback();
            return { valid: false, message: 'No active OTP found. Please request a new code.' };
        }

        const record = rows[0];
        const now = new Date();

        // 1. Check already consumed
        if (record.consumed_at) {
            await connection.rollback();
            return { valid: false, message: 'This OTP has already been used. Please request a new code.' };
        }

        // 2. Check expired
        if (now > new Date(record.expires_at)) {
            await connection.query('UPDATE auth_otps SET consumed_at = NOW() WHERE id = ?', [record.id]);
            await connection.commit();
            return { valid: false, message: 'OTP has expired. Please request a new code.' };
        }

        // 3. Check attempt limit
        if (record.attempts >= record.max_attempts) {
            await connection.query('UPDATE auth_otps SET consumed_at = NOW() WHERE id = ?', [record.id]);
            await connection.commit();
            return { valid: false, message: 'Maximum verification attempts exceeded. Please request a new code.' };
        }

        // 4. Timing-safe constant-time hash comparison
        const expectedBuffer = Buffer.from(record.otp_hash, 'hex');
        const providedBuffer = Buffer.from(providedHash, 'hex');

        const isMatch = expectedBuffer.length === providedBuffer.length &&
            crypto.timingSafeEqual(expectedBuffer, providedBuffer);

        if (!isMatch) {
            const nextAttempts = record.attempts + 1;
            const remaining = record.max_attempts - nextAttempts;

            if (remaining <= 0) {
                await connection.query(
                    'UPDATE auth_otps SET attempts = ?, consumed_at = NOW() WHERE id = ?',
                    [nextAttempts, record.id]
                );
                await connection.commit();
                return { valid: false, message: 'Invalid OTP. Verification attempts exceeded; code invalidated.' };
            }

            await connection.query(
                'UPDATE auth_otps SET attempts = ? WHERE id = ?',
                [nextAttempts, record.id]
            );
            await connection.commit();
            return { valid: false, message: `Invalid OTP code. ${remaining} attempt(s) remaining.` };
        }

        // 5. Successful match: Single-use consumption
        await connection.query('UPDATE auth_otps SET consumed_at = NOW() WHERE id = ?', [record.id]);
        await connection.commit();

        return { valid: true };

    } catch (err) {
        await connection.rollback();
        console.error('Error during OTP verification transaction:', err.message);
        throw err;
    } finally {
        connection.release();
    }
}

/**
 * Invalidates any unconsumed OTPs for an email and purpose.
 */
async function invalidateOtp({ email, purpose, challengeId = null }) {
    const normEmail = normalizeEmail(email);
    let sql = 'UPDATE auth_otps SET consumed_at = NOW() WHERE email = ? AND purpose = ? AND consumed_at IS NULL';
    const params = [normEmail, purpose];

    if (challengeId) {
        sql += ' AND challenge_id = ?';
        params.push(challengeId);
    }

    try {
        await db.query(sql, params);
    } catch (e) {
        console.error('Error invalidating OTP:', e.message);
    }
}

/**
 * Test helper for automated testing assertions only.
 */
function _getTestOtp(email, purpose) {
    if (process.env.NODE_ENV !== 'test') return null;
    const normEmail = normalizeEmail(email);
    return testPlainOtpCache.get(`${purpose}:${normEmail}`) || null;
}

module.exports = {
    generateAndSendOtp,
    verifyOtp,
    invalidateOtp,
    _getTestOtp,
    OTP_EXPIRY_MINUTES,
    OTP_COOLDOWN_SECONDS
};
