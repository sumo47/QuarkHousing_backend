// src/utils/token.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');

/**
 * Generates a signed JWT with unique jti claim.
 * 
 * @param {Object} payload 
 * @returns {string}
 */
function generateAuthToken(payload) {
    return jwt.sign(
        {
            ...payload,
            jti: crypto.randomUUID()
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

/**
 * Computes SHA-256 hash of a raw JWT string.
 * 
 * @param {string} rawToken 
 * @returns {string}
 */
function hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Blocklists a token so that requireAuth will authoritatively reject it.
 * 
 * @param {number|string} userId 
 * @param {string} rawToken 
 */
async function blocklistToken(userId, rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return;
    const tokenHash = hashToken(rawToken);
    const decoded = jwt.decode(rawToken);
    const expiresAt = decoded && decoded.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.query(
        `INSERT INTO token_blocklist (token_hash, user_id, expires_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE token_hash = token_hash`,
        [tokenHash, userId, expiresAt]
    );
}

module.exports = {
    generateAuthToken,
    hashToken,
    blocklistToken
};
