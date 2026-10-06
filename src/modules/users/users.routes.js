// src/modules/users/users.routes.js
const express = require('express');
const router = express.Router();
const usersController = require('./users.controller');
const { requireAuth, restrictTo } = require('../../middlewares/auth.middleware');

// Route for getting own profile (Any logged-in user can access)
router.get('/profile', requireAuth, usersController.getProfile);

router.get(
    '/owner/dashboard', 
    requireAuth, 
    restrictTo('OWNER'), // ONLY Owners can access
    usersController.getOwnerDashboard
);

router.get(
    '/admin/dashboard', 
    requireAuth, 
    restrictTo('ADMIN'), // ONLY Admins can access
    usersController.getAdminDashboard
);

module.exports = router;