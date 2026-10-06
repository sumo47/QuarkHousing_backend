// test_owner_bookings.js
// 12-Point Comprehensive Test Suite for Owner Room Booking Accept/Reject State Transitions
process.env.NODE_ENV = 'test';
require('dotenv').config();

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./src/config/db');
const { generateAuthToken } = require('./src/utils/token');

const BASE_URL = 'http://localhost:5000/api/v1';

async function runTests() {
    console.log('====================================================');
    console.log('STARTING 12-POINT OWNER BOOKING ACCEPT/REJECT TEST SUITE');
    console.log('====================================================\n');

    let server;
    try {
        const check = await fetch('http://localhost:5000/health');
        if (!check.ok) throw new Error();
    } catch {
        const app = require('./src/server');
        server = app.listen(5000);
        await new Promise((r) => setTimeout(r, 600));
    }

    let passed = 0;
    let failed = 0;

    function report(num, title, success, detail = '') {
        if (success) {
            console.log(`[PASS] Test ${num}: ${title}`);
            passed++;
        } else {
            console.error(`[FAIL] Test ${num}: ${title}`);
            if (detail) console.error(`       Details: ${detail}`);
            failed++;
        }
    }

    // -----------------------------------------------------------------
    // TEST SETUP: Create 2 Owners, 1 Student, and 2 Properties
    // -----------------------------------------------------------------
    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    const owner1Email = `owner1_${Date.now()}@test.com`;
    const owner2Email = `owner2_${Date.now()}@test.com`;
    const studentEmail = `student_${Date.now()}@test.com`;

    // Insert Owner 1
    const [resO1] = await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'OWNER')`,
        ['Test Owner One', owner1Email, `91000${Math.floor(10000 + Math.random() * 90000)}`, passwordHash]
    );
    const owner1Id = resO1.insertId;
    const tokenO1 = generateAuthToken({ id: owner1Id, role: 'OWNER' });

    // Insert Owner 2
    const [resO2] = await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'OWNER')`,
        ['Test Owner Two', owner2Email, `92000${Math.floor(10000 + Math.random() * 90000)}`, passwordHash]
    );
    const owner2Id = resO2.insertId;
    const tokenO2 = generateAuthToken({ id: owner2Id, role: 'OWNER' });

    // Insert Student
    const [resS] = await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'STUDENT')`,
        ['Test Student', studentEmail, `93000${Math.floor(10000 + Math.random() * 90000)}`, passwordHash]
    );
    const studentId = resS.insertId;

    // Insert Property 1 for Owner 1
    const [resP1] = await db.query(
        `INSERT INTO properties (owner_id, title, property_type, gender_preference, monthly_rent, confirmation_payment, is_active)
         VALUES (?, 'Owner 1 Test PG', 'SINGLE', 'BOTH', 5000, 1000, 1)`,
        [owner1Id]
    );
    const prop1Id = resP1.insertId;

    // Insert Property 2 for Owner 2
    const [resP2] = await db.query(
        `INSERT INTO properties (owner_id, title, property_type, gender_preference, monthly_rent, confirmation_payment, is_active)
         VALUES (?, 'Owner 2 Test PG', 'SINGLE', 'BOTH', 6000, 1500, 1)`,
        [owner2Id]
    );
    const prop2Id = resP2.insertId;

    // Helper: Create a booking with a given status
    async function createTestBooking(propertyId, status = 'PENDING') {
        const [res] = await db.query(
            `INSERT INTO room_bookings (student_id, property_id, check_in_date, check_out_date, purpose_of_stay, status)
             VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'College Exam', ?)`,
            [studentId, propertyId, status]
        );
        return res.insertId;
    }

    try {
        // -------------------------------------------------------------
        // TEST 1: Owner can accept own property's PENDING booking
        // -------------------------------------------------------------
        const b1Id = await createTestBooking(prop1Id, 'PENDING');
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${b1Id}/accept`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO1}`,
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 200 && body.status === 'success' && body.data?.status === 'CONFIRMED';
            report(1, "Owner can accept own property's PENDING booking", success, JSON.stringify(body));
        } catch (e) {
            report(1, "Owner can accept own property's PENDING booking", false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 2: Accept changes PENDING -> CONFIRMED in Database
        // -------------------------------------------------------------
        try {
            const [[row]] = await db.query('SELECT status FROM room_bookings WHERE id = ?', [b1Id]);
            const success = row && row.status === 'CONFIRMED';
            report(2, 'Accept changes PENDING -> CONFIRMED in database', success, `DB Status: ${row?.status}`);
        } catch (e) {
            report(2, 'Accept changes PENDING -> CONFIRMED in database', false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 3: Owner can reject own property's PENDING booking
        // -------------------------------------------------------------
        const b2Id = await createTestBooking(prop1Id, 'PENDING');
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${b2Id}/reject`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO1}`,
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 200 && body.status === 'success' && body.data?.status === 'CANCELLED';
            report(3, "Owner can reject own property's PENDING booking", success, JSON.stringify(body));
        } catch (e) {
            report(3, "Owner can reject own property's PENDING booking", false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 4: Reject changes PENDING -> CANCELLED in Database
        // -------------------------------------------------------------
        try {
            const [[row]] = await db.query('SELECT status FROM room_bookings WHERE id = ?', [b2Id]);
            const success = row && row.status === 'CANCELLED';
            report(4, 'Reject changes PENDING -> CANCELLED in database', success, `DB Status: ${row?.status}`);
        } catch (e) {
            report(4, 'Reject changes PENDING -> CANCELLED in database', false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 5: Non-owner cannot accept another owner's booking -> 403
        // -------------------------------------------------------------
        const b3Id = await createTestBooking(prop1Id, 'PENDING');
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${b3Id}/accept`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO2}`, // Owner 2 trying to accept Owner 1's booking
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 403 && body.status === 'error';
            report(5, "Non-owner cannot accept another owner's booking -> 403", success, JSON.stringify(body));
        } catch (e) {
            report(5, "Non-owner cannot accept another owner's booking -> 403", false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 6: Non-owner cannot reject another owner's booking -> 403
        // -------------------------------------------------------------
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${b3Id}/reject`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO2}`, // Owner 2 trying to reject Owner 1's booking
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 403 && body.status === 'error';
            report(6, "Non-owner cannot reject another owner's booking -> 403", success, JSON.stringify(body));
        } catch (e) {
            report(6, "Non-owner cannot reject another owner's booking -> 403", false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 7: Accept already CONFIRMED booking -> 409
        // -------------------------------------------------------------
        const bConfirmed = await createTestBooking(prop1Id, 'CONFIRMED');
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${bConfirmed}/accept`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO1}`,
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 409 && body.status === 'error';
            report(7, 'Accept already CONFIRMED booking -> 409', success, JSON.stringify(body));
        } catch (e) {
            report(7, 'Accept already CONFIRMED booking -> 409', false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 8: Reject already CANCELLED booking -> 409
        // -------------------------------------------------------------
        const bCancelled = await createTestBooking(prop1Id, 'CANCELLED');
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${bCancelled}/reject`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO1}`,
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 409 && body.status === 'error';
            report(8, 'Reject already CANCELLED booking -> 409', success, JSON.stringify(body));
        } catch (e) {
            report(8, 'Reject already CANCELLED booking -> 409', false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 9: Accept already CANCELLED booking -> 409
        // -------------------------------------------------------------
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${bCancelled}/accept`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO1}`,
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 409 && body.status === 'error';
            report(9, 'Accept already CANCELLED booking -> 409', success, JSON.stringify(body));
        } catch (e) {
            report(9, 'Accept already CANCELLED booking -> 409', false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 10: Reject already CONFIRMED booking -> 409
        // -------------------------------------------------------------
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/${bConfirmed}/reject`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO1}`,
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 409 && body.status === 'error';
            report(10, 'Reject already CONFIRMED booking -> 409', success, JSON.stringify(body));
        } catch (e) {
            report(10, 'Reject already CONFIRMED booking -> 409', false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 11: Missing booking -> 404
        // -------------------------------------------------------------
        try {
            const res = await fetch(`${BASE_URL}/ownerDashboard/bookings/9999999/accept`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenO1}`,
                    'Content-Type': 'application/json'
                }
            });
            const body = await res.json();
            const success = res.status === 404 && body.status === 'error';
            report(11, 'Missing booking -> 404', success, JSON.stringify(body));
        } catch (e) {
            report(11, 'Missing booking -> 404', false, e.message);
        }

        // -------------------------------------------------------------
        // TEST 12: Concurrent accept/reject cannot produce an invalid final state
        // -------------------------------------------------------------
        const bConcurrent = await createTestBooking(prop1Id, 'PENDING');
        try {
            // Fire both accept and reject simultaneously
            const [acceptRes, rejectRes] = await Promise.all([
                fetch(`${BASE_URL}/ownerDashboard/bookings/${bConcurrent}/accept`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${tokenO1}`,
                        'Content-Type': 'application/json'
                    }
                }),
                fetch(`${BASE_URL}/ownerDashboard/bookings/${bConcurrent}/reject`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${tokenO1}`,
                        'Content-Type': 'application/json'
                    }
                })
            ]);

            const statuses = [acceptRes.status, rejectRes.status].sort();
            // Exactly one must succeed with 200, and the other must be rejected with 409
            const oneSuccessOneConflict = statuses[0] === 200 && statuses[1] === 409;

            const [[row]] = await db.query('SELECT status FROM room_bookings WHERE id = ?', [bConcurrent]);
            const finalStateValid = row && (row.status === 'CONFIRMED' || row.status === 'CANCELLED');

            const success = oneSuccessOneConflict && finalStateValid;
            report(
                12,
                'Concurrent accept/reject cannot produce an invalid final state',
                success,
                `HTTP responses: [${acceptRes.status}, ${rejectRes.status}], DB final status: ${row?.status}`
            );
        } catch (e) {
            report(12, 'Concurrent accept/reject cannot produce an invalid final state', false, e.message);
        }

    } finally {
        // Clean up test records
        await db.query('DELETE FROM room_bookings WHERE property_id IN (?, ?)', [prop1Id, prop2Id]);
        await db.query('DELETE FROM properties WHERE id IN (?, ?)', [prop1Id, prop2Id]);
        await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [owner1Id, owner2Id, studentId]);

        if (server) {
            server.close();
        }
    }

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
    console.error('Test suite crashed with unhandled error:', err);
    process.exit(1);
});
