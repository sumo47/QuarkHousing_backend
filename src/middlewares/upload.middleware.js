// src/middlewares/upload.middleware.js
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// 1. Configure Cloudinary Credentials
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. Set up dynamic storage options
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        // Default folder
        let folderName = 'quark-housing/general';

        // Dynamically assign folders based on the API endpoint route
        if (req.baseUrl.includes('properties')) {
            folderName = 'quark-housing/properties';
        } else if (req.baseUrl.includes('tiffin')) {
            folderName = 'quark-housing/tiffin';
        } else if (req.baseUrl.includes('auth')) {
            folderName = 'quark-housing/kyc'; // For ID proofs
        } else if (req.baseUrl.includes('owner')) {
            folderName = 'quark-housing/kyc'; // Owner KYC documents (Aadhaar/PAN/address proof)
        }

        return {
            folder: folderName,
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], // Strict format validation
            transformation: [{ width: 1280, height: 720, crop: 'limit', quality: 'auto' }] // Optimize image size
        };
    },
});

// 3. Create the Multer Upload Instance
const uploadMedia = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB per file max size limit
    }
});

module.exports = { uploadMedia };