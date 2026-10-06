// src/utils/adminAuth.js
// Authoritative helper for ADMIN_IDS allowlist management.

/**
 * Returns a normalized, trimmed, lowercase array of allowlisted admin emails.
 * Reads dynamically from process.env.ADMIN_IDS on each call so environment
 * changes take immediate effect without server restart.
 * 
 * @returns {string[]}
 */
function getAllowlistedAdminEmails() {
    const raw = process.env.ADMIN_IDS || '';
    return raw
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Checks whether an email address is included in the ADMIN_IDS allowlist.
 * 
 * @param {string} email 
 * @returns {boolean}
 */
function isEmailAllowlistedAdmin(email) {
    if (!email || typeof email !== 'string') return false;
    const normalized = email.trim().toLowerCase();
    const allowlist = getAllowlistedAdminEmails();
    return allowlist.includes(normalized);
}

module.exports = {
    getAllowlistedAdminEmails,
    isEmailAllowlistedAdmin
};

