// src/modules/referrals/referrals.service.js
const db = require('../../config/db');
const walletService = require('../wallet/wallet.service');

const REWARD_PER_DELIVERED_ORDER = 20.0;

// Generates a unique referral code for a user who doesn't have one yet.
// Format: first name (alphanumeric only, uppercase) + 4 random digits,
// e.g. "PRABHAT4821". Retries on the rare collision.
async function generateUniqueCode(fullName) {
    const base = (fullName || 'USER').split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12) || 'USER';

    for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = Math.floor(1000 + Math.random() * 9000); // 4 digits
        const candidate = `${base}${suffix}`;
        const [[existing]] = await db.query(`SELECT id FROM users WHERE referral_code = ?`, [candidate]);
        if (!existing) return candidate;
    }
    // Extremely unlikely fallback: timestamp-based, guaranteed unique enough
    return `${base}${Date.now().toString().slice(-6)}`;
}

// Called from auth.controller.js's register(), AFTER the new user row is
// created. Never throws -- a bad/unknown referral code should never break
// registration, it should just silently not create a referral link.
exports.linkReferral = async (newUserId, referralCodeUsed) => {
    if (!referralCodeUsed) return;

    try {
        const [[referrer]] = await db.query(`SELECT id FROM users WHERE referral_code = ?`, [referralCodeUsed]);
        if (!referrer || referrer.id === newUserId) return; // unknown code, or someone tried to refer themselves

        await db.query(
            `INSERT INTO referrals (referrer_id, referred_user_id) VALUES (?, ?)`,
            [referrer.id, newUserId]
        );
    } catch (error) {
        // ER_DUP_ENTRY (already-referred user) or any other issue here should
        // never surface to the person registering.
        console.error('linkReferral failed silently:', error.message);
    }
};

// Called from vendor.controller.js's markOrderDelivered(), AFTER the order
// status is updated to DELIVERED. If this customer was referred by someone,
// credits the referrer's wallet and updates the referral's running totals.
exports.creditReferralReward = async (customerId, orderId) => {
    try {
        const [[referral]] = await db.query(
            `SELECT id, referrer_id FROM referrals WHERE referred_user_id = ?`,
            [customerId]
        );
        if (!referral) return; // this customer wasn't referred by anyone

        await walletService.creditWallet(
            referral.referrer_id,
            REWARD_PER_DELIVERED_ORDER,
            'REFERRAL_REWARD',
            `Reward for your referral's delivered tiffin order #${orderId}`,
            orderId
        );

        await db.query(
            `UPDATE referrals
             SET status = 'ACTIVE', total_orders_delivered = total_orders_delivered + 1, total_rewards_earned = total_rewards_earned + ?
             WHERE id = ?`,
            [REWARD_PER_DELIVERED_ORDER, referral.id]
        );
    } catch (error) {
        // A referral-crediting failure should never break order delivery itself.
        console.error('creditReferralReward failed silently:', error.message);
    }
};

exports.generateUniqueCode = generateUniqueCode;
exports.REWARD_PER_DELIVERED_ORDER = REWARD_PER_DELIVERED_ORDER;