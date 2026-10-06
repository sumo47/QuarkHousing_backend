// src/modules/auth/auth.schema.js
const { z } = require('zod');

exports.registerSchema = z.object({
    full_name: z.string({ required_error: "Full name is required" })
        .trim() // Removes leading/trailing spaces
        .min(2, "Name must be at least 2 characters long")
        .max(50, "Name cannot exceed 50 characters")
        // Regex ensures only alphabets and spaces are allowed (no numbers or special characters in name)
        .regex(/^[a-zA-Z\s]+$/, "Name can only contain alphabets and spaces"),

    email: z.string({ required_error: "Email is required" })
        .trim()
        .toLowerCase() // Convert to lowercase before saving
        .email("Invalid email address format"),

    phone: z.string({ required_error: "Phone number is required" })
        .trim()
        // Regex for exactly 10 digits (Standard Indian format starting with 6-9)
        .regex(/^[6-9]\d{9}$/, "Must be a valid 10-digit phone number"),

    password: z.string({ required_error: "Password is required" })
        .min(8, "Password must be at least 8 characters")
        .max(32, "Password cannot exceed 32 characters")
        // Strong Password Regex Checks
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[0-9]/, "Password must contain at least one number")
        .regex(/[\W_]/, "Password must contain at least one special character (@, $, !, %, *, ?, &, etc.)"),

    role: z.enum(['STUDENT', 'OWNER', 'VENDOR', 'ADMIN'], {
        errorMap: () => ({ message: "Invalid role selected. Must be STUDENT, OWNER, VENDOR, or ADMIN" })
    }),

    // Optional: another user's referral code, used to link this signup to
    // them for the referral reward system. Silently ignored if invalid/unknown.
    referral_code: z.string().max(20).optional()
});

// Login Schema for consistency
exports.loginSchema = z.object({
    email: z.string().trim().toLowerCase().email("Invalid email format"),
    password: z.string().min(1, "Password is required") // No need for strict regex during login, just ensure it's provided
});

// src/modules/auth/auth.schema.js (Add these at the bottom)

exports.forgotPasswordSchema = z.object({
    email: z.string().trim().toLowerCase().email("Invalid email format")
});

exports.resetPasswordSchema = z.object({
    email: z.string().trim().toLowerCase().email("Invalid email format"),
    otp: z.string().length(6, "OTP must be exactly 6 digits"),
    new_password: z.string()
        .min(8, "Password must be at least 8 characters")
        .max(32, "Password cannot exceed 32 characters")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[0-9]/, "Password must contain at least one number")
        .regex(/[\W_]/, "Password must contain at least one special character")
});