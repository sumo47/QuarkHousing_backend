// src/modules/subscriptions/subscriptions.controller.js
const db = require('../../config/db');
const sendEmail = require('../../utils/email');

const ADMIN_EMAIL = process.env.SMTP_USER; // Same convention as booking.controller.js

const todayStr = () => new Date().toISOString().slice(0, 10);

// Which meal_type values a subscription's meal_coverage actually allows
const coveredMeals = (mealCoverage) => {
    if (mealCoverage === 'LUNCH') return ['LUNCH'];
    if (mealCoverage === 'DINNER') return ['DINNER'];
    return ['LUNCH', 'DINNER']; // BOTH
};

// =============================================================================
// PURCHASE (and shared internal logic reused by Renew)
// =============================================================================

// Internal helper: validates the plan is still purchasable, creates the
// subscription row, and sends the 3-way notification emails. Returns the
// new subscription's id. Used by BOTH purchaseSubscription and
// renewSubscription so they can never drift out of sync with each other.
// Throws { status, message } on validation failure -- callers turn that
// into the right HTTP response.
async function createSubscriptionRecord(customerId, tiffinServiceId, planId) {
    const [[plan]] = await db.query(
        `SELECT p.id, p.plan_type, p.meal_coverage, p.price,
                ts.id AS service_id, ts.name AS service_name, ts.vendor_id,
                v.full_name AS vendor_name, v.email AS vendor_email
         FROM tiffin_subscription_plans p
         JOIN tiffin_services ts ON p.tiffin_service_id = ts.id
         JOIN users v ON ts.vendor_id = v.id
         WHERE p.id = ? AND p.tiffin_service_id = ? AND p.is_active = 1
           AND ts.approval_status = 'APPROVED' AND ts.is_active = 1
           AND EXISTS (
               SELECT 1 FROM vendor_memberships vm
               WHERE vm.vendor_id = ts.vendor_id AND vm.status = 'ACTIVE' AND vm.end_date >= CURDATE()
           )
           AND COALESCE((SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ts.vendor_id), 1) = 1`,
        [planId, tiffinServiceId]
    );

    if (!plan) {
        throw { status: 404, message: 'This plan is not available right now' };
    }

    const [result] = await db.query(
        `INSERT INTO tiffin_subscriptions (customer_id, tiffin_service_id, plan_id, plan_type, meal_coverage, price, status)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
        [customerId, tiffinServiceId, planId, plan.plan_type, plan.meal_coverage, plan.price]
    );

    const [[customer]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [customerId]);

    const customerMail = sendEmail({
        email: customer.email,
        subject: `Subscription Request Received - ${plan.service_name}`,
        html: `
            <h3>Hello ${customer.full_name},</h3>
            <p>Your ${plan.plan_type.toLowerCase()} subscription (${plan.meal_coverage.toLowerCase()}) to <b>${plan.service_name}</b> has been submitted.</p>
            <p><b>Price:</b> ₹${plan.price}</p>
            <p>It will be activated once payment is confirmed.</p>
        `
    });

    const vendorMail = sendEmail({
        email: plan.vendor_email,
        subject: `New Subscription Request - ${plan.service_name}`,
        html: `
            <h3>Hello ${plan.vendor_name},</h3>
            <p>${customer.full_name} has requested a ${plan.plan_type.toLowerCase()} subscription (${plan.meal_coverage.toLowerCase()}).</p>
            <p><b>Price:</b> ₹${plan.price}</p>
        `
    });

    const adminMail = sendEmail({
        email: ADMIN_EMAIL,
        subject: `[ADMIN ALERT] New Tiffin Subscription Pending`,
        html: `
            <h3>New Subscription Request</h3>
            <p><b>Customer:</b> ${customer.full_name} (${customer.email})</p>
            <p><b>Service:</b> ${plan.service_name}</p>
            <p><b>Plan:</b> ${plan.plan_type} - ${plan.meal_coverage} - ₹${plan.price}</p>
            <p><b>Subscription ID:</b> ${result.insertId}</p>
        `
    });

    await Promise.all([customerMail, vendorMail, adminMail]).catch((err) => {
        console.error('Email sending failed, but subscription request was saved:', err);
    });

    return result.insertId;
}

// @route   POST /api/v1/subscriptions
// @access  Private (STUDENT)
exports.purchaseSubscription = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { tiffin_service_id, plan_id } = req.body;

        const subscriptionId = await createSubscriptionRecord(customerId, tiffin_service_id, plan_id);

        res.status(201).json({
            status: 'success',
            message: 'Subscription request submitted. It will be activated once payment is confirmed.',
            data: { subscription_id: subscriptionId, status: 'PENDING' }
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

// @route   POST /api/v1/subscriptions/:id/renew
// @access  Private (STUDENT, own only)
// Renews an existing subscription with the SAME plan (same tiffin service,
// same plan_id -- "the same menu" per how this was described). Creates a
// brand new subscription row (own PENDING -> payment-confirm cycle, exactly
// like a fresh purchase) rather than extending the old one's end_date, so
// history/earnings/calendar for each cycle stay cleanly separated.
// If the OLD subscription is still marked ACTIVE but its end_date has
// already passed, this also lazily marks it COMPLETED first.
exports.renewSubscription = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const subscriptionId = req.params.id;

        const [[oldSub]] = await db.query(
            `SELECT id, tiffin_service_id, plan_id, status, end_date
             FROM tiffin_subscriptions WHERE id = ? AND customer_id = ?`,
            [subscriptionId, customerId]
        );
        if (!oldSub) {
            return res.status(404).json({ status: 'error', message: 'Subscription not found' });
        }
        if (!['ACTIVE', 'PAUSED', 'COMPLETED'].includes(oldSub.status)) {
            return res.status(400).json({
                status: 'error',
                message: `Cannot renew a subscription that is ${oldSub.status.toLowerCase()} -- only an active, paused, or completed one can be renewed.`
            });
        }

        // Lazy-expire: if it's still marked ACTIVE but end_date has passed, fix that now.
        const today = todayStr();
        if (oldSub.status === 'ACTIVE' && oldSub.end_date && oldSub.end_date.toISOString().slice(0, 10) < today) {
            await db.query(`UPDATE tiffin_subscriptions SET status = 'COMPLETED' WHERE id = ?`, [subscriptionId]);
        }

        const newSubscriptionId = await createSubscriptionRecord(customerId, oldSub.tiffin_service_id, oldSub.plan_id);

        res.status(201).json({
            status: 'success',
            message: 'Renewal submitted with the same plan. It will be activated once payment is confirmed.',
            data: { subscription_id: newSubscriptionId, renewed_from: Number(subscriptionId), status: 'PENDING' }
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

// =============================================================================
// LIST / DETAIL / HISTORY
// =============================================================================

// @route   GET /api/v1/subscriptions
// @access  Private (STUDENT)
// "My Tiffin Subscriptions" -- currently live ones (ACTIVE or PAUSED)
exports.getMySubscriptions = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const today = todayStr();

        const [subscriptions] = await db.query(
            `SELECT s.id, s.plan_type, s.meal_coverage, s.price, s.status, s.start_date, s.end_date,
                    ts.name AS service_name,
                    DATEDIFF(s.end_date, ?) AS days_left
             FROM tiffin_subscriptions s
             JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
             WHERE s.customer_id = ? AND s.status IN ('ACTIVE', 'PAUSED')
             ORDER BY s.end_date ASC`,
            [today, customerId]
        );

        res.status(200).json({ status: 'success', results: subscriptions.length, data: { subscriptions } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/subscriptions/history
// @access  Private (STUDENT)
exports.getSubscriptionHistory = async (req, res, next) => {
    try {
        const [history] = await db.query(
            `SELECT s.id, s.plan_type, s.meal_coverage, s.price, s.status, s.start_date, s.end_date,
                    ts.name AS service_name
             FROM tiffin_subscriptions s
             JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
             WHERE s.customer_id = ? AND s.status IN ('COMPLETED', 'CANCELLED')
             ORDER BY s.end_date DESC`,
            [req.user.id]
        );
        res.status(200).json({ status: 'success', results: history.length, data: { history } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/subscriptions/:id
// @access  Private (STUDENT, own only)
exports.getSubscriptionDetails = async (req, res, next) => {
    try {
        const [[subscription]] = await db.query(
            `SELECT s.*, ts.name AS service_name
             FROM tiffin_subscriptions s
             JOIN tiffin_services ts ON s.tiffin_service_id = ts.id
             WHERE s.id = ? AND s.customer_id = ?`,
            [req.params.id, req.user.id]
        );

        if (!subscription) {
            return res.status(404).json({ status: 'error', message: 'Subscription not found' });
        }

        res.status(200).json({ status: 'success', data: { subscription } });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// PAUSE / RESUME
// =============================================================================

// @route   PATCH /api/v1/subscriptions/:id/pause
// @access  Private (STUDENT, own only)
exports.pauseSubscription = async (req, res, next) => {
    try {
        const [result] = await db.query(
            `UPDATE tiffin_subscriptions SET status = 'PAUSED' WHERE id = ? AND customer_id = ? AND status = 'ACTIVE'`,
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No active subscription found with this id' });
        }
        res.status(200).json({ status: 'success', message: 'Subscription paused' });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/subscriptions/:id/resume
// @access  Private (STUDENT, own only)
exports.resumeSubscription = async (req, res, next) => {
    try {
        const [result] = await db.query(
            `UPDATE tiffin_subscriptions SET status = 'ACTIVE' WHERE id = ? AND customer_id = ? AND status = 'PAUSED'`,
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'No paused subscription found with this id' });
        }
        res.status(200).json({ status: 'success', message: 'Subscription resumed' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// DAILY PREFERENCE CALENDAR
// =============================================================================

// @route   GET /api/v1/subscriptions/:id/calendar?month=YYYY-MM
// @access  Private (STUDENT, own only)
exports.getCalendar = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const subscriptionId = req.params.id;

        const [[subscription]] = await db.query(
            `SELECT id, meal_coverage, start_date, end_date FROM tiffin_subscriptions WHERE id = ? AND customer_id = ?`,
            [subscriptionId, customerId]
        );
        if (!subscription) {
            return res.status(404).json({ status: 'error', message: 'Subscription not found' });
        }

        // Default to the current month if none given
        const monthParam = req.query.month || todayStr().slice(0, 7); // "YYYY-MM"
        if (!/^\d{4}-\d{2}$/.test(monthParam)) {
            return res.status(400).json({ status: 'error', message: 'month must be YYYY-MM' });
        }
        const [year, month] = monthParam.split('-').map(Number);
        const firstDay = `${monthParam}-01`;
        const lastDayNum = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this month
        const lastDay = `${monthParam}-${String(lastDayNum).padStart(2, '0')}`;

        const [rows] = await db.query(
            `SELECT preference_date, meal_type, preference
             FROM tiffin_subscription_preferences
             WHERE subscription_id = ? AND preference_date BETWEEN ? AND ?`,
            [subscriptionId, firstDay, lastDay]
        );

        // Index saved preferences by "date|meal_type" for quick lookup
        const savedMap = {};
        rows.forEach((r) => {
            const dateStr = r.preference_date.toISOString().slice(0, 10);
            savedMap[`${dateStr}|${r.meal_type}`] = r.preference;
        });

        const meals = coveredMeals(subscription.meal_coverage);
        const startDateStr = subscription.start_date ? subscription.start_date.toISOString().slice(0, 10) : null;
        const endDateStr = subscription.end_date ? subscription.end_date.toISOString().slice(0, 10) : null;

        const days = [];
        for (let d = 1; d <= lastDayNum; d++) {
            const dateStr = `${monthParam}-${String(d).padStart(2, '0')}`;
            const inRange = startDateStr && endDateStr && dateStr >= startDateStr && dateStr <= endDateStr;

            const preferences = {};
            meals.forEach((meal) => {
                preferences[meal] = savedMap[`${dateStr}|${meal}`] || null; // null = "Not Set" (gray)
            });

            days.push({ date: dateStr, in_range: !!inRange, preferences });
        }

        res.status(200).json({ status: 'success', data: { month: monthParam, meal_coverage: subscription.meal_coverage, days } });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/v1/subscriptions/:id/calendar
// @access  Private (STUDENT, own only, subscription must be ACTIVE)
// Body: { date: "2026-05-12", preferences: [{ meal_type: "LUNCH", preference: "WILL_HAVE" }, ...] }
// Saves one or more meals for a single date in one call, matching the single
// "Save Preference" button in the PDF mockup that commits Lunch + Dinner together.
exports.updateCalendar = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const subscriptionId = req.params.id;
        const { date, preferences } = req.body;

        const [[subscription]] = await db.query(
            `SELECT id, meal_coverage, start_date, end_date, status
             FROM tiffin_subscriptions WHERE id = ? AND customer_id = ?`,
            [subscriptionId, customerId]
        );
        if (!subscription) {
            return res.status(404).json({ status: 'error', message: 'Subscription not found' });
        }
        if (subscription.status !== 'ACTIVE') {
            return res.status(400).json({ status: 'error', message: `Cannot set preferences while subscription is ${subscription.status}` });
        }

        if (date < todayStr()) {
            return res.status(400).json({ status: 'error', message: 'Cannot change preferences for a past date' });
        }

        const startDateStr = subscription.start_date.toISOString().slice(0, 10);
        const endDateStr = subscription.end_date.toISOString().slice(0, 10);
        if (date < startDateStr || date > endDateStr) {
            return res.status(400).json({ status: 'error', message: `date must be within the subscription period (${startDateStr} to ${endDateStr})` });
        }

        const allowedMeals = coveredMeals(subscription.meal_coverage);
        const invalidMeal = preferences.find((p) => !allowedMeals.includes(p.meal_type));
        if (invalidMeal) {
            return res.status(400).json({
                status: 'error',
                message: `This subscription only covers ${subscription.meal_coverage}. "${invalidMeal.meal_type}" is not part of it.`
            });
        }

        for (const p of preferences) {
            await db.query(
                `INSERT INTO tiffin_subscription_preferences (subscription_id, preference_date, meal_type, preference)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE preference = VALUES(preference)`,
                [subscriptionId, date, p.meal_type, p.preference]
            );
        }

        res.status(200).json({ status: 'success', message: 'Preference saved' });
    } catch (error) {
        next(error);
    }
};