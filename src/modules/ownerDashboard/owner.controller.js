// src/modules/owner/owner.controller.js
const db = require('../../config/db');
const sendEmail = require('../../utils/email');

// Booking statuses that count as "earned" money for an owner.
// Bookings are auto-confirmed on payment (no manual approve/reject step),
// so CONFIRMED/COMPLETED are the only statuses that generate earnings.
const EARNING_STATUSES = ['CONFIRMED', 'COMPLETED'];

// ---------------------------------------------------------------------------
// Small internal helper: computes an owner's earnings/payout balance.
// Reused by getOverview() and getEarnings() so the numbers never drift apart.
// ---------------------------------------------------------------------------
async function computeBalance(ownerId) {
    const [[earningsRow]] = await db.query(
        `SELECT COALESCE(SUM(p.confirmation_payment), 0) AS total_earnings
         FROM room_bookings b
         JOIN properties p ON b.property_id = p.id
         WHERE p.owner_id = ? AND b.status IN (?)`,
        [ownerId, EARNING_STATUSES]
    );

    const [[payoutRow]] = await db.query(
        `SELECT
            COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) AS total_withdrawn,
            COALESCE(SUM(CASE WHEN status IN ('PENDING','PROCESSING') THEN amount ELSE 0 END), 0) AS pending_payout
         FROM owner_payouts
         WHERE owner_id = ?`,
        [ownerId]
    );

    const total_earnings = Number(earningsRow.total_earnings);
    const total_withdrawn = Number(payoutRow.total_withdrawn);
    const pending_payout = Number(payoutRow.pending_payout);
    const available_balance = total_earnings - total_withdrawn - pending_payout;

    return { total_earnings, total_withdrawn, pending_payout, available_balance };
}

// =============================================================================
// 1. OVERVIEW
// =============================================================================

