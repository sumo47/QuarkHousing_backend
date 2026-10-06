// src/modules/membership/membership.schema.js
const { z } = require('zod');

exports.purchaseMembershipSchema = z.object({
    plan_id: z.string().regex(/^\d+$/, "plan_id must be a valid number")
});