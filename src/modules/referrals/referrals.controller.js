// src/modules/referrals/referrals.controller.js
const db = require('../../config/db');
const { generateUniqueCode } = require('./referrals.service');

// @route   GET /api/v1/referrals/my-code
// @access  Private (STUDENT)
// Lazily generates a referral code on first request, then always returns the same one.
exports.getMyReferralCode = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const [[user]] = await db.query(`SELECT referral_code, full_name FROM users WHERE id = ?`, [userId]);

        let code = user.referral_code;
        if (!code) {
            code = await generateUniqueCode(user.full_name);
            await db.query(`UPDATE users SET referral_code = ? WHERE id = ?`, [code, userId]);
        }

        res.status(200).json({
            status: 'success',
            data: {
                referral_code: code,
                referral_link: `https://quarkhousing.com/referral/${code}`
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/referrals
// @access  Private (STUDENT)
exports.getMyReferrals = async (req, res, next) => {
    try {
        const referrerId = req.user.id;

        const [[stats]] = await db.query(
            `SELECT
                COUNT(*) AS total_referrals,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_referrals,
                COALESCE(SUM(total_orders_delivered), 0) AS total_orders_delivered,
                COALESCE(SUM(total_rewards_earned), 0) AS total_rewards_earned
             FROM referrals WHERE referrer_id = ?`,
            [referrerId]
        );

        const [referredPeople] = await db.query(
            `SELECT u.full_name AS name, u.phone, r.status, r.total_orders_delivered, r.total_rewards_earned, u.created_at AS joined_on
             FROM referrals r
             JOIN users u ON r.referred_user_id = u.id
             WHERE r.referrer_id = ?
             ORDER BY u.created_at DESC`,
            [referrerId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                total_referrals: stats.total_referrals || 0,
                active_referrals: stats.active_referrals || 0,
                total_orders_delivered: stats.total_orders_delivered || 0,
                total_rewards_earned: Number(stats.total_rewards_earned),
                referred_people: referredPeople
            }
        });
    } catch (error) {
        next(error);
    }
};