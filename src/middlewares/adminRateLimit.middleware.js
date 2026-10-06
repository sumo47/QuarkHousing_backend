// src/middlewares/adminRateLimit.middleware.js
// IP & Email-based brute force protection for admin login-init
// NOTE: This in-memory store is suitable for the current single-instance deployment.
// If the backend is horizontally scaled across multiple instances in the future,
// this rate limiter should be backed by a distributed store such as Redis.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

// Memory store for tracking failed attempts
const failedAttemptsStore = new Map();

// Periodic cleanup of expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of failedAttemptsStore.entries()) {
        if (now > record.resetAt) {
            failedAttemptsStore.delete(key);
        }
    }
}, 5 * 60 * 1000).unref();

function getClientIp(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        'unknown_ip'
    );
}

function normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
}

/**
 * Middleware to check if IP or IP+Email is currently rate-limited.
 */
function adminLoginRateLimiter(req, res, next) {
    const ip = getClientIp(req);
    const email = normalizeEmail(req.body.email);
    const now = Date.now();

    const ipKey = `ip:${ip}`;
    const ipEmailKey = `ip_email:${ip}:${email}`;

    const ipRecord = failedAttemptsStore.get(ipKey);
    const ipEmailRecord = email ? failedAttemptsStore.get(ipEmailKey) : null;

    let activeRecord = null;
    if (ipEmailRecord && ipEmailRecord.count >= MAX_FAILED_ATTEMPTS && now < ipEmailRecord.resetAt) {
        activeRecord = ipEmailRecord;
    } else if (ipRecord && ipRecord.count >= MAX_FAILED_ATTEMPTS * 2 && now < ipRecord.resetAt) {
        // Higher threshold for pure IP to prevent collateral block
        activeRecord = ipRecord;
    }

    if (activeRecord) {
        const remainingMinutes = Math.ceil((activeRecord.resetAt - now) / (60 * 1000));
        return res.status(429).json({
            status: 'error',
            message: `Too many failed login attempts. Please try again after ${remainingMinutes} minute(s).`
        });
    }

    next();
}

/**
 * Records a failed admin login attempt.
 */
function recordAdminLoginFailure(req, email) {
    const ip = getClientIp(req);
    const normEmail = normalizeEmail(email);
    const now = Date.now();

    const keys = [`ip:${ip}`];
    if (normEmail) {
        keys.push(`ip_email:${ip}:${normEmail}`);
    }

    for (const key of keys) {
        const existing = failedAttemptsStore.get(key);
        if (existing && now < existing.resetAt) {
            existing.count += 1;
        } else {
            failedAttemptsStore.set(key, {
                count: 1,
                resetAt: now + WINDOW_MS
            });
        }
    }
}

/**
 * Clears failed attempts upon successful authentication.
 */
function recordAdminLoginSuccess(req, email) {
    const ip = getClientIp(req);
    const normEmail = normalizeEmail(email);

    if (normEmail) {
        failedAttemptsStore.delete(`ip_email:${ip}:${normEmail}`);
    }
}

/**
 * Test helper to reset rate limit store during automated testing.
 */
function _resetRateLimitStore() {
    failedAttemptsStore.clear();
}

module.exports = {
    adminLoginRateLimiter,
    recordAdminLoginFailure,
    recordAdminLoginSuccess,
    _resetRateLimitStore
};
