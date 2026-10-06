// src/modules/orders/orders.routes.js
const express = require('express');
const router = express.Router();
const ordersController = require('./orders.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { checkoutSchema } = require('./orders.schema');

// Every route in this module requires a logged-in STUDENT
router.use(requireAuth, restrictTo('STUDENT'));

router.post('/checkout', validate(checkoutSchema), ordersController.checkout);
router.get('/my-orders', ordersController.getMyOrders);
router.get('/:id', ordersController.getOrderDetails);

module.exports = router;