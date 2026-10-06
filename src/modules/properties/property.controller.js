const db = require('../../config/db');

// @route   POST /api/v1/properties
// @access  Private (OWNER only)
exports.createProperty = async (req, res, next) => {
    // Acquire a dedicated connection for the transaction
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const owner_id = req.user.id;
        const data = req.body;

        // Authoritative KYC Verification check inside transaction
        if (req.user.role !== 'ADMIN') {
            const [kycRows] = await connection.query(
                `SELECT verification_status FROM owner_kyc_documents WHERE owner_id = ? LIMIT 1`,
                [owner_id]
            );

            if (kycRows.length === 0 || kycRows[0].verification_status !== 'VERIFIED') {
                await connection.rollback();
                return res.status(403).json({
                    status: 'error',
                    message: 'Owner verification is required before you can list a property.'
                });
            }
        }

        // Photo count check
        if (req.files && req.files.length > 15) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'A property listing can have a maximum of 15 photos.'
            });
        }

        //Check If the Property exists before creatinig
        const [existingProperty] = await connection.query(
            `SELECT p.id
             FROM properties p
             JOIN property_addresses a ON p.id = a.property_id
             WHERE p.owner_id = ?
               AND p.title = ?
               AND a.address_line = ?
               AND a.city = ?
               AND a.pincode = ?
             LIMIT 1`,
            [
                owner_id,
                data.title,
                data.address_line,
                data.city,
                data.pincode
            ]
        );
        
        if (existingProperty.length > 0) {
            await connection.rollback();
        
            return res.status(409).json({
                status: 'error',
                message: 'You have already listed this property'
            });
        }

        // 1. Insert into `properties` table
        const [propertyResult] = await connection.query(
            `INSERT INTO properties 
            (owner_id, title, property_type, gender_preference, monthly_rent, confirmation_payment, distance_from_college) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                owner_id,
                data.title,
                data.property_type,
                data.gender_preference,
                parseFloat(data.monthly_rent),
                parseFloat(data.confirmation_payment),
                data.distance_from_college || null
            ]
        );

        const property_id = propertyResult.insertId; // Get the newly generated ID

        // 2. Insert into `property_addresses`
        await connection.query(
            `INSERT INTO property_addresses 
            (property_id, address_line, locality, landmark, city, state, pincode, google_maps_url) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                property_id,
                data.address_line,
                data.locality,
                data.landmark || null,
                data.city,
                data.state,
                data.pincode,
                data.google_maps_url || null
            ]
        );

        // 3. Insert into `property_facilities`
        // Convert string booleans from formData to actual numbers (1 or 0) for MySQL
        const isTrue = (val) => val === 'true' || val === '1' ? 1 : 0;

        await connection.query(
            `INSERT INTO property_facilities 
            (property_id, attached_bathroom, wifi, quark_tiffin_available, veg_allowed, non_veg_allowed, parking, max_capacity) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                property_id,
                isTrue(data.attached_bathroom),
                isTrue(data.wifi),
                isTrue(data.quark_tiffin_available),
                isTrue(data.veg_allowed),
                isTrue(data.non_veg_allowed),
                isTrue(data.parking),
                parseInt(data.max_capacity) || 1
            ]
        );

        // 4. Handle Media Uploads (Cloudinary)
        // If files were uploaded via Multer, req.files will contain the array
        
        if (req.files && req.files.length > 0) {
            console.log(req.files);
            
            const mediaQueries = req.files.map(file => {
                // const imageUrl =
                //     file.secure_url ||
                //     file.path ||
                //     file.url;
                return connection.query(
                    `INSERT INTO property_media (property_id, image_url) VALUES (?, ?)`,
                    [property_id, file.path]
                );
            });
            await Promise.all(mediaQueries);
        }

        // Commit the transaction (Save everything permanently)
        await connection.commit();

        res.status(201).json({
            status: 'success',
            message: 'Property listed successfully',
            data: { property_id }
        });

    } catch (error) {
        // If anything fails, rollback all queries
        await connection.rollback();
        next(error);
        // res.status(500).send({ status: "error", message: error.message })
    } finally {
        // Release the connection back to the pool to prevent memory leaks
        connection.release();
    }
};


// @route   GET /api/v1/properties/search
// @access  Public (No login required to just browse)
exports.searchProperties = async (req, res, next) => {
    try {
        const { city, property_type, gender_preference } = req.query;

        let query = `
            SELECT 
                p.id, p.title, p.property_type, p.gender_preference, p.monthly_rent, p.distance_from_college, p.is_featured,
                a.city, a.locality,
                (SELECT image_url FROM property_media WHERE property_id = p.id LIMIT 1) as thumbnail
            FROM properties p
            JOIN property_addresses a ON p.id = a.property_id
            WHERE p.is_active = 1
        `;
        const queryParams = [];

        // Apply dynamic filters
        if (city) {
            query += ` AND a.city = ?`;
            queryParams.push(city);
        }
        if (property_type) {
            query += ` AND p.property_type = ?`;
            queryParams.push(property_type);
        }
        if (gender_preference) {
            query += ` AND p.gender_preference = ?`;
            queryParams.push(gender_preference);
        }

        query += ` ORDER BY p.is_featured DESC, p.created_at DESC`;

        const [properties] = await db.query(query, queryParams);

        res.status(200).json({
            status: 'success',
            results: properties.length,
            data: properties
        });
    } catch (error) {
        next(error);
    }
};

// @route   GET /api/v1/properties/:id
// @access  Public
exports.getPropertyDetails = async (req, res, next) => {
    try {
        const propertyId = req.params.id;

        // 1. Fetch Basic Info & Address
        const [propertyResult] = await db.query(`
            SELECT p.*, a.address_line, a.locality, a.landmark, a.city, a.state, a.pincode, a.google_maps_url 
            FROM properties p
            JOIN property_addresses a ON p.id = a.property_id
            WHERE p.id = ? AND p.is_active = 1
        `, [propertyId]);

        if (propertyResult.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Property not found' });
        }

        // 2. Fetch Facilities
        const [facilitiesResult] = await db.query(`
            SELECT * FROM property_facilities WHERE property_id = ?
        `, [propertyId]);

        // 3. Fetch Media
        const [mediaResult] = await db.query(`
            SELECT image_url FROM property_media WHERE property_id = ?
        `, [propertyId]);

        // Construct the final JSON response
        const propertyDetails = {
            ...propertyResult[0],
            facilities: facilitiesResult[0] || {},
            media: mediaResult.map(m => m.image_url) // Return an array of strings
        };

        res.status(200).json({
            status: 'success',
            data: propertyDetails
        });
    } catch (error) {
        next(error);
    }
};