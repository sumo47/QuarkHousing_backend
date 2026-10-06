// src/modules/admin/admin.controller.js
// All ADMIN-only, cross-module moderation logic lives here. As more admin
// features get built (payouts, KYC verification, payment confirmations,
// user management), add a clearly-labeled section below rather than
// scattering admin logic back into the resource-owning modules.

const db = require('../../config/db');
const sendEmail = require('../../utils/email');

// =============================================================================
// TIFFIN SERVICE APPROVAL
// =============================================================================

// @route   GET /api/v1/admin/tiffin/pending
// @access  Private (ADMIN)
exports.getPendingTiffinServices = async (req, res, next) => {
    try {
        const [services] = await db.query(
            `SELECT ts.id, ts.name, ts.veg_type, ts.price_per_meal, ts.created_at,
                    u.full_name AS vendor_name, u.email AS vendor_email,
                    a.city, a.locality
             FROM tiffin_services ts
             JOIN users u ON ts.vendor_id = u.id
             JOIN tiffin_addresses a ON ts.id = a.tiffin_service_id
             WHERE ts.approval_status = 'PENDING'
             ORDER BY ts.created_at ASC`
        );
        res.status(200).json({ status: 'success', results: services.length, data: { services } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/tiffin/:id/approve
// @access  Private (ADMIN)
exports.approveTiffinService = async (req, res, next) => {
    try {
        const tiffinServiceId = req.params.id;

        const [result] = await db.query(
            `UPDATE tiffin_services SET approval_status = 'APPROVED', rejection_reason = NULL WHERE id = ? AND approval_status = 'PENDING'`,
            [tiffinServiceId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No pending tiffin service found with this id' });
        }

        const [[service]] = await db.query(
            `SELECT ts.name, u.full_name, u.email
             FROM tiffin_services ts JOIN users u ON ts.vendor_id = u.id
             WHERE ts.id = ?`,
            [tiffinServiceId]
        );

        await sendEmail({
            email: service.email,
            subject: `Your Tiffin Service Has Been Approved - ${service.name}`,
            html: `
                <h3>Hello ${service.full_name},</h3>
                <p>Good news! Your tiffin service <b>${service.name}</b> has been approved and is now live on Quark Housing.</p>
                <p>Customers can now find and order from your listing.</p>
            `
        }).catch((err) => console.error('Approval email failed to send:', err));

        res.status(200).json({ status: 'success', message: 'Tiffin service approved' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/tiffin/:id/reject
// @access  Private (ADMIN)
exports.rejectTiffinService = async (req, res, next) => {
    try {
        const { rejection_reason } = req.body;
        const tiffinServiceId = req.params.id;

        const [result] = await db.query(
            `UPDATE tiffin_services SET approval_status = 'REJECTED', rejection_reason = ? WHERE id = ? AND approval_status = 'PENDING'`,
            [rejection_reason, tiffinServiceId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No pending tiffin service found with this id' });
        }

        const [[service]] = await db.query(
            `SELECT ts.name, u.full_name, u.email
             FROM tiffin_services ts JOIN users u ON ts.vendor_id = u.id
             WHERE ts.id = ?`,
            [tiffinServiceId]
        );

        await sendEmail({
            email: service.email,
            subject: `Your Tiffin Service Submission Was Rejected - ${service.name}`,
            html: `
                <h3>Hello ${service.full_name},</h3>
                <p>Your tiffin service <b>${service.name}</b> was not approved.</p>
                <p><b>Reason:</b> ${rejection_reason}</p>
                <p>You're welcome to update your listing and resubmit.</p>
            `
        }).catch((err) => console.error('Rejection email failed to send:', err));

        res.status(200).json({ status: 'success', message: 'Tiffin service rejected' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// COUPON MANAGEMENT
// =============================================================================

// @route   GET /api/v1/admin/coupons
// @access  Private (ADMIN)
// Unlike the student-facing GET /api/v1/coupons/my-coupons, this shows
// EVERY coupon -- active, inactive, expired -- plus redemption counts.
exports.getAllCoupons = async (req, res, next) => {
    try {
        const [coupons] = await db.query(
            `SELECT c.*, COUNT(cr.id) AS times_redeemed
             FROM coupons c
             LEFT JOIN coupon_redemptions cr ON cr.coupon_id = c.id
             GROUP BY c.id
             ORDER BY c.created_at DESC`
        );
        res.status(200).json({ status: 'success', results: coupons.length, data: { coupons } });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/admin/coupons
// @access  Private (ADMIN)
exports.createCoupon = async (req, res, next) => {
    try {
        const { code, discount_type, discount_value, min_order_amount, max_discount_amount, valid_from, valid_until } = req.body;

        if (valid_until < valid_from) {
            return res.status(400).json({ status: 'error', message: 'valid_until cannot be before valid_from' });
        }

        try {
            const [result] = await db.query(
                `INSERT INTO coupons (code, discount_type, discount_value, min_order_amount, max_discount_amount, valid_from, valid_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    code, discount_type, parseFloat(discount_value),
                    min_order_amount ? parseFloat(min_order_amount) : 0,
                    max_discount_amount ? parseFloat(max_discount_amount) : null,
                    valid_from, valid_until
                ]
            );
            res.status(201).json({ status: 'success', message: 'Coupon created', data: { coupon_id: result.insertId } });
        } catch (dbError) {
            if (dbError.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ status: 'error', message: `A coupon with code "${code}" already exists` });
            }
            throw dbError;
        }
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/coupons/:id
// @access  Private (ADMIN)
exports.updateCoupon = async (req, res, next) => {
    try {
        const couponId = req.params.id;
        const data = req.body;

        const [[existing]] = await db.query(`SELECT id FROM coupons WHERE id = ?`, [couponId]);
        if (!existing) {
            return res.status(404).json({ status: 'error', message: 'Coupon not found' });
        }

        const fields = {
            discount_type: data.discount_type,
            discount_value: data.discount_value !== undefined ? parseFloat(data.discount_value) : undefined,
            min_order_amount: data.min_order_amount !== undefined ? parseFloat(data.min_order_amount) : undefined,
            max_discount_amount: data.max_discount_amount !== undefined ? parseFloat(data.max_discount_amount) : undefined,
            valid_from: data.valid_from,
            valid_until: data.valid_until,
            is_active: data.is_active !== undefined ? (data.is_active === 'true' || data.is_active === '1' ? 1 : 0) : undefined
        };
        const sets = Object.entries(fields).filter(([, v]) => v !== undefined);
        if (sets.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Nothing to update' });
        }

        const setClause = sets.map(([k]) => `${k} = ?`).join(', ');
        const values = sets.map(([, v]) => v);
        await db.query(`UPDATE coupons SET ${setClause} WHERE id = ?`, [...values, couponId]);

        res.status(200).json({ status: 'success', message: 'Coupon updated' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/admin/coupons/:id
// @access  Private (ADMIN)
// If it's already been redeemed by anyone, deactivate instead of deleting --
// same "preserve history" rule used for properties/tiffin listings.
exports.deleteCoupon = async (req, res, next) => {
    try {
        const couponId = req.params.id;

        const [[{ redemption_count }]] = await db.query(
            `SELECT COUNT(*) AS redemption_count FROM coupon_redemptions WHERE coupon_id = ?`,
            [couponId]
        );

        if (redemption_count > 0) {
            const [result] = await db.query(`UPDATE coupons SET is_active = 0 WHERE id = ?`, [couponId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ status: 'error', message: 'Coupon not found' });
            }
            return res.status(200).json({
                status: 'success',
                message: 'This coupon has redemption history, so it was deactivated instead of permanently deleted.'
            });
        }

        const [result] = await db.query(`DELETE FROM coupons WHERE id = ?`, [couponId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Coupon not found' });
        }

        res.status(200).json({ status: 'success', message: 'Coupon deleted' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// =============================================================================
// OWNER KYC VERIFICATION
// =============================================================================

// @route   GET /api/v1/admin/kyc/pending
// @access  Private (ADMIN)
exports.getPendingKyc = async (req, res, next) => {
    try {
        const [pending] = await db.query(
            `SELECT k.owner_id, u.full_name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
                    k.aadhaar_number, k.aadhaar_doc_url, k.pan_number, k.pan_doc_url, k.address_proof_url, k.submitted_at
             FROM owner_kyc_documents k
             JOIN users u ON k.owner_id = u.id
             WHERE k.verification_status = 'PENDING'
             ORDER BY k.submitted_at ASC`
        );
        res.status(200).json({ status: 'success', results: pending.length, data: { pending } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/kyc/:ownerId/verify
// @access  Private (ADMIN)
exports.verifyKyc = async (req, res, next) => {
    try {
        const ownerId = req.params.ownerId;

        const [result] = await db.query(
            `UPDATE owner_kyc_documents SET verification_status = 'VERIFIED', rejection_reason = NULL, reviewed_at = NOW()
             WHERE owner_id = ? AND verification_status = 'PENDING'`,
            [ownerId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No pending KYC submission found for this owner' });
        }

        const [[owner]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [ownerId]);
        if (owner && owner.email) {
            await sendEmail({
                email: owner.email,
                subject: `Account Verified - You Can Now List Properties on QuarkHousing`,
                html: `
                    <h2>Hello ${owner.full_name},</h2>
                    <p>Congratulations! Your owner verification documents have been reviewed and approved by the QuarkHousing administration team.</p>
                    <p>Your owner account is now fully verified. You can now list and manage your student housing, rooms, and hostels on QuarkHousing.</p>
                    <p>Log in to your Owner Dashboard to get started.</p>
                    <br/>
                    <p>Warm regards,<br/>The QuarkHousing Team</p>
                `
            }).catch((err) => console.error('KYC verified email failed to send:', err.message || err));
        }

        res.status(200).json({ status: 'success', message: 'KYC verified' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/kyc/:ownerId/reject
// @access  Private (ADMIN)
exports.rejectKyc = async (req, res, next) => {
    try {
        const ownerId = req.params.ownerId;
        const { rejection_reason } = req.body;

        const [result] = await db.query(
            `UPDATE owner_kyc_documents SET verification_status = 'REJECTED', rejection_reason = ?, reviewed_at = NOW()
             WHERE owner_id = ? AND verification_status = 'PENDING'`,
            [rejection_reason, ownerId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No pending KYC submission found for this owner' });
        }

        const [[owner]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [ownerId]);
        await sendEmail({
            email: owner.email,
            subject: `Your KYC Submission Was Rejected`,
            html: `
                <h3>Hello ${owner.full_name},</h3>
                <p>Your KYC submission could not be verified.</p>
                <p><b>Reason:</b> ${rejection_reason}</p>
                <p>Please resubmit your documents from your Owner Dashboard.</p>
            `
        }).catch((err) => console.error('KYC rejected email failed to send:', err));

        res.status(200).json({ status: 'success', message: 'KYC rejected' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// OWNER PAYOUT PROCESSING
// =============================================================================
// NOTE: rejecting a payout needs no special "release the funds" step -- see
// owner.controller.js's computeBalance(): it only treats PENDING/PROCESSING
// payouts as reserved. Once a payout is REJECTED, it naturally falls out of
// that calculation and the amount becomes available again automatically.

// @route   GET /api/v1/admin/payouts/pending
// @access  Private (ADMIN)
exports.getPendingPayouts = async (req, res, next) => {
    try {
        const [pending] = await db.query(
            `SELECT p.id, p.owner_id, p.amount, p.method, p.requested_at,
                    u.full_name AS owner_name, u.email AS owner_email,
                    b.account_holder_name, b.account_number, b.ifsc_code, b.upi_id
             FROM owner_payouts p
             JOIN users u ON p.owner_id = u.id
             LEFT JOIN owner_bank_details b ON p.owner_id = b.owner_id
             WHERE p.status = 'PENDING'
             ORDER BY p.requested_at ASC`
        );
        res.status(200).json({ status: 'success', results: pending.length, data: { pending } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/payouts/:id/mark-paid
// @access  Private (ADMIN)
exports.markPayoutPaid = async (req, res, next) => {
    try {
        const payoutId = req.params.id;

        const [result] = await db.query(
            `UPDATE owner_payouts SET status = 'PAID', processed_at = NOW() WHERE id = ? AND status = 'PENDING'`,
            [payoutId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No pending payout found with this id' });
        }

        const [[payout]] = await db.query(
            `SELECT p.amount, u.full_name, u.email FROM owner_payouts p JOIN users u ON p.owner_id = u.id WHERE p.id = ?`,
            [payoutId]
        );
        await sendEmail({
            email: payout.email,
            subject: `Your Payout Has Been Processed`,
            html: `
                <h3>Hello ${payout.full_name},</h3>
                <p>Your withdrawal request of ₹${payout.amount} has been paid out successfully.</p>
            `
        }).catch((err) => console.error('Payout-paid email failed to send:', err));

        res.status(200).json({ status: 'success', message: 'Payout marked as paid' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/payouts/:id/reject
// @access  Private (ADMIN)
exports.rejectPayout = async (req, res, next) => {
    try {
        const payoutId = req.params.id;
        const { remarks } = req.body;

        const [result] = await db.query(
            `UPDATE owner_payouts SET status = 'REJECTED', remarks = ?, processed_at = NOW() WHERE id = ? AND status = 'PENDING'`,
            [remarks, payoutId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No pending payout found with this id' });
        }

        const [[payout]] = await db.query(
            `SELECT p.amount, u.full_name, u.email FROM owner_payouts p JOIN users u ON p.owner_id = u.id WHERE p.id = ?`,
            [payoutId]
        );
        await sendEmail({
            email: payout.email,
            subject: `Your Payout Request Was Rejected`,
            html: `
                <h3>Hello ${payout.full_name},</h3>
                <p>Your withdrawal request of ₹${payout.amount} was not processed.</p>
                <p><b>Reason:</b> ${remarks}</p>
                <p>The amount has been returned to your available balance. Please contact support if you have questions.</p>
            `
        }).catch((err) => console.error('Payout-rejected email failed to send:', err));

        res.status(200).json({ status: 'success', message: "Payout rejected, funds returned to owner's available balance" });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// PLATFORM OVERVIEW
// =============================================================================

// @route   GET /api/v1/admin/overview
// @access  Private (ADMIN)
exports.getPlatformOverview = async (req, res, next) => {
    try {
        const [[userStats]] = await db.query(
            `SELECT COUNT(*) AS total_users,
                    SUM(role = 'STUDENT') AS students, SUM(role = 'OWNER') AS owners,
                    SUM(role = 'VENDOR') AS vendors, SUM(role = 'ADMIN') AS admins,
                    SUM(is_suspended = 1) AS suspended_users
             FROM users WHERE deleted_at IS NULL`
        );

        const usersByRole = {
            STUDENT: Number(userStats.students) || 0,
            OWNER: Number(userStats.owners) || 0,
            VENDOR: Number(userStats.vendors) || 0,
            ADMIN: Number(userStats.admins) || 0
        };
        const totalUsers = Number(userStats.total_users) || 0;

        const [[propertyStats]] = await db.query(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM properties`
        );

        const [[tiffinStats]] = await db.query(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN approval_status = 'APPROVED' AND is_active = 1 THEN 1 ELSE 0 END) AS active,
                    SUM(approval_status = 'APPROVED') AS approved_tiffin_services,
                    SUM(approval_status = 'PENDING') AS pending_tiffin_services
             FROM tiffin_services`
        );

        const [[bookingStats]] = await db.query(
            `SELECT COUNT(*) AS total, SUM(status IN ('CONFIRMED','COMPLETED')) AS confirmed FROM room_bookings`
        );

        const [[orderStats]] = await db.query(
            `SELECT COUNT(*) AS total, SUM(status = 'DELIVERED') AS delivered FROM tiffin_orders`
        );

        const [[subscriptionStats]] = await db.query(
            `SELECT COUNT(*) AS total, SUM(status = 'ACTIVE') AS active FROM tiffin_subscriptions`
        );

        const [[membershipStats]] = await db.query(
            `SELECT COUNT(*) AS active_vendor_memberships FROM vendor_memberships WHERE status = 'ACTIVE' AND end_date >= CURDATE()`
        );

        const [[tiffinPending]] = await db.query(`SELECT COUNT(*) AS n FROM tiffin_services WHERE approval_status = 'PENDING'`);
        const [[kycPending]] = await db.query(`SELECT COUNT(*) AS n FROM owner_kyc_documents WHERE verification_status = 'PENDING'`);
        const [[payoutsPending]] = await db.query(`SELECT COUNT(*) AS n FROM owner_payouts WHERE status = 'PENDING'`);
        const [[membershipsPending]] = await db.query(`SELECT COUNT(*) AS n FROM vendor_memberships WHERE status = 'PENDING'`);

        const [[bookingValue]] = await db.query(
            `SELECT COALESCE(SUM(p.confirmation_payment), 0) AS total FROM room_bookings b
             JOIN properties p ON b.property_id = p.id WHERE b.status IN ('CONFIRMED', 'COMPLETED')`
        );
        const [[orderValue]] = await db.query(
            `SELECT COALESCE(SUM(total_amount), 0) AS total FROM tiffin_orders WHERE status IN ('CONFIRMED', 'DELIVERED')`
        );
        const [[subscriptionValue]] = await db.query(
            `SELECT COALESCE(SUM(price), 0) AS total FROM tiffin_subscriptions WHERE status IN ('ACTIVE', 'PAUSED', 'COMPLETED')`
        );
        const [[membershipValue]] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM vendor_memberships WHERE status = 'ACTIVE' AND end_date >= CURDATE()`
        );

        const bVal = Number(bookingValue.total) || 0;
        const oVal = Number(orderValue.total) || 0;
        const sVal = Number(subscriptionValue.total) || 0;
        const mVal = Number(membershipValue.total) || 0;
        const totalGross = bVal + oVal + sVal + mVal;

        const pendingTiffins = tiffinPending.n || 0;
        const pendingKyc = kycPending.n || 0;
        const pendingPayouts = payoutsPending.n || 0;
        const pendingMemberships = membershipsPending.n || 0;

        res.status(200).json({
            status: 'success',
            data: {
                total_users: totalUsers,
                users_by_role: usersByRole,
                total_properties: propertyStats.total || 0,
                active_properties: propertyStats.active || 0,
                total_tiffin_services: tiffinStats.total || 0,
                active_tiffin_services: tiffinStats.active || 0,
                total_bookings: bookingStats.total || 0,
                total_tiffin_orders: orderStats.total || 0,
                total_tiffin_subscriptions: subscriptionStats.total || 0,
                active_vendor_memberships: membershipStats.active_vendor_memberships || 0,

                pending_actions: {
                    tiffin_services_pending: pendingTiffins,
                    owner_kyc_pending: pendingKyc,
                    owner_payouts_pending: pendingPayouts,
                    tiffin_approvals: pendingTiffins,
                    kyc_verifications: pendingKyc,
                    payout_requests: pendingPayouts
                },
                needs_action: {
                    pending_tiffin_approvals: pendingTiffins,
                    pending_kyc: pendingKyc,
                    pending_payouts: pendingPayouts,
                    pending_memberships: pendingMemberships
                },

                gross_platform_activity: {
                    bookings_value: bVal,
                    tiffin_orders_value: oVal,
                    tiffin_subscriptions_value: sVal,
                    vendor_memberships_value: mVal,
                    total_gross_value: totalGross
                },
                gross_transaction_value: {
                    booking_value: bVal,
                    tiffin_order_value: oVal,
                    subscription_value: sVal,
                    total: bVal + oVal + sVal
                },

                // Backward-compatibility aliases
                users: userStats,
                properties: propertyStats,
                tiffin_services: tiffinStats,
                bookings: bookingStats,
                tiffin_orders: orderStats
            }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// USER MANAGEMENT
// =============================================================================

// @route   GET /api/v1/admin/users?role=&search=&page=&limit=
// @access  Private (ADMIN)
exports.getUsers = async (req, res, next) => {
    try {
        const { role, search } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (role) {
            whereClause += ' AND role = ?';
            params.push(role);
        }
        if (search) {
            whereClause += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
            const like = `%${search}%`;
            params.push(like, like, like);
        }

        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM users ${whereClause}`, params);

        const [users] = await db.query(
            `SELECT id, full_name, email, phone, role, is_suspended, suspended_reason, suspension_reason,
                    (deleted_at IS NOT NULL) AS is_deleted, deleted_at, referral_code, created_at
             FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.status(200).json({ status: 'success', results: users.length, total, page, limit, data: { users } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/admin/users/:id
// @access  Private (ADMIN)
exports.getUserDetails = async (req, res, next) => {
    try {
        const userId = req.params.id;

        const [[user]] = await db.query(
            `SELECT id, full_name, email, phone, role, is_suspended, suspended_reason, suspension_reason,
                    deleted_at, referral_code, created_at
             FROM users WHERE id = ?`,
            [userId]
        );
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let extra = {};
        if (user.role === 'OWNER') {
            const [[row]] = await db.query(`SELECT COUNT(*) AS property_count FROM properties WHERE owner_id = ?`, [userId]);
            extra = row || {};
        } else if (user.role === 'VENDOR') {
            const [[row]] = await db.query(`SELECT COUNT(*) AS tiffin_service_count FROM tiffin_services WHERE vendor_id = ?`, [userId]);
            extra = row || {};
        } else if (user.role === 'STUDENT') {
            const [[row]] = await db.query(`SELECT COUNT(*) AS booking_count FROM room_bookings WHERE student_id = ?`, [userId]);
            extra = row || {};
        }

        res.status(200).json({ status: 'success', data: { user: { ...user, ...extra } } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/users/:id/suspend
// @access  Private (ADMIN)
exports.suspendUser = async (req, res, next) => {
    try {
        const targetUserId = req.params.id;
        const { reason } = req.body;

        if (Number(targetUserId) === req.user.id) {
            return res.status(400).json({ status: 'error', message: 'You cannot suspend your own account' });
        }

        const [result] = await db.query(
            `UPDATE users 
             SET is_suspended = 1, suspended_reason = ?, suspension_reason = ? 
             WHERE id = ? AND role != 'ADMIN' AND is_suspended = 0`,
            [reason, reason, targetUserId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'User not found, already suspended, or is an admin account' });
        }

        const [[user]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [targetUserId]);
        if (user) {
            await sendEmail({
                email: user.email,
                subject: `Your Account Has Been Suspended`,
                html: `
                    <h3>Hello ${user.full_name},</h3>
                    <p>Your Quark Housing account has been suspended.</p>
                    <p><b>Reason:</b> ${reason}</p>
                    <p>Contact support if you believe this is a mistake.</p>
                `
            }).catch((err) => console.error('Suspension email failed to send:', err));
        }

        res.status(200).json({ status: 'success', message: 'User suspended. This takes effect on their very next request.' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/admin/users/:id/unsuspend
// @access  Private (ADMIN)
exports.unsuspendUser = async (req, res, next) => {
    try {
        const [result] = await db.query(
            `UPDATE users SET is_suspended = 0, suspended_reason = NULL, suspension_reason = NULL WHERE id = ? AND is_suspended = 1`,
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'User not found or not currently suspended' });
        }
        res.status(200).json({ status: 'success', message: 'User unsuspended' });
    } catch (error) {
        next(error);
    }
};
