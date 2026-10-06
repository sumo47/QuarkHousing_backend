// src/modules/wallet/wallet.routes.js
const express = require('express');
const router = express.Router();
const walletController = require('./wallet.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { addMoneySchema } = require('./wallet.schema');

router.use(requireAuth, restrictTo('STUDENT'));

router.get('/', walletController.getWallet);
router.get('/transactions', walletController.getTransactions);
router.post('/add-money', validate(addMoneySchema), walletController.addMoney);

module.exports = router;