// @route   GET /api/v1/owner/overview
// @access  Private (OWNER)
exports.getOverview = async (req, res, next) => {
    try {
        const ownerId = req.user.id;

        const [[propertyStats]] = await db.query(
            `SELECT
                COUNT(*) AS total_properties,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_properties
             FROM properties WHERE owner_id = ?`,
            [ownerId]
        );

        const [[bookingStats]] = await db.query(
            `SELECT
                SUM(CASE WHEN b.status IN ('PENDING','CONFIRMED') THEN 1 ELSE 0 END) AS active_bookings,
                SUM(CASE WHEN b.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_bookings,
                COUNT(*) AS total_bookings
             FROM room_bookings b
             JOIN properties p ON b.property_id = p.id
             WHERE p.owner_id = ?`,
            [ownerId]
        );

        const balance = await computeBalance(ownerId);

        const [[kycRow]] = await db.query(
            `SELECT verification_status FROM owner_kyc_documents WHERE owner_id = ?`,
            [ownerId]
        );

        res.status(200).json({
            status: 'success',
            message: 'Owner dashboard overview',
            data: {
                total_properties: propertyStats.total_properties || 0,
                active_properties: propertyStats.active_properties || 0,
                active_bookings: bookingStats.active_bookings || 0,
                completed_bookings: bookingStats.completed_bookings || 0,
                total_bookings: bookingStats.total_bookings || 0,
                ...balance,
                kyc_status: kycRow ? kycRow.verification_status : 'NOT_SUBMITTED'
            }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 2. MY PROPERTIES
// =============================================================================

// @route   GET /api/v1/owner/properties
// @access  Private (OWNER)
exports.getMyProperties = async (req, res, next) => {
    try {
        const ownerId = req.user.id;

        const [properties] = await db.query(
            `SELECT
                p.id, p.title, p.property_type, p.gender_preference, p.monthly_rent,
                p.confirmation_payment, p.is_active, p.is_featured, p.created_at,
                a.city, a.locality,
                (SELECT image_url FROM property_media WHERE property_id = p.id LIMIT 1) AS thumbnail,
                (SELECT COUNT(*) FROM room_bookings WHERE property_id = p.id AND status IN ('PENDING','CONFIRMED')) AS active_booking_count,
                (SELECT COUNT(*) FROM room_bookings WHERE property_id = p.id) AS total_booking_count
             FROM properties p
             JOIN property_addresses a ON p.id = a.property_id
             WHERE p.owner_id = ?
             ORDER BY p.created_at DESC`,
            [ownerId]
        );

        res.status(200).json({
            status: 'success',
            results: properties.length,
            data: { properties }
        });
    } catch (error) {
        next(error);
    }
};

// Shared ownership check used by update / toggle-status / delete.
async function assertOwnsProperty(connectionOrPool, ownerId, propertyId) {
    const [rows] = await connectionOrPool.query(
        `SELECT id FROM properties WHERE id = ? AND owner_id = ?`,
        [propertyId, ownerId]
    );
    return rows.length > 0;
}

// @route   GET /api/v1/ownerDashboard/properties/:id
// @access  Private (OWNER)
exports.getPropertyById = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const propertyId = req.params.id;

        const [propertyResult] = await db.query(
            `SELECT p.*, a.address_line, a.locality, a.landmark, a.city, a.state, a.pincode, a.google_maps_url 
             FROM properties p
             JOIN property_addresses a ON p.id = a.property_id
             WHERE p.id = ? AND p.owner_id = ?`,
            [propertyId, ownerId]
        );

        if (propertyResult.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Property not found or does not belong to you' });
        }

        const [facilitiesResult] = await db.query(
            `SELECT * FROM property_facilities WHERE property_id = ?`,
            [propertyId]
        );

        const [mediaResult] = await db.query(
            `SELECT id, image_url FROM property_media WHERE property_id = ? ORDER BY id ASC`,
            [propertyId]
        );

        const propertyDetails = {
            ...propertyResult[0],
            facilities: facilitiesResult[0] || {},
            media: mediaResult.map((m) => m.image_url)
        };

        res.status(200).json({
            status: 'success',
            data: propertyDetails
        });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/owner/properties/:id
// @access  Private (OWNER)
exports.updateProperty = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const ownerId = req.user.id;
        const propertyId = req.params.id;
        const data = req.body;

        await connection.beginTransaction();

        // Enforce owner verification
        if (req.user.role !== 'ADMIN') {
            const [kycRows] = await connection.query(
                `SELECT verification_status FROM owner_kyc_documents WHERE owner_id = ? LIMIT 1`,
                [ownerId]
            );
            if (kycRows.length === 0 || kycRows[0].verification_status !== 'VERIFIED') {
                await connection.rollback();
                return res.status(403).json({
                    status: 'error',
                    message: 'Owner verification is required before you can update a property.'
                });
            }
        }

        const owns = await assertOwnsProperty(connection, ownerId, propertyId);
        if (!owns) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Property not found or does not belong to you' });
        }

        const isTrue = (val) => (val === 'true' || val === '1' ? 1 : 0);

        // --- properties table ---
        const propertyFields = {
            title: data.title,
            property_type: data.property_type,
            gender_preference: data.gender_preference,
            monthly_rent: data.monthly_rent !== undefined ? parseFloat(data.monthly_rent) : undefined,
            confirmation_payment: data.confirmation_payment !== undefined ? parseFloat(data.confirmation_payment) : undefined,
            distance_from_college: data.distance_from_college
        };
        const propertySets = Object.entries(propertyFields).filter(([, v]) => v !== undefined);
        if (propertySets.length > 0) {
            const setClause = propertySets.map(([k]) => `${k} = ?`).join(', ');
            const values = propertySets.map(([, v]) => v);
            await connection.query(`UPDATE properties SET ${setClause} WHERE id = ?`, [...values, propertyId]);
        }

        // --- property_addresses table ---
        const addressFields = {
            address_line: data.address_line,
            locality: data.locality,
            landmark: data.landmark,
            city: data.city,
            state: data.state,
            pincode: data.pincode,
            google_maps_url: data.google_maps_url !== undefined ? (data.google_maps_url || null) : undefined
        };
        const addressSets = Object.entries(addressFields).filter(([, v]) => v !== undefined);
        if (addressSets.length > 0) {
            const setClause = addressSets.map(([k]) => `${k} = ?`).join(', ');
            const values = addressSets.map(([, v]) => v);
            await connection.query(`UPDATE property_addresses SET ${setClause} WHERE property_id = ?`, [...values, propertyId]);
        }

        // --- property_facilities table ---
        const facilityFields = {
            attached_bathroom: data.attached_bathroom !== undefined ? isTrue(data.attached_bathroom) : undefined,
            wifi: data.wifi !== undefined ? isTrue(data.wifi) : undefined,
            quark_tiffin_available: data.quark_tiffin_available !== undefined ? isTrue(data.quark_tiffin_available) : undefined,
            veg_allowed: data.veg_allowed !== undefined ? isTrue(data.veg_allowed) : undefined,
            non_veg_allowed: data.non_veg_allowed !== undefined ? isTrue(data.non_veg_allowed) : undefined,
            parking: data.parking !== undefined ? isTrue(data.parking) : undefined,
            max_capacity: data.max_capacity !== undefined ? parseInt(data.max_capacity) : undefined
        };
        const facilitySets = Object.entries(facilityFields).filter(([, v]) => v !== undefined);
        if (facilitySets.length > 0) {
            const setClause = facilitySets.map(([k]) => `${k} = ?`).join(', ');
            const values = facilitySets.map(([, v]) => v);
            await connection.query(`UPDATE property_facilities SET ${setClause} WHERE property_id = ?`, [...values, propertyId]);
        }

        // --- remove deleted images (optional) ---
        if (data.delete_media_urls) {
            let urlsToDelete = [];
            try {
                urlsToDelete = typeof data.delete_media_urls === 'string'
                    ? JSON.parse(data.delete_media_urls)
                    : data.delete_media_urls;
            } catch {
                urlsToDelete = [data.delete_media_urls];
            }
            if (Array.isArray(urlsToDelete) && urlsToDelete.length > 0) {
                await connection.query(
                    `DELETE FROM property_media WHERE property_id = ? AND image_url IN (?)`,
                    [propertyId, urlsToDelete]
                );
            }
        }

        // --- new images (optional, appended to existing gallery) ---
        if (req.files && req.files.length > 0) {
            const mediaQueries = req.files.map((file) =>
                connection.query(`INSERT INTO property_media (property_id, image_url) VALUES (?, ?)`, [propertyId, file.path])
            );
            await Promise.all(mediaQueries);
        }

        // --- Validate maximum 15 total images for this property ---
        const [[{ totalMedia }]] = await connection.query(
            `SELECT COUNT(*) AS totalMedia FROM property_media WHERE property_id = ?`,
            [propertyId]
        );
        if (totalMedia > 15) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'A property listing can have a maximum of 15 photos in total.'
            });
        }

        await connection.commit();

        res.status(200).json({
            status: 'success',
            message: 'Property updated successfully',
            data: { property_id: propertyId }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// @route   PATCH /api/v1/owner/properties/:id/status
// @access  Private (OWNER)
// Pause ("is_active = false") or reactivate a listing, without deleting it.
exports.togglePropertyStatus = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const propertyId = req.params.id;
        const isActive = req.body.is_active === 'true' || req.body.is_active === '1';

        const owns = await assertOwnsProperty(db, ownerId, propertyId);
        if (!owns) {
            return res.status(404).json({ status: 'error', message: 'Property not found or does not belong to you' });
        }

        await db.query(`UPDATE properties SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, propertyId]);

        res.status(200).json({
            status: 'success',
            message: `Property ${isActive ? 'activated' : 'paused'} successfully`
        });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/owner/properties/:id
// @access  Private (OWNER)
// If the property has booking history, we soft-delete (deactivate) it instead
// of a hard delete, so booking records stay intact for guests/history/earnings.
exports.deleteProperty = async (req, res, next) => {
    const connection = await db.getConnection();
    try {
        const ownerId = req.user.id;
        const propertyId = req.params.id;

        await connection.beginTransaction();

        const owns = await assertOwnsProperty(connection, ownerId, propertyId);
        if (!owns) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Property not found or does not belong to you' });
        }

        const [[{ booking_count }]] = await connection.query(
            `SELECT COUNT(*) AS booking_count FROM room_bookings WHERE property_id = ?`,
            [propertyId]
        );

        if (booking_count > 0) {
            await connection.query(`UPDATE properties SET is_active = 0 WHERE id = ?`, [propertyId]);
            await connection.commit();
            return res.status(200).json({
                status: 'success',
                message: 'Property has booking history, so it has been deactivated (hidden from search) instead of permanently deleted.'
            });
        }

        // No bookings at all -> safe to hard delete along with child rows
        await connection.query(`DELETE FROM property_media WHERE property_id = ?`, [propertyId]);
        await connection.query(`DELETE FROM property_facilities WHERE property_id = ?`, [propertyId]);
        await connection.query(`DELETE FROM property_addresses WHERE property_id = ?`, [propertyId]);
        await connection.query(`DELETE FROM properties WHERE id = ?`, [propertyId]);

        await connection.commit();

        res.status(200).json({ status: 'success', message: 'Property deleted successfully' });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// =============================================================================
// 3. BOOKINGS
// =============================================================================

// @route   GET /api/v1/owner/bookings?status=PENDING&property_id=12&page=1&limit=10
// @access  Private (OWNER)
exports.getBookings = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const { status, property_id } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const offset = (page - 1) * limit;

        // let query = `
        //     SELECT
        //         b.id AS booking_id,
        //         b.check_in_date, b.check_out_date, b.purpose_of_stay, b.status, b.created_at,
        //         p.id AS property_id, p.title AS property_title, p.confirmation_payment
        //     FROM room_bookings b
        //     JOIN properties p ON b.property_id = p.id
        //     WHERE p.owner_id = ?
        // `;
        let query = `
            SELECT
                b.id AS booking_id,
                b.check_in_date, b.check_out_date, b.purpose_of_stay, b.status, b.created_at,
                p.id AS property_id, p.title AS property_title, p.confirmation_payment,
                u.full_name AS student_name, u.email AS student_email, u.phone AS student_phone
            FROM room_bookings b
            JOIN properties p ON b.property_id = p.id
            JOIN users u ON b.student_id = u.id
            WHERE p.owner_id = ?
        `;
		
        const params = [ownerId];

        if (status) {
            query += ` AND b.status = ?`;
            params.push(status);
        }
        if (property_id) {
            query += ` AND p.id = ?`;
            params.push(property_id);
        }

        query += ` ORDER BY b.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [bookings] = await db.query(query, params);

        res.status(200).json({
            status: 'success',
            results: bookings.length,
            page,
            limit,
            data: { bookings }
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/owner/bookings/:id
// @access  Private (OWNER)
exports.getBookingDetails = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const bookingId = req.params.id;

        const [rows] = await db.query(
            `SELECT
                b.*, p.title AS property_title, p.owner_id
             FROM room_bookings b
             JOIN properties p ON b.property_id = p.id
             WHERE b.id = ? AND p.owner_id = ?`,
            [bookingId, ownerId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Booking not found' });
        }

        res.status(200).json({ status: 'success', data: { booking: rows[0] } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/ownerDashboard/bookings/:id/accept
// @access  Private (OWNER)
exports.acceptBooking = async (req, res, next) => {
    let connection;
    try {
        const ownerId = req.user.id;
        const bookingId = Number(req.params.id);

        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid booking ID. Must be a valid positive integer.'
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Fetch booking with row lock
        const [rows] = await connection.query(
            `SELECT b.id, b.status, b.check_in_date, b.check_out_date, b.student_id, b.guest_email,
                    p.id AS property_id, p.owner_id, p.title AS property_title,
                    u.full_name AS student_name, u.email AS student_email
             FROM room_bookings b
             JOIN properties p ON b.property_id = p.id
             LEFT JOIN users u ON b.student_id = u.id
             WHERE b.id = ?
             FOR UPDATE`,
            [bookingId]
        );

        if (rows.length === 0) {
            const [[rawBooking]] = await connection.query(
                `SELECT id FROM room_bookings WHERE id = ?`,
                [bookingId]
            );
            await connection.rollback();
            connection.release();
            connection = null;

            if (!rawBooking) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Booking not found'
                });
            }
            return res.status(404).json({
                status: 'error',
                message: 'Associated property not found'
            });
        }

        const booking = rows[0];

        // 2. Ownership check: Must belong to authenticated owner
        if (booking.owner_id !== ownerId) {
            await connection.rollback();
            connection.release();
            connection = null;
            return res.status(403).json({
                status: 'error',
                message: 'Forbidden: You do not own the property associated with this booking'
            });
        }

        // 3. Status check: Must currently be PENDING
        if (booking.status !== 'PENDING') {
            await connection.rollback();
            connection.release();
            connection = null;
            return res.status(409).json({
                status: 'error',
                message: `Cannot accept booking with status ${booking.status}. Only PENDING bookings can be accepted.`
            });
        }

        // 4. Update status to CONFIRMED
        await connection.query(
            `UPDATE room_bookings SET status = 'CONFIRMED' WHERE id = ?`,
            [bookingId]
        );

        await connection.commit();
        connection.release();
        connection = null;

        // 5. Send notification to student (non-blocking)
        const recipientEmail = booking.student_email || booking.guest_email;
        if (recipientEmail) {
            sendEmail({
                email: recipientEmail,
                subject: `Your Booking Request Has Been Accepted - ${booking.property_title}`,
                html: `
                    <h3>Hello ${booking.student_name || 'Guest'},</h3>
                    <p>Great news! Your room booking request for <b>${booking.property_title}</b> has been accepted by the property owner.</p>
                    <p><b>Stay Dates:</b> ${booking.check_in_date} to ${booking.check_out_date}</p>
                    <p><b>Status:</b> CONFIRMED</p>
                    <p>You can review your confirmed booking details in your student dashboard.</p>
                `
            }).catch(err => console.error('Booking-accepted email dispatch failed:', err));
        }

        return res.status(200).json({
            status: 'success',
            message: 'Booking accepted successfully',
            data: {
                booking_id: bookingId,
                status: 'CONFIRMED'
            }
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rbErr) {
                console.error('Rollback error:', rbErr);
            }
            connection.release();
        }
        next(error);
    }
};

// @route   PATCH /api/v1/ownerDashboard/bookings/:id/reject
// @access  Private (OWNER)
exports.rejectBooking = async (req, res, next) => {
    let connection;
    try {
        const ownerId = req.user.id;
        const bookingId = Number(req.params.id);

        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid booking ID. Must be a valid positive integer.'
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Fetch booking with row lock
        const [rows] = await connection.query(
            `SELECT b.id, b.status, b.check_in_date, b.check_out_date, b.student_id, b.guest_email,
                    p.id AS property_id, p.owner_id, p.title AS property_title,
                    u.full_name AS student_name, u.email AS student_email
             FROM room_bookings b
             JOIN properties p ON b.property_id = p.id
             LEFT JOIN users u ON b.student_id = u.id
             WHERE b.id = ?
             FOR UPDATE`,
            [bookingId]
        );

        if (rows.length === 0) {
            const [[rawBooking]] = await connection.query(
                `SELECT id FROM room_bookings WHERE id = ?`,
                [bookingId]
            );
            await connection.rollback();
            connection.release();
            connection = null;

            if (!rawBooking) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Booking not found'
                });
            }
            return res.status(404).json({
                status: 'error',
                message: 'Associated property not found'
            });
        }

        const booking = rows[0];

        // 2. Ownership check: Must belong to authenticated owner
        if (booking.owner_id !== ownerId) {
            await connection.rollback();
            connection.release();
            connection = null;
            return res.status(403).json({
                status: 'error',
                message: 'Forbidden: You do not own the property associated with this booking'
            });
        }

        // 3. Status check: Must currently be PENDING
        if (booking.status !== 'PENDING') {
            await connection.rollback();
            connection.release();
            connection = null;
            return res.status(409).json({
                status: 'error',
                message: `Cannot reject booking with status ${booking.status}. Only PENDING bookings can be rejected.`
            });
        }

        // 4. Update status to CANCELLED
        await connection.query(
            `UPDATE room_bookings SET status = 'CANCELLED' WHERE id = ?`,
            [bookingId]
        );

        await connection.commit();
        connection.release();
        connection = null;

        // 5. Send notification to student (non-blocking)
        const recipientEmail = booking.student_email || booking.guest_email;
        if (recipientEmail) {
            sendEmail({
                email: recipientEmail,
                subject: `Your Booking Request Update - ${booking.property_title}`,
                html: `
                    <h3>Hello ${booking.student_name || 'Guest'},</h3>
                    <p>Your room booking request for <b>${booking.property_title}</b> has been declined by the property owner.</p>
                    <p><b>Status:</b> CANCELLED</p>
                    <p>You can search for other student accommodations and hostels on Quark Housing.</p>
                `
            }).catch(err => console.error('Booking-rejected email dispatch failed:', err));
        }

        return res.status(200).json({
            status: 'success',
            message: 'Booking rejected successfully',
            data: {
                booking_id: bookingId,
                status: 'CANCELLED'
            }
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rbErr) {
                console.error('Rollback error:', rbErr);
            }
            connection.release();
        }
        next(error);
    }
};

// =============================================================================
// 4. EARNINGS & PAYOUTS
// =============================================================================

// @route   GET /api/v1/owner/earnings
// @access  Private (OWNER)
exports.getEarnings = async (req, res, next) => {
    try {
        const ownerId = req.user.id;

        const balance = await computeBalance(ownerId);

        const [byProperty] = await db.query(
            `SELECT p.id AS property_id, p.title,
                COALESCE(SUM(CASE WHEN rb.status IN (?) THEN p.confirmation_payment ELSE 0 END), 0) AS earnings
             FROM properties p
             LEFT JOIN room_bookings rb ON rb.property_id = p.id
             WHERE p.owner_id = ?
             GROUP BY p.id, p.title
             ORDER BY earnings DESC`,
            [EARNING_STATUSES, ownerId]
        );

        const [payoutHistory] = await db.query(
            `SELECT id, amount, method, status, requested_at, processed_at, remarks
             FROM owner_payouts WHERE owner_id = ? ORDER BY requested_at DESC LIMIT 20`,
            [ownerId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                ...balance,
                earnings_by_property: byProperty,
                payout_history: payoutHistory
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/owner/payouts
// @access  Private (OWNER)
exports.requestPayout = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const amount = parseFloat(req.body.amount);

        const [[bankDetails]] = await db.query(
            `SELECT preferred_method, account_number, upi_id FROM owner_bank_details WHERE owner_id = ?`,
            [ownerId]
        );

        if (!bankDetails) {
            return res.status(400).json({
                status: 'error',
                message: 'Please add your bank/UPI details before requesting a withdrawal.'
            });
        }

        const balance = await computeBalance(ownerId);
        if (amount > balance.available_balance) {
            return res.status(400).json({
                status: 'error',
                message: `Requested amount exceeds your available balance of ₹${balance.available_balance}`
            });
        }
        if (amount <= 0) {
            return res.status(400).json({ status: 'error', message: 'Amount must be greater than zero' });
        }

        const [result] = await db.query(
            `INSERT INTO owner_payouts (owner_id, amount, method, status) VALUES (?, ?, ?, 'PENDING')`,
            [ownerId, amount, bankDetails.preferred_method]
        );

        res.status(201).json({
            status: 'success',
            message: 'Withdrawal request submitted. Payouts are processed within 24 working hours.',
            data: { payout_id: result.insertId }
        });
    } catch (error) {
        next(error);
    }
};

// @route   PUT /api/v1/owner/bank-details
// @access  Private (OWNER)
exports.upsertBankDetails = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const { preferred_method, account_holder_name, account_number, ifsc_code, upi_id } = req.body;

        await db.query(
            `INSERT INTO owner_bank_details
                (owner_id, preferred_method, account_holder_name, account_number, ifsc_code, upi_id)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                preferred_method = VALUES(preferred_method),
                account_holder_name = VALUES(account_holder_name),
                account_number = VALUES(account_number),
                ifsc_code = VALUES(ifsc_code),
                upi_id = VALUES(upi_id)`,
            [ownerId, preferred_method, account_holder_name || null, account_number || null, ifsc_code || null, upi_id || null]
        );

        res.status(200).json({ status: 'success', message: 'Bank/UPI details saved successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/owner/reviews
// @access  Private (OWNER)
exports.getMyReviews = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const { property_id } = req.query;

        let query = `
            SELECT r.id, r.rating, r.comment, r.created_at,
                   u.full_name AS reviewer_name,
                   p.id AS property_id, p.title AS property_title
            FROM property_reviews r
            JOIN properties p ON r.property_id = p.id
            JOIN users u ON r.customer_id = u.id
            WHERE p.owner_id = ?
        `;
        const params = [ownerId];

        if (property_id) {
            query += ` AND p.id = ?`;
            params.push(property_id);
        }
        query += ` ORDER BY r.created_at DESC`;

        const [reviews] = await db.query(query, params);

        const [ratingByProperty] = await db.query(
            `SELECT p.id AS property_id, p.title,
                    COUNT(r.id) AS total_reviews,
                    COALESCE(ROUND(AVG(r.rating), 1), 0) AS average_rating
             FROM properties p
             LEFT JOIN property_reviews r ON r.property_id = p.id
             WHERE p.owner_id = ?
             GROUP BY p.id, p.title`,
            [ownerId]
        );

        res.status(200).json({
            status: 'success',
            results: reviews.length,
            data: { rating_by_property: ratingByProperty, reviews }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 5. PROFILE & KYC
// =============================================================================

// =============================================================================
// 5. PROFILE & KYC
// =============================================================================

// @route   GET /api/v1/owner/profile
// @access  Private (OWNER)
exports.getOwnerProfile = async (req, res, next) => {
    try {
        const ownerId = req.user.id;

        const [[user]] = await db.query(
            `SELECT id, full_name, email, phone, role, created_at FROM users WHERE id = ?`,
            [ownerId]
        );

        const [[kyc]] = await db.query(
            `SELECT verification_status, aadhaar_number, pan_number, rejection_reason, submitted_at
             FROM owner_kyc_documents WHERE owner_id = ?`,
            [ownerId]
        );

        const [[bank]] = await db.query(
            `SELECT preferred_method, account_number, upi_id FROM owner_bank_details WHERE owner_id = ?`,
            [ownerId]
        );

        // Mask sensitive numbers before sending to the client
        const maskTail = (val) => (val ? `${'*'.repeat(Math.max(val.length - 4, 0))}${val.slice(-4)}` : null);

        res.status(200).json({
            status: 'success',
            data: {
                user,
                kyc: kyc
                    ? { ...kyc, aadhaar_number: maskTail(kyc.aadhaar_number) }
                    : { verification_status: 'NOT_SUBMITTED' },
                bank_details: bank
                    ? { ...bank, account_number: maskTail(bank.account_number) }
                    : null
            }
        });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/owner/profile
// @access  Private (OWNER)
exports.updateOwnerProfile = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const { full_name, phone } = req.body;

        const fields = Object.entries({ full_name, phone }).filter(([, v]) => v !== undefined);
        if (fields.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Nothing to update' });
        }

        const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
        const values = fields.map(([, v]) => v);

        await db.query(`UPDATE users SET ${setClause} WHERE id = ?`, [...values, ownerId]);

        res.status(200).json({ status: 'success', message: 'Profile updated successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/owner/kyc
// @access  Private (OWNER)
// Accepts multipart fields: aadhaar_doc, pan_doc, address_proof (each max 1 file)
exports.submitKyc = async (req, res, next) => {
    try {
        const ownerId = req.user.id;
        const { aadhaar_number, pan_number } = req.body;

        const files = req.files || {};
        const aadhaarDocUrl = files.aadhaar_doc?.[0]?.path || null;
        const panDocUrl = files.pan_doc?.[0]?.path || null;
        const addressProofUrl = files.address_proof?.[0]?.path || null;

        if (!aadhaarDocUrl && !panDocUrl && !addressProofUrl && !aadhaar_number && !pan_number) {
            return res.status(400).json({ status: 'error', message: 'Provide at least one KYC detail or document' });
        }

        // Build a dynamic upsert so we don't overwrite existing docs with null
        // when the owner submits Aadhaar and PAN in separate requests.
        const [[existing]] = await db.query(`SELECT id FROM owner_kyc_documents WHERE owner_id = ?`, [ownerId]);

        if (existing) {
            const fields = {
                aadhaar_number,
                aadhaar_doc_url: aadhaarDocUrl,
                pan_number,
                pan_doc_url: panDocUrl,
                address_proof_url: addressProofUrl
            };
            const sets = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null);
            const setClause = [...sets.map(([k]) => `${k} = ?`), `verification_status = 'PENDING'`, `submitted_at = CURRENT_TIMESTAMP`].join(', ');
            const values = sets.map(([, v]) => v);
            await db.query(`UPDATE owner_kyc_documents SET ${setClause} WHERE owner_id = ?`, [...values, ownerId]);
        } else {
            await db.query(
                `INSERT INTO owner_kyc_documents
                    (owner_id, aadhaar_number, aadhaar_doc_url, pan_number, pan_doc_url, address_proof_url, verification_status)
                 VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
                [ownerId, aadhaar_number || null, aadhaarDocUrl, pan_number || null, panDocUrl, addressProofUrl]
            );
        }

        res.status(200).json({
            status: 'success',
            message: 'KYC details submitted. Verification usually takes 24-48 hours.'
        });
    } catch (error) {
        next(error);
    }
};