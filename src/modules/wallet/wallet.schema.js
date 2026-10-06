// src/modules/wallet/wallet.schema.js
const { z } = require('zod');

exports.addMoneySchema = z.object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid amount")
});