// src/modules/cart/cart.routes.js
const express = require('express');
const router = express.Router();
const cartController = require('./cart.controller');
const validate = require('../../middlewares/validate.middleware');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');
const { addToCartSchema, updateCartItemSchema } = require('./cart.schema');

// Every route in this module requires a logged-in STUDENT
router.use(requireAuth, restrictTo('STUDENT'));

router.post('/', validate(addToCartSchema), cartController.addToCart);
router.get('/', cartController.getCart);
router.patch('/:itemId', validate(updateCartItemSchema), cartController.updateCartItem);
router.delete('/:itemId', cartController.removeCartItem);
router.delete('/', cartController.clearCart);

module.exports = router;