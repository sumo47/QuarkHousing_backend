# Rule for Developers
1. always ```git pull``` before start work

# Architecture
1.  System components
    - 
* **Web Server:** Node.js (Express)
* **Database:** MySQL
* **Media Storage:** Cloudinary (Images/Videos ke liye).
* **ORM / Query Builder:** Sequelize ya Knex.js

2. Directory Structure (The Blueprint)
   -

```text
quark-backend/
├── src/
│   ├── config/              # DB connection, Cloudinary config, Environment variables
│   ├── middlewares/         # Auth verification, Error handling, Multer/Cloudinary uploads
│   ├── modules/             # Core Business Logic (Domain Driven)
│   │   ├── auth/            # Controllers, Services, Routes for Login/Register
│   │   ├── users/           # Profile, Dashboard, Referral logic
│   │   ├── properties/      # Room listing, Search, Media, Facilities
│   │   ├── bookings/        # Booking requests, ID proof verification
│   │   ├── tiffin/          # Vendor setup, Menus, Subscriptions
│   │   └── payments/        # Transactions, Commission splits, Ledgers
│   ├── utils/               # Helper functions (Hash passwords, format dates)
│   ├── app.js               # Express application initialization
│   └── server.js            # Entry point, Server listening
├── .env                     # Secrets (DB credentials, API keys)
└── package.json

```
3. Tables
   -

* Users 


```sql
-- Users Table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('STUDENT', 'OWNER', 'VENDOR', 'ADMIN') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```
```sql
-- To create tables in MySQL
Get-Content database\schema.sql | mysql -u root -p

```