// src/modules/membership/membership.middleware.js
const db = require('../config/db');

// Blocks the request unless the logged-in VENDOR has a currently-active
// membership (status = 'ACTIVE' AND end_date >= today). Checked live against
// end_date rather than trusting the stored status alone, since nothing
// automatically flips a row to EXPIRED yet (no cron job exists).
//
// Usage: place after requireAuth + restrictTo('VENDOR') on any route that
// should be gated -- e.g. creating/editing tiffin listings.
exports.requireActiveMembership = async (req, res, next) => {
    try {
        const [[membership]] = await db.query(
            `SELECT id, end_date FROM vendor_memberships
             WHERE vendor_id = ? AND status = 'ACTIVE' AND end_date >= CURDATE()
             ORDER BY end_date DESC LIMIT 1`,
            [req.user.id]
        );

        if (!membership) {
            return res.status(403).json({
                status: 'error',
                message: 'You need an active membership to do this. Please purchase or renew your membership.'
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};