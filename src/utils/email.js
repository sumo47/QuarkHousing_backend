const { Resend } = require('resend');

const sendEmail = async (options) => {
    // In test environment, allow mock/simulation unless testing simulated failure
    if (process.env.NODE_ENV === 'test') {
        if (options.simulateFailure || process.env.TEST_SIMULATE_EMAIL_FAILURE === 'true') {
            throw new Error('Email delivery failed: Simulated mail failure for test verification');
        }
        return { messageId: 'test-message-id', id: 'test-message-id' };
    }

    try {
        const apiKey = process.env.RESEND_API_KEY;
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'Quark Housing <onboarding@resend.dev>';
        const toEmail = options.email || options.to;
        const textContent = options.message || options.text;
        const htmlContent = options.html;

        const resend = new Resend(apiKey);

        const payload = {
            from: fromEmail,
            to: toEmail,
            subject: options.subject,
        };

        if (htmlContent) {
            payload.html = htmlContent;
        }
        if (textContent) {
            payload.text = textContent;
        }

        const { data, error } = await resend.emails.send(payload);

        if (error) {
            throw new Error(error.message || 'Resend email delivery failed');
        }

        return { messageId: data?.id, id: data?.id };
    } catch (mailError) {
        // In local development, if email credentials fail or network is offline,
        // log the email & OTP to the terminal console so the developer can proceed without being blocked.
        if (process.env.NODE_ENV !== 'production') {
            console.log('\n======================================================');
            console.log('⚠️ [DEV MODE] Email delivery failed (' + mailError.message + ')');
            console.log('📬 [EMAIL DISPATCH FALLBACK]');
            console.log('To:     ', options.email || options.to);
            console.log('Subject:', options.subject);
            console.log('Body:   ', options.message || options.text);
            console.log('======================================================\n');
            return { messageId: 'dev-fallback-message-id', id: 'dev-fallback-message-id' };
        }
        // In production, re-throw so authoritative error handling takes place
        throw mailError;
    }
};

module.exports = sendEmail;