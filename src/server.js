const errorHandler = require("./middlewares/error.middleware");
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const db = require('./config/db');

const app = express();

const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const propertyRoutes = require('./modules/properties/property.routes');
const bookingRoutes = require('./modules/bookings/booking.routes');
const ownerRoutes = require('./modules/ownerDashboard/owner.routes')
const reviewRoutes = require('./modules/reviews/reviews.route')
const tiffinRoutes = require('./modules/tiffin/tiffin.route')
const cartRoutes = require('./modules/cart/cart.routes');
const orderRoutes = require('./modules/orders/orders.routes');
const membershipRoutes = require('./modules/membership/membership.routes');
const subscriptionRoutes = require('./modules/subscriptions/subscriptions.routes');
const vendorRoute = require('./modules/vendorDashboard/vendor.route')
const walletRoutes = require('./modules/wallet/wallet.route');
const referralRoutes = require('./modules/referrals/referrals.routes');
const couponRoutes = require('./modules/coupons/coupons.routes');
const customerRoutes = require('./modules/customerDashboard/customer.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const adminAuthRoutes = require('./modules/admin/adminAuth.routes');


app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Quark Housing API is running smoothly.'
    });
});

app.use('/api/v1/admin/auth', adminAuthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/properties', propertyRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/ownerDashboard', ownerRoutes);
app.use('/api/v1/reviews',reviewRoutes);
app.use('/api/v1/tiffin',tiffinRoutes)
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/membership', membershipRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/vendorDashboard', vendorRoute)
app.use('/api/v1/wallet',walletRoutes);
app.use('/api/v1/referrals',referralRoutes);
app.use('/api/v1/coupons',couponRoutes);
app.use('/api/v1/customer', customerRoutes);
app.use('/api/v1/admin',adminRoutes);

// app.use((err, req, res, next) => {
//     console.error(err.stack);
//     res.status(500).json({
//         status: 'error',
//         message: 'Internal Server Error'
//     });
// });

// Global Error Handler
app.use(errorHandler);


let server;
if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
