// src/modules/bookings/booking.controller.js
const db = require('../../config/db');
const sendEmail = require('../../utils/email');

exports.createBooking = async (req, res, next) => {
    try {
        const studentId = req.user.id;
        const {
            property_id, full_name, email, phone,
            check_in_date, check_out_date, purpose_of_stay, message
        } = req.body;

        // 1. Check ID Proof upload
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'ID Proof (Aadhaar / PAN / Voter ID) is required' });
        }
        const id_proof_url = req.file.path;

        // 2. Fetch Property and Owner Details (Required for Email)
        const [propertyCheck] = await db.query(`
            SELECT p.id, p.title, p.confirmation_payment, p.monthly_rent, u.email as owner_email, u.full_name as owner_name 
            FROM properties p
            JOIN users u ON p.owner_id = u.id
            WHERE p.id = ? AND p.is_active = 1
        `, [property_id]);

        if (propertyCheck.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Property not found' });
        }

        const property = propertyCheck[0];

        // 3. Insert  Booking into Database
        const [bookingResult] = await db.query(
            `INSERT INTO room_bookings 
            (student_id,property_id, check_in_date, check_out_date, purpose_of_stay, message, id_proof_url, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [
                studentId,property_id,check_in_date, check_out_date, purpose_of_stay || null, message || null, id_proof_url
            ]
        );

        const bookingId = bookingResult.insertId;

        // ---------------------------------------------------------
        // STEP 2: SEND CONFIRMATION EMAILS (Parallel Execution)
        // ---------------------------------------------------------

        const adminEmail = process.env.SMTP_USER; // Platform Admin Email

        // A. Email to Customer (With Bill)
        const customerMail = sendEmail({
            email: email,
            subject: `Booking Request Received - ${property.title}`,
            html: `
                <h3>Hello ${full_name},</h3>
                <p>Your booking request for <b>${property.title}</b> has been received.</p>
                <hr>
                <h4>Estimated Bill</h4>
                <ul>
                    <li>Monthly Rent: ₹${property.monthly_rent}</li>
                    <li>Confirmation Advance: ₹${property.confirmation_payment}</li>
                </ul>
                <p>We will review your ID proof and notify you for the payment step shortly.</p>
            `
        });

        // B. Email to Owner (Order Details)
        const ownerMail = sendEmail({
            email: property.owner_email,
            subject: `New Booking Request - ${property.title}`,
            html: `
                <h3>Hello ${property.owner_name},</h3>
                <p>You have a new booking request for your property: <b>${property.title}</b>.</p>
                <hr>
                <h4>Guest Details</h4>
                <ul>
                    <li>Name: ${full_name}</li>
                    <li>Phone: ${phone}</li>
                    <li>Dates: ${check_in_date} to ${check_out_date}</li>
                    <li>Message: ${message || 'N/A'}</li>
                </ul>
                <p>Please check your Owner Dashboard to view the ID proof and manage this request.</p>
            `
        });

        // C. Email to Super Admin (Quark Housing Team)
        const adminMail = sendEmail({
            email: adminEmail,
            subject: `[ADMIN ALERT] New Booking #BKG${bookingId}`,
            html: `
                <h3>New Room Booking Request</h3>
                <p><b>Property:</b> ${property.title} (ID: ${property.id})</p>
                <p><b>Guest:</b> ${full_name} (${phone} | ${email})</p>
                <p><b>Advance Payment Pending:</b> ₹${property.confirmation_payment}</p>
                <p><a href="${id_proof_url}">View Uploaded ID Proof</a></p>
            `
        });

        // Execute all emails simultaneously without blocking each other
        await Promise.all([customerMail, ownerMail, adminMail]).catch(err => {
            console.error("Email sending failed, but booking was saved:", err);
            // Log it but don't fail the API response since DB insert was successful
        });

        res.status(201).json({
            status: 'success',
            message: 'Booking request submitted successfully. Confirmation emails sent.',
            data: { booking_id: bookingId }
        });

    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/bookings/my-bookings
// @access  Private (STUDENT only)
exports.getMyBookings = async (req, res, next) => {
    try {
        const studentId = req.user.id;

        // Fetch bookings + basic property details + address details
        const [bookings] = await db.query(`
            SELECT 
                b.id AS booking_id, b.check_in_date, b.check_out_date, b.status, b.created_at, b.message,
                p.title, p.property_type, p.monthly_rent, 
                pa.city, pa.locality
            FROM room_bookings b
            JOIN properties p ON b.property_id = p.id
            JOIN property_addresses pa ON p.id = pa.property_id
            WHERE b.student_id = ?
            ORDER BY b.created_at DESC
        `, [studentId]);

        // Using the locked response format
        res.status(200).json({
            status: 'success',
            message: 'Booking details fetched successfully',
            results: bookings.length,
            data: {
                bookings
            }
        });

    } catch (error) {
        next(error);
    }
};