const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
    // In test environment, allow mock/simulation unless testing simulated failure
    if (process.env.NODE_ENV === 'test') {
        if (options.simulateFailure || process.env.TEST_SIMULATE_EMAIL_FAILURE === 'true') {
            throw new Error('SMTP connection refused: Simulated mail failure for test verification');
        }
        return { messageId: 'test-message-id' };
    }

    try {
        // 1. Create a transporter
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        // 2. Define the email options
        const mailOptions = {
            from: '"Quark Housing" <support@quarkhousing.com>', // Sender address
            to: options.email,
            subject: options.subject,
            text: options.message,
            html: options.html // Optional HTML content
        };

        // 3. Send the email
        await transporter.sendMail(mailOptions);
    } catch (mailError) {
        // In local development, if SMTP credentials fail or network is offline,
        // log the email & OTP to the terminal console so the developer can proceed without being blocked.
        if (process.env.NODE_ENV !== 'production') {
            console.log('\n======================================================');
            console.log('⚠️ [DEV MODE] SMTP delivery failed (' + mailError.message + ')');
            console.log('📬 [EMAIL DISPATCH FALLBACK]');
            console.log('To:     ', options.email);
            console.log('Subject:', options.subject);
            console.log('Body:   ', options.message);
            console.log('======================================================\n');
            return { messageId: 'dev-fallback-message-id' };
        }
        // In production, re-throw so authoritative error handling takes place
        throw mailError;
    }
};

module.exports = sendEmail;