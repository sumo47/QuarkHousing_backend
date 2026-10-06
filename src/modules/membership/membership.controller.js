// src/modules/membership/membership.controller.js
const db = require('../../config/db');
const sendEmail = require('../../utils/email');

const ADMIN_EMAIL = process.env.SMTP_USER; // Same convention as booking.controller.js

// @route   GET /api/v1/membership/plans
// @access  Public
exports.getPlans = async (req, res, next) => {
    try {
        const [plans] = await db.query(
            `SELECT id, duration_months, price FROM vendor_membership_plans WHERE is_active = 1 ORDER BY duration_months ASC`
        );
        res.status(200).json({ status: 'success', data: { plans } });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/membership/purchase
// @access  Private (VENDOR)
// NOTE: No payment gateway yet -- this just creates a PENDING request. It
// gets manually flipped to ACTIVE (see sql/006_vendor_membership.sql for the
// exact query), same workaround pattern as bookings and owner payouts.
exports.purchaseMembership = async (req, res, next) => {  //needs admin approval
    try {
        const vendorId = req.user.id;
        const { plan_id } = req.body;

        const [[plan]] = await db.query(
            `SELECT id, duration_months, price FROM vendor_membership_plans WHERE id = ? AND is_active = 1`,
            [plan_id]
        );
        if (!plan) {
            return res.status(404).json({ status: 'error', message: 'Membership plan not found' });
        }

        // Block duplicate purchases if there's already a currently-active membership
        const [[activeMembership]] = await db.query(
            `SELECT id, end_date FROM vendor_memberships
             WHERE vendor_id = ? AND status = 'ACTIVE' AND end_date >= CURDATE()
             ORDER BY end_date DESC LIMIT 1`,
            [vendorId]
        );
        if (activeMembership) {
            return res.status(409).json({
                status: 'error',
                message: `You already have an active membership until ${activeMembership.end_date.toISOString().slice(0, 10)}`
            });
        }

        // Block duplicate PENDING requests too, rather than letting them pile up
        const [[pendingMembership]] = await db.query(
            `SELECT id FROM vendor_memberships WHERE vendor_id = ? AND status = 'PENDING' LIMIT 1`,
            [vendorId]
        );
        if (pendingMembership) {
            return res.status(409).json({
                status: 'error',
                message: 'You already have a membership purchase pending confirmation.'
            });
        }

        const [result] = await db.query(
            `INSERT INTO vendor_memberships (vendor_id, plan_id, duration_months, amount, status)
             VALUES (?, ?, ?, ?, 'PENDING')`,
            [vendorId, plan.id, plan.duration_months, plan.price]
        );

        // ---------------------------------------------------------
        // Notification emails (non-blocking, same pattern as other modules)
        // ---------------------------------------------------------
        const [[vendor]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [vendorId]);

        const vendorMail = sendEmail({
            email: vendor.email,
            subject: `Membership Purchase Received - Pending Confirmation`,
            html: `
                <h3>Hello ${vendor.full_name},</h3>
                <p>We've received your request for the <b>${plan.duration_months}-month</b> membership (₹${plan.price}).</p>
                <p>Your membership will be activated once payment is confirmed. You'll be able to add tiffin listings once it's active.</p>
            `
        });

        const adminMail = sendEmail({
            email: ADMIN_EMAIL,
            subject: `[ADMIN ALERT] Vendor Membership Pending Activation`,
            html: `
                <h3>New Membership Purchase Request</h3>
                <p><b>Vendor:</b> ${vendor.full_name} (${vendor.email})</p>
                <p><b>Plan:</b> ${plan.duration_months} months - ₹${plan.price}</p>
                <p><b>Membership ID:</b> ${result.insertId}</p>
                <p>Confirm payment and activate manually.</p>
            `
        });

        await Promise.all([vendorMail, adminMail]).catch((err) => {
            console.error('Email sending failed, but membership request was saved:', err);
        });

        res.status(201).json({
            status: 'success',
            message: 'Membership purchase submitted. It will be activated once payment is confirmed.',
            data: { membership_id: result.insertId, status: 'PENDING' }
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/membership/my-status
// @access  Private (VENDOR)
exports.getMyMembershipStatus = async (req, res, next) => {
    try {
        const vendorId = req.user.id;

        const [[latest]] = await db.query(
            `SELECT vm.*, p.duration_months AS plan_duration_months
             FROM vendor_memberships vm
             JOIN vendor_membership_plans p ON vm.plan_id = p.id
             WHERE vm.vendor_id = ?
             ORDER BY vm.created_at DESC LIMIT 1`,
            [vendorId]
        );

        if (!latest) {
            return res.status(200).json({ status: 'success', data: { has_membership: false, effective_status: 'NONE' } });
        }

        // Never trust the stored status alone for "is it active right now" --
        // a membership can be marked ACTIVE in the DB but its end_date may
        // have already passed (no cron job flips it to EXPIRED automatically
        // yet), so compute the real-world status here instead.
        const today = new Date().toISOString().slice(0, 10);
        const isCurrentlyActive = latest.status === 'ACTIVE' && latest.end_date && latest.end_date.toISOString().slice(0, 10) >= today;

        let daysLeft = 0;
        if (isCurrentlyActive) {
            const diffMs = new Date(latest.end_date) - new Date(today);
            daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }

        res.status(200).json({
            status: 'success',
            data: {
                has_membership: true,
                effective_status: isCurrentlyActive ? 'ACTIVE' : (latest.status === 'PENDING' ? 'PENDING' : 'EXPIRED'),
                membership: latest,
                days_left: daysLeft
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/membership/history
// @access  Private (VENDOR)
exports.getMembershipHistory = async (req, res, next) => {
    try {
        const [history] = await db.query(
            `SELECT vm.id, vm.duration_months, vm.amount, vm.status, vm.start_date, vm.end_date, vm.created_at
             FROM vendor_memberships vm
             WHERE vm.vendor_id = ?
             ORDER BY vm.created_at DESC`,
            [req.user.id]
        );
        res.status(200).json({ status: 'success', results: history.length, data: { history } });
    } catch (error) {
        next(error);
    }
};