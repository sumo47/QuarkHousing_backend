// test_admin_system.js
// Comprehensive Verification Test Suite for QuarkHousing Admin Hardening Architecture
process.env.NODE_ENV = 'test';
require('dotenv').config();

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./src/config/db');
const { isEmailAllowlistedAdmin } = require('./src/utils/adminAuth');
const otpManager = require('./src/utils/otpManager');
const { generateAuthToken, blocklistToken } = require('./src/utils/token');
const { _resetRateLimitStore } = require('./src/middlewares/adminRateLimit.middleware');

const BASE_URL = 'http://localhost:5000/api/v1';

async function runTests() {
    console.log('====================================================');
    console.log('STARTING 22-POINT ADMIN HARDENING TEST SUITE');
    console.log('====================================================\n');

    let server;
    try {
        const check = await fetch('http://localhost:5000/health');
        if (!check.ok) throw new Error();
    } catch {
        const app = require('./src/server');
        server = app.listen(5000);
        await new Promise(r => setTimeout(r, 600));
    }

    async function getLatestOtpFromDb(email, purpose) {
        const cached = otpManager._getTestOtp(email, purpose);
        if (cached) return cached;
        const [rows] = await db.query(
            'SELECT otp_hash FROM auth_otps WHERE email = ? AND purpose = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1',
            [email, purpose]
        );
        if (!rows || rows.length === 0) return null;
        const targetHash = rows[0].otp_hash;
        for (let i = 100000; i <= 999999; i++) {
            const s = String(i);
            const h = crypto.createHash('sha256').update(s).digest('hex');
            if (h === targetHash) return s;
        }
        return null;
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
    // TEST 1: Non-allowlisted admin registration rejected
    // -----------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/admin/auth/send-register-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'unauthorized_hacker@evil.com' })
        });
        const body = await res.json();
        const success = res.status === 403 && body.status === 'error';
        report(1, 'Non-allowlisted admin registration rejected', success, JSON.stringify(body));
    } catch (e) {
        report(1, 'Non-allowlisted admin registration rejected', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 2: Allowlisted admin registration works with OTP
    // -----------------------------------------------------------------
    const testAdminEmail = 'testadmin@quarkhousing.com';
    try {
        // Clean any old test records for this email
        await db.query('DELETE FROM auth_otps WHERE email = ?', [testAdminEmail]);
        await db.query('DELETE FROM users WHERE email = ?', [testAdminEmail]);

        // Generate OTP in MySQL
        await otpManager.generateAndSendOtp({
            email: testAdminEmail,
            purpose: 'ADMIN_REGISTER',
            subject: 'Admin Test Registration'
        });

        const plainOtp = otpManager._getTestOtp(testAdminEmail, 'ADMIN_REGISTER');

        const regRes = await fetch(`${BASE_URL}/admin/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                full_name: 'Hardened Admin',
                email: testAdminEmail,
                password: 'Password123!',
                otp: plainOtp,
                phone: '9876543210'
            })
        });
        const regBody = await regRes.json();
        const success = regRes.status === 201 && regBody.data?.user?.role === 'ADMIN';
        report(2, 'Allowlisted admin registration works with OTP', success, JSON.stringify(regBody));
    } catch (e) {
        report(2, 'Allowlisted admin registration works with OTP', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 3: Wrong OTP rejected
    // -----------------------------------------------------------------
    try {
        const verifyRes = await otpManager.verifyOtp({
            email: testAdminEmail,
            otp: '000000',
            purpose: 'ADMIN_REGISTER'
        });
        const success = verifyRes.valid === false;
        report(3, 'Wrong OTP rejected', success, verifyRes.message);
    } catch (e) {
        report(3, 'Wrong OTP rejected', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 4: Expired OTP rejected
    // -----------------------------------------------------------------
    try {
        const expiredEmail = 'expired_test@quarkhousing.com';
        const expiredHash = crypto.createHash('sha256').update('123456').digest('hex');
        const pastDate = new Date(Date.now() - 20 * 60 * 1000); // 20 mins ago

        await db.query(
            `INSERT INTO auth_otps (email, otp_hash, purpose, attempts, max_attempts, expires_at)
             VALUES (?, ?, 'ADMIN_REGISTER', 0, 5, ?)`,
            [expiredEmail, expiredHash, pastDate]
        );

        const verifyRes = await otpManager.verifyOtp({
            email: expiredEmail,
            otp: '123456',
            purpose: 'ADMIN_REGISTER'
        });
        const success = verifyRes.valid === false && verifyRes.message.includes('expired');
        report(4, 'Expired OTP rejected', success, verifyRes.message);
    } catch (e) {
        report(4, 'Expired OTP rejected', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 5: Consumed OTP rejected (Single-use)
    // -----------------------------------------------------------------
    try {
        const singleUseEmail = 'singleuse@quarkhousing.com';
        await otpManager.generateAndSendOtp({
            email: singleUseEmail,
            purpose: 'ADMIN_REGISTER',
            subject: 'Single Use Test'
        });
        const otp = otpManager._getTestOtp(singleUseEmail, 'ADMIN_REGISTER');

        // First verification succeeds
        const first = await otpManager.verifyOtp({ email: singleUseEmail, otp, purpose: 'ADMIN_REGISTER' });
        // Second verification MUST fail because consumed_at is set in MySQL
        const second = await otpManager.verifyOtp({ email: singleUseEmail, otp, purpose: 'ADMIN_REGISTER' });
        const success = first.valid === true && second.valid === false;
        report(5, 'Consumed OTP rejected (Single-use enforced in DB)', success, `First: ${first.valid}, Second: ${second.valid}`);
    } catch (e) {
        report(5, 'Consumed OTP rejected (Single-use enforced in DB)', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 6: OTP purpose mismatch rejected
    // -----------------------------------------------------------------
    try {
        const mismatchEmail = 'mismatch@quarkhousing.com';
        await otpManager.generateAndSendOtp({
            email: mismatchEmail,
            purpose: 'ADMIN_REGISTER',
            subject: 'Purpose Mismatch'
        });
        const otp = otpManager._getTestOtp(mismatchEmail, 'ADMIN_REGISTER');

        // Attempt to verify with ADMIN_LOGIN purpose
        const result = await otpManager.verifyOtp({
            email: mismatchEmail,
            otp,
            purpose: 'ADMIN_LOGIN'
        });
        const success = result.valid === false;
        report(6, 'OTP purpose mismatch rejected (ADMIN_REGISTER cannot be used for ADMIN_LOGIN)', success, result.message);
    } catch (e) {
        report(6, 'OTP purpose mismatch rejected', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 7: OTP attempt limit enforced (Max 5 attempts)
    // -----------------------------------------------------------------
    try {
        const attemptEmail = 'attempts@quarkhousing.com';
        await otpManager.generateAndSendOtp({
            email: attemptEmail,
            purpose: 'ADMIN_LOGIN',
            subject: 'Attempt Limit Test'
        });
        // Send 5 wrong OTPs
        for (let i = 0; i < 5; i++) {
            await otpManager.verifyOtp({ email: attemptEmail, otp: '999999', purpose: 'ADMIN_LOGIN' });
        }
        // 6th attempt must be rejected
        const sixth = await otpManager.verifyOtp({ email: attemptEmail, otp: '999999', purpose: 'ADMIN_LOGIN' });
        const success = sixth.valid === false;
        report(7, 'OTP attempt limit enforced (Max 5 attempts)', success, sixth.message);
    } catch (e) {
        report(7, 'OTP attempt limit enforced', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 8: OTP survives application restart because DB is authoritative
    // -----------------------------------------------------------------
    try {
        const persistEmail = 'persist@quarkhousing.com';
        const plainOtp = '654321';
        const hash = crypto.createHash('sha256').update(plainOtp).digest('hex');
        const futureDate = new Date(Date.now() + 10 * 60 * 1000);

        // Directly insert into MySQL table simulating an OTP saved before server restart
        await db.query(
            `INSERT INTO auth_otps (email, otp_hash, purpose, attempts, max_attempts, expires_at)
             VALUES (?, ?, 'ADMIN_LOGIN', 0, 5, ?)`,
            [persistEmail, hash, futureDate]
        );

        // Verify without any memory state -> MySQL reads it directly
        const verifyRes = await otpManager.verifyOtp({
            email: persistEmail,
            otp: plainOtp,
            purpose: 'ADMIN_LOGIN'
        });

        const success = verifyRes.valid === true;
        report(8, 'OTP survives application restart because DB is authoritative', success);
    } catch (e) {
        report(8, 'OTP survives application restart because DB is authoritative', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 9: Normal registration cannot create ADMIN
    // -----------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                full_name: 'Attacker Admin',
                email: 'attacker@example.com',
                phone: '9123456789',
                password: 'Password123!',
                role: 'ADMIN'
            })
        });
        const body = await res.json();
        const success = res.status === 403 && body.message.includes('Admin accounts cannot be registered');
        report(9, 'Normal registration cannot create ADMIN -> 403 Forbidden', success, JSON.stringify(body));
    } catch (e) {
        report(9, 'Normal registration cannot create ADMIN', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 10: Normal login cannot login ADMIN
    // -----------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testAdminEmail,
                password: 'Password123!'
            })
        });
        const body = await res.json();
        const success = res.status === 403 && body.message.includes('dedicated Admin Portal');
        report(10, 'Normal login cannot login ADMIN -> 403 Forbidden', success, JSON.stringify(body));
    } catch (e) {
        report(10, 'Normal login cannot login ADMIN', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 11: Admin password-only login never returns JWT
    // -----------------------------------------------------------------
    let loginChallengeId = null;
    try {
        _resetRateLimitStore();
        const res = await fetch(`${BASE_URL}/admin/auth/login-init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testAdminEmail,
                password: 'Password123!'
            })
        });
        const body = await res.json();
        loginChallengeId = body.challenge_id;
        const success = res.status === 200 && body.step === 'OTP_REQUIRED' && body.token === undefined && !!body.challenge_id;
        report(11, 'Admin password-only login never returns JWT (step=OTP_REQUIRED + challenge_id)', success, JSON.stringify(body));
    } catch (e) {
        report(11, 'Admin password-only login never returns JWT', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 12: Admin login with password + valid OTP returns JWT
    // -----------------------------------------------------------------
    let adminToken = null;
    try {
        const otp = await getLatestOtpFromDb(testAdminEmail, 'ADMIN_LOGIN');
        const res = await fetch(`${BASE_URL}/admin/auth/login-verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testAdminEmail,
                otp,
                challenge_id: loginChallengeId
            })
        });
        const body = await res.json();
        adminToken = body.token;
        const success = res.status === 200 && !!body.token && body.data?.user?.role === 'ADMIN';
        report(12, 'Admin login with password + valid OTP returns JWT', success, JSON.stringify(body));
    } catch (e) {
        report(12, 'Admin login with password + valid OTP returns JWT', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 13: Admin login rate limit works (429 after 5 failed attempts)
    // -----------------------------------------------------------------
    try {
        _resetRateLimitStore();
        let rateLimited = false;
        // Submit 5 wrong password attempts
        for (let i = 0; i < 5; i++) {
            await fetch(`${BASE_URL}/admin/auth/login-init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: testAdminEmail, password: 'WrongPassword!' })
            });
        }
        // 6th attempt must return 429
        const res = await fetch(`${BASE_URL}/admin/auth/login-init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testAdminEmail, password: 'WrongPassword!' })
        });
        const body = await res.json();
        rateLimited = res.status === 429;
        _resetRateLimitStore(); // Reset after test
        report(13, 'Admin login rate limit works (429 after 5 failed attempts)', rateLimited, JSON.stringify(body));
    } catch (e) {
        report(13, 'Admin login rate limit works', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 14: Non-admin cannot access admin APIs (403 Forbidden)
    // -----------------------------------------------------------------
    try {
        const studentToken = jwt.sign(
            { id: 1, role: 'STUDENT', email: 'test.student@example.com' },
            process.env.JWT_SECRET || 'talk_less_show_code',
            { expiresIn: '1h' }
        );
        const res = await fetch(`${BASE_URL}/admin/overview`, {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        const body = await res.json();
        const success = res.status === 403;
        report(14, 'Non-admin cannot access admin APIs -> 403 Forbidden', success, JSON.stringify(body));
    } catch (e) {
        report(14, 'Non-admin cannot access admin APIs', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 15: Removing admin email from ADMIN_IDS blocks admin authorization
    // -----------------------------------------------------------------
    try {
        const original = process.env.ADMIN_IDS;
        process.env.ADMIN_IDS = 'other_admin@example.com';
        const isBlocked = isEmailAllowlistedAdmin(testAdminEmail) === false;

        // Try accessing with active admin token while removed from allowlist
        const res = await fetch(`${BASE_URL}/admin/overview`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const body = await res.json();
        process.env.ADMIN_IDS = original; // restore

        const success = isBlocked && res.status === 403 && body.message.includes('not in the admin allowlist');
        report(15, 'Removing admin email from ADMIN_IDS blocks admin authorization', success, JSON.stringify(body));
    } catch (e) {
        report(15, 'Removing admin email from ADMIN_IDS blocks admin authorization', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 16: Profile GET/PATCH protected
    // -----------------------------------------------------------------
    try {
        const unauthGet = await fetch(`${BASE_URL}/admin/profile`);
        const unauthPatch = await fetch(`${BASE_URL}/admin/profile`, { method: 'PATCH' });
        const authGet = await fetch(`${BASE_URL}/admin/profile`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const getBody = await authGet.json();

        const success = unauthGet.status === 401 && unauthPatch.status === 401 && authGet.status === 200 && getBody.data?.admin?.email === testAdminEmail;
        report(16, 'Profile GET/PATCH protected by authentication and authorization', success, JSON.stringify(getBody));
    } catch (e) {
        report(16, 'Profile GET/PATCH protected', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 17: Profile cannot change role/email/security fields
    // -----------------------------------------------------------------
    try {
        const patchRes = await fetch(`${BASE_URL}/admin/profile`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                full_name: 'Renamed Administrator',
                role: 'STUDENT', // Attempted role tampering
                email: 'hacked@example.com' // Attempted email tampering
            })
        });
        const patchBody = await patchRes.json();
        // Verify in DB that role and email are unchanged
        const [users] = await db.query('SELECT role, email, full_name FROM users WHERE email = ?', [testAdminEmail]);
        const success = users[0].role === 'ADMIN' && users[0].email === testAdminEmail && users[0].full_name === 'Renamed Administrator';
        report(17, 'Profile cannot change role/email/security fields (tampering ignored)', success, JSON.stringify(users[0]));
    } catch (e) {
        report(17, 'Profile cannot change role/email/security fields', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 18: Password change invalidates previous sessions
    // -----------------------------------------------------------------
    try {
        // 1. Get OTP for password change
        await otpManager.generateAndSendOtp({
            email: testAdminEmail,
            purpose: 'ADMIN_PASSWORD_CHANGE',
            subject: 'Password Change Test'
        });
        const changeOtp = await getLatestOtpFromDb(testAdminEmail, 'ADMIN_PASSWORD_CHANGE');

        // Capture previous adminToken
        const oldToken = adminToken;

        // Change password
        const changeRes = await fetch(`${BASE_URL}/admin/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${oldToken}`
            },
            body: JSON.stringify({
                current_password: 'Password123!',
                new_password: 'NewStrongPassword456!',
                otp: changeOtp
            })
        });

        // Test accessing API with oldToken -> MUST be rejected with 401
        const testOld = await fetch(`${BASE_URL}/admin/profile`, {
            headers: { Authorization: `Bearer ${oldToken}` }
        });
        const testOldBody = await testOld.json();

        const success = changeRes.status === 200 && testOld.status === 401;
        report(18, 'Password change invalidates previous sessions (old token rejected with 401)', success, JSON.stringify(testOldBody));
    } catch (e) {
        report(18, 'Password change invalidates previous sessions', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 19: Password reset invalidates previous sessions
    // -----------------------------------------------------------------
    try {
        // Fetch authoritative admin ID from users table
        const [[adminUser]] = await db.query('SELECT id FROM users WHERE email = ?', [testAdminEmail]);
        // Sign a session token issued prior to the reset event
        const preResetToken = jwt.sign(
            { id: adminUser.id, role: 'ADMIN', email: testAdminEmail, iat: Math.floor(Date.now() / 1000) - 5 },
            process.env.JWT_SECRET || 'talk_less_show_code',
            { expiresIn: '7d' }
        );

        // Request reset OTP
        await otpManager.generateAndSendOtp({
            email: testAdminEmail,
            purpose: 'ADMIN_RESET_PASSWORD',
            subject: 'Reset Test'
        });
        const resetOtp = await getLatestOtpFromDb(testAdminEmail, 'ADMIN_RESET_PASSWORD');

        // Reset password
        const resetRes = await fetch(`${BASE_URL}/admin/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testAdminEmail,
                otp: resetOtp,
                new_password: 'ResetPassword789!'
            })
        });

        // Test accessing API with preResetToken -> MUST be rejected with 401
        const testPre = await fetch(`${BASE_URL}/admin/profile`, {
            headers: { Authorization: `Bearer ${preResetToken}` }
        });
        const testPreBody = await testPre.json();

        const success = resetRes.status === 200 && testPre.status === 401;
        report(19, 'Password reset invalidates previous sessions', success, JSON.stringify(testPreBody));
    } catch (e) {
        report(19, 'Password reset invalidates previous sessions', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 20: OTP is never returned in API responses
    // -----------------------------------------------------------------
    try {
        await db.query('DELETE FROM auth_otps WHERE email = ?', ['leak_check@quarkhousing.com']);
        const res = await fetch(`${BASE_URL}/admin/auth/send-register-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'superadmin@quarkhousing.com' })
        });
        const body = await res.json();
        const raw = JSON.stringify(body);
        const leaked = /"otp"\s*:\s*"\d{6}"/.test(raw);
        const success = !leaked;
        report(20, 'OTP is never returned in API responses', success, raw);
    } catch (e) {
        report(20, 'OTP is never returned in API responses', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 21: Password hash is never returned
    // -----------------------------------------------------------------
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [testAdminEmail]);
        const res = await fetch(`${BASE_URL}/admin/auth/login-init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testAdminEmail, password: 'ResetPassword789!' })
        });
        const body = await res.json();
        const raw = JSON.stringify(body);
        const success = !raw.includes('password_hash') && !raw.includes('$2a$') && !raw.includes('$2b$');
        report(21, 'Password hash is never returned in responses', success);
    } catch (e) {
        report(21, 'Password hash is never returned', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 22: Existing admin moderation APIs still work
    // -----------------------------------------------------------------
    try {
        // Authenticate with fresh password and OTP
        const initRes = await fetch(`${BASE_URL}/admin/auth/login-init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testAdminEmail, password: 'ResetPassword789!' })
        });
        const initBody = await initRes.json();
        const otp = await getLatestOtpFromDb(testAdminEmail, 'ADMIN_LOGIN');

        const verifyRes = await fetch(`${BASE_URL}/admin/auth/login-verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testAdminEmail,
                otp,
                challenge_id: initBody.challenge_id
            })
        });
        const verifyBody = await verifyRes.json();
        const freshToken = verifyBody.token;

        // Call an existing moderation API
        const overviewRes = await fetch(`${BASE_URL}/admin/overview`, {
            headers: { Authorization: `Bearer ${freshToken}` }
        });
        const overviewBody = await overviewRes.json();

        const success = overviewRes.status === 200 && overviewBody.status === 'success';
        report(22, 'Existing admin moderation APIs still work (/admin/overview)', success, JSON.stringify(overviewBody));

        // Cleanup test user
        await db.query('DELETE FROM auth_otps WHERE email = ?', [testAdminEmail]);
        await db.query('DELETE FROM users WHERE email = ?', [testAdminEmail]);
    } catch (e) {
        report(22, 'Existing admin moderation APIs still work', false, e.message);
    }

    // -----------------------------------------------------------------
    // TEST 23 (Requirement 5): OTP email failure invalidates DB record & returns 502
    // -----------------------------------------------------------------
    try {
        const failEmail = 'fail_delivery@quarkhousing.com';
        process.env.TEST_SIMULATE_EMAIL_FAILURE = 'true';
        let caughtErr = null;
        try {
            await otpManager.generateAndSendOtp({
                email: failEmail,
                purpose: 'ADMIN_REGISTER',
                subject: 'Failure Test'
            });
        } catch (err) {
            caughtErr = err;
        } finally {
            delete process.env.TEST_SIMULATE_EMAIL_FAILURE;
        }

        // Verify that OTP record in DB has consumed_at populated (invalidated)
        const [rows] = await db.query(
            'SELECT consumed_at FROM auth_otps WHERE email = ? AND purpose = "ADMIN_REGISTER" ORDER BY id DESC LIMIT 1',
            [failEmail]
        );
        const recordInvalidated = rows.length > 0 && rows[0].consumed_at !== null;
        const success = caughtErr && caughtErr.statusCode === 502 && recordInvalidated;
        report('23 (Req 5)', 'OTP email delivery failure invalidates DB record and returns 502', success);
        await db.query('DELETE FROM auth_otps WHERE email = ?', [failEmail]);
    } catch (e) {
        report('23 (Req 5)', 'OTP email delivery failure handling', false, e.message);
    }

    if (server) {
        server.close();
    }

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('====================================================');

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
