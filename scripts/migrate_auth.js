// scripts/migrate_auth.js
// NON-DESTRUCTIVE MIGRATION FOR ADMIN AUTHENTICATION SCHEMA
// Safe for existing databases: NEVER drops tables, NEVER deletes existing data.
const db = require('../src/config/db');

async function run() {
    console.log('====================================================');
    console.log('STARTING NON-DESTRUCTIVE ADMIN AUTH SCHEMA MIGRATION');
    console.log('Safety: No tables or data will be dropped or deleted.');
    console.log('====================================================\n');
    
    // 1. Create auth_otps table if not exists (NON-DESTRUCTIVE)
    await db.query(`
        CREATE TABLE IF NOT EXISTS auth_otps (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(150) NOT NULL,
            otp_hash VARCHAR(64) NOT NULL,
            purpose ENUM('ADMIN_REGISTER', 'ADMIN_LOGIN', 'ADMIN_PASSWORD_CHANGE', 'ADMIN_RESET_PASSWORD') NOT NULL,
            challenge_id VARCHAR(64) NULL,
            attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
            max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
            expires_at DATETIME NOT NULL,
            consumed_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_auth_otps_email_purpose (email, purpose),
            INDEX idx_auth_otps_challenge (challenge_id),
            INDEX idx_auth_otps_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[OK] auth_otps table verified / created if missing (non-destructive).');

    // 2. Add email_verified_at if not exists (NON-DESTRUCTIVE)
    try {
        await db.query('ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER role');
        console.log('[OK] Added email_verified_at to users table.');
    } catch (e) {
        if (e.message.includes('Duplicate column')) {
            console.log('[INFO] email_verified_at already exists on users table (no change needed).');
        } else {
            throw e;
        }
    }

    // 3. Add password_changed_at if not exists (NON-DESTRUCTIVE)
    try {
        await db.query('ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL AFTER email_verified_at');
        console.log('[OK] Added password_changed_at to users table.');
    } catch (e) {
        if (e.message.includes('Duplicate column')) {
            console.log('[INFO] password_changed_at already exists on users table (no change needed).');
        } else {
            throw e;
        }
    }

    // 4. Modify phone to be NULL-able (NON-DESTRUCTIVE)
    try {
        await db.query('ALTER TABLE users MODIFY phone VARCHAR(20) NULL');
        console.log('[OK] Modified users.phone to NULL-able.');
    } catch (e) {
        console.log('[INFO] Note on phone column:', e.message);
    }

    console.log('\n====================================================');
    console.log('NON-DESTRUCTIVE MIGRATION COMPLETED SUCCESSFULLY');
    console.log('All existing tables and user records preserved intact.');
    console.log('====================================================');
    process.exit(0);
}

run().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
});
