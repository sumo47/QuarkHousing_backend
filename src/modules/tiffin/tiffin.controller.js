// src/modules/tiffin/tiffin.controller.js
const db = require('../../config/db');
const sendEmail = require('../../utils/email');

const ADMIN_EMAIL = process.env.SMTP_USER; // Same convention as booking.controller.js

const isTrue = (val) => (val === 'true' || val === '1' ? 1 : 0);

async function assertOwnsTiffinService(connectionOrPool, vendorId, tiffinServiceId) {
    const [rows] = await connectionOrPool.query(
        `SELECT id, approval_status FROM tiffin_services WHERE id = ? AND vendor_id = ?`,
        [tiffinServiceId, vendorId]
    );
    return rows[0] || null;
}

// =============================================================================
// VENDOR: Create / My Services / Update / Status / Delete
// =============================================================================

// @route   POST /api/v1/tiffin
// @access  Private (VENDOR)
exports.createTiffinService = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const vendorId = req.user.id;
        const data = req.body;

        const [existing] = await connection.query(
            `SELECT ts.id FROM tiffin_services ts
             JOIN tiffin_addresses a ON ts.id = a.tiffin_service_id
             WHERE ts.vendor_id = ? AND ts.name = ? AND a.pincode = ?`,
            [vendorId, data.name, data.pincode]
        );
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ status: 'error', message: 'You already have a tiffin service with this name at this location' });
        }

        const [serviceResult] = await connection.query(
            `INSERT INTO tiffin_services
                (vendor_id, name, description, veg_type, breakfast_available, lunch_available, dinner_available,
                 price_per_meal, delivery_start_time, delivery_end_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                vendorId, data.name, data.description || null, data.veg_type,
                isTrue(data.breakfast_available), isTrue(data.lunch_available), isTrue(data.dinner_available),
                parseFloat(data.price_per_meal), data.delivery_start_time || null, data.delivery_end_time || null
            ]
        );

        const tiffinServiceId = serviceResult.insertId;

        await connection.query(
            `INSERT INTO tiffin_addresses
                (tiffin_service_id, address_line, locality, landmark, city, state, pincode, google_maps_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tiffinServiceId, data.address_line, data.locality, data.landmark || null,
                data.city, data.state, data.pincode, data.google_maps_url || null
            ]
        );

        if (req.files && req.files.length > 0) {
            const mediaQueries = req.files.map((file) =>
                connection.query(`INSERT INTO tiffin_media (tiffin_service_id, image_url) VALUES (?, ?)`, [tiffinServiceId, file.path])
            );
            await Promise.all(mediaQueries);
        }

        await connection.commit();

        // ---------------------------------------------------------
        // Notification emails (same non-blocking pattern as bookings)
        // ---------------------------------------------------------
        const [[vendor]] = await db.query(`SELECT full_name, email FROM users WHERE id = ?`, [vendorId]);

        const vendorMail = sendEmail({
            email: vendor.email,
            subject: `Tiffin Service Submitted for Approval - ${data.name}`,
            html: `
                <h3>Hello ${vendor.full_name},</h3>
                <p>Your tiffin service <b>${data.name}</b> has been submitted and is now pending approval.</p>
                <p>We'll notify you by email as soon as it's reviewed.</p>
            `
        });

        const adminMail = sendEmail({
            email: ADMIN_EMAIL,
            subject: `[ADMIN ALERT] New Tiffin Service Pending Approval - ${data.name}`,
            html: `
                <h3>New Tiffin Service Submitted</h3>
                <p><b>Vendor:</b> ${vendor.full_name} (${vendor.email})</p>
                <p><b>Service:</b> ${data.name} (ID: ${tiffinServiceId})</p>
                <p><b>Location:</b> ${data.locality}, ${data.city}</p>
                <p>Please review it in the admin approval queue.</p>
            `
        });

        await Promise.all([vendorMail, adminMail]).catch((err) => {
            console.error('Email sending failed, but tiffin service was saved:', err);
        });

        res.status(201).json({
            status: 'success',
            message: 'Tiffin service submitted for approval',
            data: { tiffin_service_id: tiffinServiceId, approval_status: 'PENDING' }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// @route   GET /api/v1/tiffin/my-services
// @access  Private (VENDOR)
exports.getMyTiffinServices = async (req, res, next) => {
    try {
        const vendorId = req.user.id;

        const [services] = await db.query(
            `SELECT ts.id, ts.name, ts.veg_type, ts.price_per_meal, ts.approval_status,
                    ts.rejection_reason, ts.is_active, ts.created_at,
                    a.city, a.locality,
                    (SELECT image_url FROM tiffin_media WHERE tiffin_service_id = ts.id LIMIT 1) AS thumbnail
             FROM tiffin_services ts
             JOIN tiffin_addresses a ON ts.id = a.tiffin_service_id
             WHERE ts.vendor_id = ?
             ORDER BY ts.created_at DESC`,
            [vendorId]
        );

        res.status(200).json({ status: 'success', results: services.length, data: { services } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/tiffin/:id
// @access  Private (VENDOR)
exports.updateTiffinService = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const vendorId = req.user.id;
        const tiffinServiceId = req.params.id;
        const data = req.body;

        await connection.beginTransaction();

        const owns = await assertOwnsTiffinService(connection, vendorId, tiffinServiceId);
        if (!owns) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or does not belong to you' });
        }

        const serviceFields = {
            name: data.name,
            description: data.description,
            veg_type: data.veg_type,
            breakfast_available: data.breakfast_available !== undefined ? isTrue(data.breakfast_available) : undefined,
            lunch_available: data.lunch_available !== undefined ? isTrue(data.lunch_available) : undefined,
            dinner_available: data.dinner_available !== undefined ? isTrue(data.dinner_available) : undefined,
            price_per_meal: data.price_per_meal !== undefined ? parseFloat(data.price_per_meal) : undefined,
            delivery_start_time: data.delivery_start_time,
            delivery_end_time: data.delivery_end_time
        };
        const serviceSets = Object.entries(serviceFields).filter(([, v]) => v !== undefined);
        if (serviceSets.length > 0) {
            const setClause = serviceSets.map(([k]) => `${k} = ?`).join(', ');
            const values = serviceSets.map(([, v]) => v);
            await connection.query(`UPDATE tiffin_services SET ${setClause} WHERE id = ?`, [...values, tiffinServiceId]);
        }

        const addressFields = {
            address_line: data.address_line,
            locality: data.locality,
            landmark: data.landmark,
            city: data.city,
            state: data.state,
            pincode: data.pincode,
            google_maps_url: data.google_maps_url
        };
        const addressSets = Object.entries(addressFields).filter(([, v]) => v !== undefined);
        if (addressSets.length > 0) {
            const setClause = addressSets.map(([k]) => `${k} = ?`).join(', ');
            const values = addressSets.map(([, v]) => v);
            await connection.query(`UPDATE tiffin_addresses SET ${setClause} WHERE tiffin_service_id = ?`, [...values, tiffinServiceId]);
        }

        if (req.files && req.files.length > 0) {
            const mediaQueries = req.files.map((file) =>
                connection.query(`INSERT INTO tiffin_media (tiffin_service_id, image_url) VALUES (?, ?)`, [tiffinServiceId, file.path])
            );
            await Promise.all(mediaQueries);
        }

        await connection.commit();

        res.status(200).json({ status: 'success', message: 'Tiffin service updated successfully' });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// @route   PATCH /api/v1/tiffin/:id/status
// @access  Private (VENDOR)
// Pause/resume a listing. Only usable once it's already APPROVED.
exports.toggleTiffinStatus = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const tiffinServiceId = req.params.id;
        const isActive = req.body.is_active === 'true' || req.body.is_active === '1';

        const service = await assertOwnsTiffinService(db, vendorId, tiffinServiceId);
        if (!service) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or does not belong to you' });
        }
        if (service.approval_status !== 'APPROVED') {
            return res.status(400).json({ status: 'error', message: `Cannot change status while listing is ${service.approval_status}` });
        }

        await db.query(`UPDATE tiffin_services SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, tiffinServiceId]);

        res.status(200).json({ status: 'success', message: `Tiffin service ${isActive ? 'activated' : 'paused'} successfully` });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/tiffin/:id
// @access  Private (VENDOR)
exports.deleteTiffinService = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const vendorId = req.user.id;
        const tiffinServiceId = req.params.id;

        await connection.beginTransaction();

        const owns = await assertOwnsTiffinService(connection, vendorId, tiffinServiceId);
        if (!owns) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or does not belong to you' });
        }

        // NOTE: once orders/subscriptions exist (next module), add the same
        // "has history -> soft delete instead" check used in owner.controller.js.
        await connection.query(`DELETE FROM tiffin_media WHERE tiffin_service_id = ?`, [tiffinServiceId]);
        await connection.query(`DELETE FROM tiffin_subscription_plans WHERE tiffin_service_id = ?`, [tiffinServiceId]);
        await connection.query(`DELETE FROM tiffin_daily_menu WHERE tiffin_service_id = ?`, [tiffinServiceId]);
        await connection.query(`DELETE FROM tiffin_addresses WHERE tiffin_service_id = ?`, [tiffinServiceId]);
        await connection.query(`DELETE FROM tiffin_services WHERE id = ?`, [tiffinServiceId]);

        await connection.commit();

        res.status(200).json({ status: 'success', message: 'Tiffin service deleted successfully' });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// =============================================================================
// VENDOR: Subscription Plans
// =============================================================================

// @route   POST /api/v1/tiffin/:id/plans
// @access  Private (VENDOR)
exports.createPlan = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const tiffinServiceId = req.params.id;
        const { plan_type, meal_coverage, price } = req.body;

        const owns = await assertOwnsTiffinService(db, vendorId, tiffinServiceId);
        if (!owns) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or does not belong to you' });
        }

        const [result] = await db.query(
            `INSERT INTO tiffin_subscription_plans (tiffin_service_id, plan_type, meal_coverage, price) VALUES (?, ?, ?, ?)`,
            [tiffinServiceId, plan_type, meal_coverage, parseFloat(price)]
        );

        res.status(201).json({ status: 'success', message: 'Plan added', data: { plan_id: result.insertId } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/tiffin/:id/plans
// @access  Public
exports.getPlans = async (req, res, next) => {
    try {
        const [plans] = await db.query(
            `SELECT p.id, p.plan_type, p.meal_coverage, p.price
             FROM tiffin_subscription_plans p
             JOIN tiffin_services ts ON p.tiffin_service_id = ts.id
             WHERE p.tiffin_service_id = ? AND p.is_active = 1
               AND EXISTS (
                   SELECT 1 FROM vendor_memberships vm
                   WHERE vm.vendor_id = ts.vendor_id AND vm.status = 'ACTIVE' AND vm.end_date >= CURDATE()
               )
               AND COALESCE((SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ts.vendor_id), 1) = 1`,
            [req.params.id]
        );
        res.status(200).json({ status: 'success', data: { plans } });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// VENDOR: Daily Menu
// =============================================================================

// @route   PUT /api/v1/tiffin/:id/menu
// @access  Private (VENDOR)
// Upsert the menu for a given date + meal (vendor updates this daily).
exports.upsertDailyMenu = async (req, res, next) => {
    try {
        const vendorId = req.user.id;
        const tiffinServiceId = req.params.id;
        const { menu_date, meal_type, items } = req.body;

        const owns = await assertOwnsTiffinService(db, vendorId, tiffinServiceId);
        if (!owns) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found or does not belong to you' });
        }

        await db.query(
            `INSERT INTO tiffin_daily_menu (tiffin_service_id, menu_date, meal_type, items)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE items = VALUES(items)`,
            [tiffinServiceId, menu_date, meal_type, items]
        );

        res.status(200).json({ status: 'success', message: 'Menu saved successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/tiffin/:id/menu?date=YYYY-MM-DD
// @access  Public (defaults to today if no date given)
exports.getDailyMenu = async (req, res, next) => {
    try {
        const tiffinServiceId = req.params.id;
        const date = req.query.date || new Date().toISOString().slice(0, 10);

        const [menu] = await db.query(
            `SELECT m.meal_type, m.items
             FROM tiffin_daily_menu m
             JOIN tiffin_services ts ON m.tiffin_service_id = ts.id
             WHERE m.tiffin_service_id = ? AND m.menu_date = ?
               AND EXISTS (
                   SELECT 1 FROM vendor_memberships vm
                   WHERE vm.vendor_id = ts.vendor_id AND vm.status = 'ACTIVE' AND vm.end_date >= CURDATE()
               )
               AND COALESCE((SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ts.vendor_id), 1) = 1`,
            [tiffinServiceId, date]
        );

        res.status(200).json({ status: 'success', data: { date, menu } });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// PUBLIC: Browse & Detail
// =============================================================================

// @route   GET /api/v1/tiffin?city=&veg_type=&meal_type=
// @access  Public
exports.searchTiffinServices = async (req, res, next) => {
    try {
        const { city, locality, veg_type, meal_type } = req.query;

        let query = `
            SELECT ts.id, ts.name, ts.veg_type, ts.price_per_meal,
                   ts.breakfast_available, ts.lunch_available, ts.dinner_available,
                   a.city, a.locality,
                   (SELECT image_url FROM tiffin_media WHERE tiffin_service_id = ts.id LIMIT 1) AS thumbnail
            FROM tiffin_services ts
            JOIN tiffin_addresses a ON ts.id = a.tiffin_service_id
            WHERE ts.approval_status = 'APPROVED' AND ts.is_active = 1
              AND EXISTS (
                  SELECT 1 FROM vendor_memberships vm
                  WHERE vm.vendor_id = ts.vendor_id AND vm.status = 'ACTIVE' AND vm.end_date >= CURDATE()
              )
              AND COALESCE((SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ts.vendor_id), 1) = 1
        `;
        const params = [];

        if (city) {
            query += ` AND a.city = ?`;
            params.push(city);
        }
        // Locality is more specific than city -- e.g. the "ask for location"
        // popup on the customer-facing Tiffin page (per the PDF) may capture
        // a neighbourhood/area rather than just the city name.
        if (locality) {
            query += ` AND a.locality LIKE ?`;
            params.push(`%${locality}%`);
        }
        if (veg_type) {
            query += ` AND (ts.veg_type = ? OR ts.veg_type = 'BOTH')`;
            params.push(veg_type);
        }
        if (meal_type === 'BREAKFAST') query += ` AND ts.breakfast_available = 1`;
        if (meal_type === 'LUNCH') query += ` AND ts.lunch_available = 1`;
        if (meal_type === 'DINNER') query += ` AND ts.dinner_available = 1`;

        query += ` ORDER BY ts.created_at DESC`;

        const [services] = await db.query(query, params);

        res.status(200).json({ status: 'success', results: services.length, data: { services } });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/tiffin/:id
// @access  Public
exports.getTiffinServiceDetails = async (req, res, next) => {
    try {
        const tiffinServiceId = req.params.id;

        const [rows] = await db.query(
            `SELECT ts.*, a.address_line, a.locality, a.landmark, a.city, a.state, a.pincode, a.google_maps_url
             FROM tiffin_services ts
             JOIN tiffin_addresses a ON ts.id = a.tiffin_service_id
             WHERE ts.id = ? AND ts.approval_status = 'APPROVED' AND ts.is_active = 1
               AND EXISTS (
                   SELECT 1 FROM vendor_memberships vm
                   WHERE vm.vendor_id = ts.vendor_id AND vm.status = 'ACTIVE' AND vm.end_date >= CURDATE()
               )
               AND COALESCE((SELECT accepting_orders FROM vendor_settings WHERE vendor_id = ts.vendor_id), 1) = 1`,
            [tiffinServiceId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Tiffin service not found' });
        }

        const [media] = await db.query(`SELECT image_url FROM tiffin_media WHERE tiffin_service_id = ?`, [tiffinServiceId]);
        const [plans] = await db.query(
            `SELECT id, plan_type, meal_coverage, price FROM tiffin_subscription_plans WHERE tiffin_service_id = ? AND is_active = 1`,
            [tiffinServiceId]
        );

        const today = new Date().toISOString().slice(0, 10);
        const [todaysMenu] = await db.query(
            `SELECT meal_type, items FROM tiffin_daily_menu WHERE tiffin_service_id = ? AND menu_date = ?`,
            [tiffinServiceId, today]
        );

        const [[reviewSummary]] = await db.query(
            `SELECT COUNT(*) AS total_reviews, COALESCE(ROUND(AVG(rating), 1), 0) AS average_rating
             FROM tiffin_reviews WHERE tiffin_service_id = ?`,
            [tiffinServiceId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                ...rows[0],
                media: media.map((m) => m.image_url),
                average_rating: Number(reviewSummary.average_rating),
                total_reviews: reviewSummary.total_reviews,
                plans,
                todays_menu: todaysMenu
            }
        });
    } catch (error) {
        next(error);
    }
};