// src/modules/wallet/wallet.service.js
const db = require('../../config/db');

// Credits a customer's wallet immediately (status COMPLETED) -- used for
// internal platform decisions like referral rewards, where there's no
// external payment step to wait on.
exports.creditWallet = async (customerId, amount, source, description, referenceId = null) => {
    await db.query(
        `INSERT INTO wallet_transactions (customer_id, type, amount, source, status, description, reference_id)
         VALUES (?, 'CREDIT', ?, ?, 'COMPLETED', ?, ?)`,
        [customerId, amount, source, description, referenceId]
    );
};

// Computes a customer's current balance by summing the ledger -- never
// stored redundantly, so it can't drift out of sync with the transactions.
exports.getBalance = async (customerId) => {
    const [[row]] = await db.query(
        `SELECT
            COALESCE(SUM(CASE WHEN type = 'CREDIT' AND status = 'COMPLETED' THEN amount ELSE 0 END), 0) AS total_credited,
            COALESCE(SUM(CASE WHEN type = 'DEBIT' AND status = 'COMPLETED' THEN amount ELSE 0 END), 0) AS total_debited
         FROM wallet_transactions WHERE customer_id = ?`,
        [customerId]
    );
    const total_credited = Number(row.total_credited);
    const total_debited = Number(row.total_debited);
    return { balance: total_credited - total_debited, total_credited, total_debited };
};