// src/modules/customer/customer.controller.js
const db = require('../../config/db');
const walletService = require('../wallet/wallet.service');

// =============================================================================
// 1. OVERVIEW
// =============================================================================

// @route   GET /api/v1/customer/overview
// @access  Private (STUDENT)
exports.getOverview = async (req, res, next) => {
    try {
        const customerId = req.user.id;

        const [[bookingStats]] = await db.query(
            `SELECT COUNT(*) AS total_bookings,
                    SUM(CASE WHEN status IN ('PENDING','CONFIRMED') THEN 1 ELSE 0 END) AS active_bookings,
                    SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_bookings
             FROM room_bookings WHERE student_id = ?`,
            [customerId]
        );

        const [[orderStats]] = await db.query(
            `SELECT COUNT(*) AS total_tiffin_orders,
                    SUM(CASE WHEN status IN ('PENDING','CONFIRMED') THEN 1 ELSE 0 END) AS active_tiffin_orders,
                    SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS completed_tiffin_orders
             FROM tiffin_orders WHERE customer_id = ?`,
            [customerId]
        );

        const [[subscriptionStats]] = await db.query(
            `SELECT SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_subscriptions
             FROM tiffin_subscriptions WHERE customer_id = ?`,
            [customerId]
        );

        // "Reward Points" = money this customer has earned as a REFERRER
        // (reusing the referrals system, not a separate points system).
        const [[rewardRow]] = await db.query(
            `SELECT COALESCE(SUM(total_rewards_earned), 0) AS reward_points FROM referrals WHERE referrer_id = ?`,
            [customerId]
        );

        const [[reviewCounts]] = await db.query(
            `SELECT
                (SELECT COUNT(*) FROM property_reviews WHERE customer_id = ?) +
                (SELECT COUNT(*) FROM tiffin_reviews WHERE customer_id = ?) AS total_reviews_written`,
            [customerId, customerId]
        );

        const [[wishlistCount]] = await db.query(`SELECT COUNT(*) AS n FROM wishlist_items WHERE customer_id = ?`, [customerId]);
        const [[addressCount]] = await db.query(`SELECT COUNT(*) AS n FROM customer_addresses WHERE customer_id = ?`, [customerId]);

        const wallet = await walletService.getBalance(customerId);

        res.status(200).json({
            status: 'success',
            data: {
                total_bookings: bookingStats.total_bookings || 0,
                active_bookings: bookingStats.active_bookings || 0,
                completed_bookings: bookingStats.completed_bookings || 0,
                total_tiffin_orders: orderStats.total_tiffin_orders || 0,
                active_tiffin_orders: orderStats.active_tiffin_orders || 0,
                completed_tiffin_orders: orderStats.completed_tiffin_orders || 0,
                active_subscriptions: subscriptionStats.active_subscriptions || 0,
                wallet_balance: wallet.balance,
                reward_points: Number(rewardRow.reward_points),
                total_reviews_written: reviewCounts.total_reviews_written || 0,
                saved_items_count: wishlistCount.n || 0,
                saved_addresses_count: addressCount.n || 0
            }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 2. PROFILE
// =============================================================================

// @route   GET /api/v1/customer/profile
// @access  Private (STUDENT)
exports.getProfile = async (req, res, next) => {
    try {
        const [[user]] = await db.query(
            `SELECT id, full_name, email, phone, referral_code, created_at AS member_since FROM users WHERE id = ?`,
            [req.user.id]
        );
        res.status(200).json({ status: 'success', data: { user } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/customer/profile
// @access  Private (STUDENT)
exports.updateProfile = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { full_name, phone } = req.body;

        const fields = Object.entries({ full_name, phone }).filter(([, v]) => v !== undefined);
        if (fields.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Nothing to update' });
        }

        const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
        const values = fields.map(([, v]) => v);

        await db.query(`UPDATE users SET ${setClause} WHERE id = ?`, [...values, customerId]);

        res.status(200).json({ status: 'success', message: 'Profile updated successfully' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 3. TIMELINE
// =============================================================================

// @route   GET /api/v1/customer/timeline
// @access  Private (STUDENT)
// Trip history -- only real stays (CONFIRMED/COMPLETED bookings), not pending/cancelled ones.
exports.getTimeline = async (req, res, next) => {
    try {
        const customerId = req.user.id;

        const [trips] = await db.query(
            `SELECT b.id AS booking_id, p.title AS property_title, a.city,
                    b.check_in_date, b.check_out_date,
                    DATEDIFF(b.check_out_date, b.check_in_date) AS nights,
                    b.status
             FROM room_bookings b
             JOIN properties p ON b.property_id = p.id
             JOIN property_addresses a ON p.id = a.property_id
             WHERE b.student_id = ? AND b.status IN ('CONFIRMED', 'COMPLETED')
             ORDER BY b.check_in_date DESC`,
            [customerId]
        );

        const totalNights = trips.reduce((sum, t) => sum + (t.nights || 0), 0);
        const locationsVisited = new Set(trips.map((t) => t.city)).size;

        res.status(200).json({
            status: 'success',
            data: {
                total_trips: trips.length,
                locations_visited: locationsVisited,
                total_nights: totalNights,
                last_trip: trips.length > 0 ? trips[0].city : null,
                trips
            }
        });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 4. MY REVIEWS
// =============================================================================

// @route   GET /api/v1/customer/reviews
// @access  Private (STUDENT)
exports.getMyReviews = async (req, res, next) => {
    try {
        const customerId = req.user.id;

        const [propertyReviews] = await db.query(
            `SELECT r.id, r.rating, r.comment, r.created_at, p.title AS reviewed_name, 'PROPERTY' AS type
             FROM property_reviews r JOIN properties p ON r.property_id = p.id
             WHERE r.customer_id = ?`,
            [customerId]
        );

        const [tiffinReviews] = await db.query(
            `SELECT r.id, r.rating, r.comment, r.created_at, ts.name AS reviewed_name, 'TIFFIN' AS type
             FROM tiffin_reviews r JOIN tiffin_services ts ON r.tiffin_service_id = ts.id
             WHERE r.customer_id = ?`,
            [customerId]
        );

        const allReviews = [...propertyReviews, ...tiffinReviews].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.status(200).json({ status: 'success', results: allReviews.length, data: { reviews: allReviews } });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 5. SAVED ADDRESSES
// =============================================================================

// @route   GET /api/v1/customer/addresses
// @access  Private (STUDENT)
exports.getAddresses = async (req, res, next) => {
    try {
        const [addresses] = await db.query(
            `SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC`,
            [req.user.id]
        );
        res.status(200).json({ status: 'success', results: addresses.length, data: { addresses } });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/customer/addresses
// @access  Private (STUDENT)
exports.createAddress = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { label, address_line, locality, city, state, pincode } = req.body;
        const isDefault = req.body.is_default === 'true' || req.body.is_default === '1';

        if (isDefault) {
            await db.query(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`, [customerId]);
        }

        const [result] = await db.query(
            `INSERT INTO customer_addresses (customer_id, label, address_line, locality, city, state, pincode, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [customerId, label, address_line, locality, city, state, pincode, isDefault ? 1 : 0]
        );

        res.status(201).json({ status: 'success', message: 'Address saved', data: { address_id: result.insertId } });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/customer/addresses/:id
// @access  Private (STUDENT, own only)
exports.updateAddress = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const addressId = req.params.id;
        const data = req.body;

        const [[owns]] = await db.query(`SELECT id FROM customer_addresses WHERE id = ? AND customer_id = ?`, [addressId, customerId]);
        if (!owns) {
            return res.status(404).json({ status: 'error', message: 'Address not found' });
        }

        if (data.is_default !== undefined) {
            const isDefault = data.is_default === 'true' || data.is_default === '1';
            if (isDefault) {
                await db.query(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`, [customerId]);
            }
        }

        const fields = {
            label: data.label,
            address_line: data.address_line,
            locality: data.locality,
            city: data.city,
            state: data.state,
            pincode: data.pincode,
            is_default: data.is_default !== undefined ? (data.is_default === 'true' || data.is_default === '1' ? 1 : 0) : undefined
        };
        const sets = Object.entries(fields).filter(([, v]) => v !== undefined);
        if (sets.length > 0) {
            const setClause = sets.map(([k]) => `${k} = ?`).join(', ');
            const values = sets.map(([, v]) => v);
            await db.query(`UPDATE customer_addresses SET ${setClause} WHERE id = ?`, [...values, addressId]);
        }

        res.status(200).json({ status: 'success', message: 'Address updated' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/customer/addresses/:id
// @access  Private (STUDENT, own only)
exports.deleteAddress = async (req, res, next) => {
    try {
        const [result] = await db.query(
            `DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?`,
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Address not found' });
        }
        res.status(200).json({ status: 'success', message: 'Address deleted' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 6. WISHLIST / SAVED ITEMS
// =============================================================================

// @route   POST /api/v1/customer/wishlist
// @access  Private (STUDENT)
exports.addToWishlist = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const { item_type, item_id } = req.body;

        if (item_type === 'PROPERTY') {
            const [[property]] = await db.query(`SELECT id FROM properties WHERE id = ? AND is_active = 1`, [item_id]);
            if (!property) {
                return res.status(404).json({ status: 'error', message: 'Property not found' });
            }
        } else {
            const [[service]] = await db.query(
                `SELECT id FROM tiffin_services WHERE id = ? AND approval_status = 'APPROVED' AND is_active = 1`,
                [item_id]
            );
            if (!service) {
                return res.status(404).json({ status: 'error', message: 'Tiffin service not found' });
            }
        }

        try {
            const [result] = await db.query(
                `INSERT INTO wishlist_items (customer_id, item_type, item_id) VALUES (?, ?, ?)`,
                [customerId, item_type, item_id]
            );
            res.status(201).json({ status: 'success', message: 'Added to wishlist', data: { wishlist_item_id: result.insertId } });
        } catch (dbError) {
            if (dbError.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ status: 'error', message: 'Already in your wishlist' });
            }
            throw dbError;
        }
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/customer/wishlist
// @access  Private (STUDENT)
exports.getWishlist = async (req, res, next) => {
    try {
        const customerId = req.user.id;

        const [propertyItems] = await db.query(
            `SELECT w.id AS wishlist_item_id, w.created_at AS saved_at, 'PROPERTY' AS item_type,
                    p.id AS item_id, p.title AS name, p.monthly_rent AS price,
                    (p.id IS NOT NULL AND p.is_active = 1) AS is_available
             FROM wishlist_items w
             LEFT JOIN properties p ON w.item_id = p.id
             WHERE w.customer_id = ? AND w.item_type = 'PROPERTY'`,
            [customerId]
        );

        const [tiffinItems] = await db.query(
            `SELECT w.id AS wishlist_item_id, w.created_at AS saved_at, 'TIFFIN' AS item_type,
                    ts.id AS item_id, ts.name, ts.price_per_meal AS price,
                    (ts.id IS NOT NULL AND ts.approval_status = 'APPROVED' AND ts.is_active = 1) AS is_available
             FROM wishlist_items w
             LEFT JOIN tiffin_services ts ON w.item_id = ts.id
             WHERE w.customer_id = ? AND w.item_type = 'TIFFIN'`,
            [customerId]
        );

        const allItems = [...propertyItems, ...tiffinItems].sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));

        res.status(200).json({ status: 'success', results: allItems.length, data: { items: allItems } });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/customer/wishlist/:id
// @access  Private (STUDENT, own only)
exports.removeFromWishlist = async (req, res, next) => {
    try {
        const [result] = await db.query(
            `DELETE FROM wishlist_items WHERE id = ? AND customer_id = ?`,
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Wishlist item not found' });
        }
        res.status(200).json({ status: 'success', message: 'Removed from wishlist' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 7. NOTIFICATIONS
// =============================================================================

// @route   GET /api/v1/customer/notifications
// @access  Private (STUDENT)
exports.getNotificationPreferences = async (req, res, next) => {
    try {
        const [[prefs]] = await db.query(`SELECT * FROM notification_preferences WHERE customer_id = ?`, [req.user.id]);
        res.status(200).json({
            status: 'success',
            data: prefs
                ? { booking_updates: !!prefs.booking_updates, delivery_updates: !!prefs.delivery_updates, promotional_offers: !!prefs.promotional_offers }
                : { booking_updates: true, delivery_updates: true, promotional_offers: false } // defaults if never saved
        });
    } catch (error) {
        next(error);
    }
};

// @route   PATCH /api/v1/customer/notifications
// @access  Private (STUDENT)
exports.updateNotificationPreferences = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const toBit = (v) => (v === 'true' || v === '1' ? 1 : 0);
        const { booking_updates, delivery_updates, promotional_offers } = req.body;

        // Upsert: start from defaults, then apply only the fields sent
        await db.query(
            `INSERT INTO notification_preferences (customer_id, booking_updates, delivery_updates, promotional_offers)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                booking_updates = COALESCE(VALUES(booking_updates), booking_updates),
                delivery_updates = COALESCE(VALUES(delivery_updates), delivery_updates),
                promotional_offers = COALESCE(VALUES(promotional_offers), promotional_offers)`,
            [
                customerId,
                booking_updates !== undefined ? toBit(booking_updates) : 1,
                delivery_updates !== undefined ? toBit(delivery_updates) : 1,
                promotional_offers !== undefined ? toBit(promotional_offers) : 0
            ]
        );

        res.status(200).json({ status: 'success', message: 'Notification preferences updated' });
    } catch (error) {
        next(error);
    }
};

// =============================================================================
// 8. ACCOUNT SETTINGS
// =============================================================================

// @route   PATCH /api/v1/customer/change-password
// @access  Private (STUDENT)
exports.changePassword = async (req, res, next) => {
    try {
        const bcrypt = require('bcryptjs');
        const customerId = req.user.id;
        const { current_password, new_password } = req.body;

        const [[user]] = await db.query(`SELECT password_hash FROM users WHERE id = ?`, [customerId]);
        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ status: 'error', message: 'Current password is incorrect' });
        }

        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(new_password, salt);
        await db.query(`UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?`, [newHash, customerId]);

        res.status(200).json({ status: 'success', message: 'Password changed successfully' });
    } catch (error) {
        next(error);
    }
};

// @route   DELETE /api/v1/customer/account
// @access  Private (STUDENT)
// Soft delete: sets deleted_at and blocks future logins (see auth.controller.js).
// Does NOT invalidate a token already issued -- see migration note.
exports.deleteAccount = async (req, res, next) => {
    try {
        await db.query(`UPDATE users SET deleted_at = NOW() WHERE id = ?`, [req.user.id]);

        // Also blocklist the token being used right now, so this session
        // stops working immediately -- not just future login attempts.
        // Fixes the limitation noted in sql/013_customer_settings.sql.
        const { blocklistToken } = require('../../utils/token');
        const rawToken = req.headers.authorization.split(' ')[1];
        await blocklistToken(req.user.id, rawToken);

        res.status(200).json({ status: 'success', message: 'Account deleted' });
    } catch (error) {
        next(error);
    }
};