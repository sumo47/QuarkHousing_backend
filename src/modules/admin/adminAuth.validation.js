// src/modules/admin/adminAuth.validation.js
const { z } = require('zod');

const strongPassword = z.string({ required_error: "Password is required" })
    .min(8, "Password must be at least 8 characters")
    .max(32, "Password cannot exceed 32 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[\W_]/, "Password must contain at least one special character (@, $, !, %, *, ?, &, etc.)");

exports.sendRegisterOtpSchema = z.object({
    email: z.string({ required_error: "Email is required" })
        .trim()
        .toLowerCase()
        .email("Invalid email address format")
});

exports.adminRegisterSchema = z.object({
    full_name: z.string({ required_error: "Full name is required" })
        .trim()
        .min(2, "Name must be at least 2 characters long")
        .max(50, "Name cannot exceed 50 characters")
        .regex(/^[a-zA-Z\s]+$/, "Name can only contain alphabets and spaces"),

    email: z.string({ required_error: "Email is required" })
        .trim()
        .toLowerCase()
        .email("Invalid email address format"),

    phone: z.string()
        .trim()
        .regex(/^[6-9]\d{9}$/, "Must be a valid 10-digit phone number")
        .optional()
        .nullable(),

    password: strongPassword,

    otp: z.string({ required_error: "OTP is required" })
        .trim()
        .length(6, "OTP must be exactly 6 digits")
});

exports.adminLoginInitSchema = z.object({
    email: z.string({ required_error: "Email is required" })
        .trim()
        .toLowerCase()
        .email("Invalid email format"),
    password: z.string({ required_error: "Password is required" })
        .min(1, "Password is required")
});

exports.adminLoginVerifySchema = z.object({
    email: z.string({ required_error: "Email is required" })
        .trim()
        .toLowerCase()
        .email("Invalid email format"),
    otp: z.string({ required_error: "OTP is required" })
        .trim()
        .length(6, "OTP must be exactly 6 digits"),
    challenge_id: z.string().trim().optional()
});

exports.adminForgotPasswordSchema = z.object({
    email: z.string({ required_error: "Email is required" })
        .trim()
        .toLowerCase()
        .email("Invalid email format")
});

exports.adminResetPasswordSchema = z.object({
    email: z.string({ required_error: "Email is required" })
        .trim()
        .toLowerCase()
        .email("Invalid email format"),
    otp: z.string({ required_error: "OTP is required" })
        .trim()
        .length(6, "OTP must be exactly 6 digits"),
    new_password: strongPassword
});

exports.updateAdminProfileSchema = z.object({
    full_name: z.string()
        .trim()
        .min(2, "Name must be at least 2 characters long")
        .max(50, "Name cannot exceed 50 characters")
        .regex(/^[a-zA-Z\s]+$/, "Name can only contain alphabets and spaces")
        .optional(),
    phone: z.string()
        .trim()
        .regex(/^[6-9]\d{9}$/, "Must be a valid 10-digit phone number")
        .optional()
        .nullable()
});

exports.adminChangePasswordSchema = z.object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: strongPassword,
    otp: z.string({ required_error: "OTP is required" })
        .trim()
        .length(6, "OTP must be exactly 6 digits")
});
