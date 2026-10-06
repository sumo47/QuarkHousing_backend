// src/modules/users/users.controller.js
const db = require('../../config/db');
const ownerController = require('../ownerDashboard/owner.controller');
// @route   GET /api/v1/users/profile
exports.getProfile = async (req, res, next) => {
    try {
        // req.user.id hume auth.middleware se mil raha hai
        const userId = req.user.id;

        // Fetch latest user details from DB (excluding password)
        const [users] = await db.query(
            'SELECT id, full_name, email, phone, role, created_at FROM users WHERE id = ?', 
            [userId]
        );

        // console.log(users)

        if (users.length === 0) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        res.status(200).json({
            status: 'success',
            message:"User profile details",
            data: {
                user: users[0]
            }
        });

    } catch (error) {
        next(error);
    }
};

// Exclusively for Property Owners
exports.getOwnerDashboard = ownerController.getOverview;

// async (req, res, next) => {
//     try {
//         const ownerId = req.user.id;
        
//         // Future DB queries will fetch data specific to this ownerId
//         res.status(200).json({
//             status: 'success',
//             data: {
//                 message: 'Welcome to the Owner Dashboard',
//                 stats: {
//                     my_properties: 0,
//                     my_active_bookings: 0,
//                     my_total_earnings: 0
//                 }
//             }
//         });
//     } catch (error) {
//         next(error);
//     }
// };

// Exclusively for Super Admins
exports.getAdminDashboard = async (req, res, next) => {
    try {
        // Admin doesn't need ID filtering for platform-wide stats
        res.status(200).json({
            status: 'success',
            data: {
                message: 'Welcome to the Super Admin Dashboard',
                stats: {
                    total_users: 0,
                    pending_verifications: 0,
                    platform_revenue: 0, // Total Quark Commission
                    pending_payouts: 0
                }
            }
        });
    } catch (error) {
        next(error);
    }
};