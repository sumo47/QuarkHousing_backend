const errorHandler = (err, req, res, next) => {
    console.error(err);

    // Handle Multer upload errors
    if (err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                status: 'error',
                message: 'Maximum 15 photos allowed per property listing.'
            });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                status: 'error',
                message: 'File size exceeds 5MB limit per photo.'
            });
        }
        return res.status(400).json({
            status: 'error',
            message: err.message || 'File upload failed.'
        });
    }

    res.status(err.statusCode || 500).json({
        status: err.status || "error",
        message:
            process.env.NODE_ENV === "production"
                ? "Internal Server Error"
                : err.message,
    });
};

module.exports = errorHandler;