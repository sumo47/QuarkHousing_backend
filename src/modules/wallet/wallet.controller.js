// src/modules/wallet/wallet.controller.js
const db = require('../../config/db');
const walletService = require('./wallet.service');

// @route   GET /api/v1/wallet
// @access  Private (STUDENT)
exports.getWallet = async (req, res, next) => {
    try {
        const summary = await walletService.getBalance(req.user.id);
        res.status(200).json({ status: 'success', data: summary });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/wallet/transactions
// @access  Private (STUDENT)
exports.getTransactions = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = (page - 1) * limit;

        const [transactions] = await db.query(
            `SELECT id, type, amount, source, status, description, created_at
             FROM wallet_transactions WHERE customer_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [customerId, limit, offset]
        );

        res.status(200).json({ status: 'success', results: transactions.length, page, limit, data: { transactions } });
    } catch (error) {
        next(error);
    }
};

// @route   POST /api/v1/wallet/add-money
// @access  Private (STUDENT)
// No payment gateway yet -- creates a PENDING credit, manually flipped to
// COMPLETED the same way every other "payment" is simulated in this app.
exports.addMoney = async (req, res, next) => {
    try {
        const customerId = req.user.id;
        const amount = parseFloat(req.body.amount);

        if (amount <= 0) {
            return res.status(400).json({ status: 'error', message: 'Amount must be greater than zero' });
        }

        const [result] = await db.query(
            `INSERT INTO wallet_transactions (customer_id, type, amount, source, status, description)
             VALUES (?, 'CREDIT', ?, 'ADD_MONEY', 'PENDING', 'Wallet top-up')`,
            [customerId, amount]
        );

        res.status(201).json({
            status: 'success',
            message: 'Add money request submitted. Your balance will update once payment is confirmed.',
            data: { transaction_id: result.insertId }
        });
    } catch (error) {
        next(error);
    }
};