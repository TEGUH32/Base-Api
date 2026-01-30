const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const database = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Generate JWT token
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            plan: user.plan || 'free'
        },
        process.env.JWT_SECRET || 'your-jwt-secret-key-change-this-in-production',
        { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );
};

// Generate API Key
const generateApiKey = () => {
    const crypto = require('crypto');
    const randomPart = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now().toString(36);
    return `sk-${randomPart}-${timestamp}`;
};

// Generate session ID
const generateSessionId = () => {
    return 'sess_' + require('crypto').randomBytes(32).toString('hex');
};

// Register new user (NO EMAIL VERIFICATION)
router.post('/register', [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('full_name').optional().trim()
], async (req, res) => {
    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                status: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { email, password, full_name } = req.body;

        // Check if user already exists
        const existingUser = await database.findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                status: false,
                message: 'Email already registered. Please login or use a different email.'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        const now = new Date().toISOString();

        // Create new user
        const user = {
            id: userId,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            full_name: full_name || email.split('@')[0],
            plan: 'free',
            is_verified: 1,
            is_active: 1,
            created_at: now,
            updated_at: now
        };

        // Save user to database
        const savedUser = await database.createUser(user);

        // Generate API key
        const apiKeyValue = generateApiKey();
        const apiKeyId = uuidv4();
        
        // Create default API key for new user
        const apiKey = {
            id: apiKeyId,
            user_id: userId,
            key_value: apiKeyValue,
            name: 'Default API Key',
            daily_limit: 100,
            requests_today: 0,
            is_active: 1,
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
            created_at: now
        };

        await database.createApiKey(apiKey);

        // Generate JWT token
        const token = generateToken(savedUser);

        // Create session
        const sessionId = generateSessionId();
        await database.createSession({
            id: sessionId,
            user_id: userId,
            ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.get('user-agent') || 'Unknown',
            created_at: now
        });

        res.status(201).json({
            status: true,
            message: 'Registration successful! Welcome to API Teguh.',
            data: {
                user: {
                    id: savedUser.id,
                    email: savedUser.email,
                    full_name: savedUser.full_name,
                    plan: savedUser.plan,
                    is_verified: savedUser.is_verified === 1,
                    is_active: savedUser.is_active === 1,
                    created_at: savedUser.created_at
                },
                token,
                session_id: sessionId,
                api_key: apiKeyValue,
                api_key_info: {
                    name: apiKey.name,
                    daily_limit: apiKey.daily_limit,
                    expires_at: apiKey.expires_at
                }
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            status: false,
            message: 'Registration failed. Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Login
router.post('/login', [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
], async (req, res) => {
    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                status: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { email, password } = req.body;

        // Find user
        const user = await database.findUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                status: false,
                message: 'Invalid email or password'
            });
        }

        // Check if user is active
        if (user.is_active !== 1) {
            return res.status(401).json({
                status: false,
                message: 'Account is deactivated. Please contact support.'
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                status: false,
                message: 'Invalid email or password'
            });
        }

        // Generate JWT token
        const token = generateToken(user);

        // Create session
        const sessionId = generateSessionId();
        await database.createSession({
            id: sessionId,
            user_id: user.id,
            ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            user_agent: req.get('user-agent') || 'Unknown',
            created_at: new Date().toISOString()
        });

        // Get user's API keys
        const apiKeys = await database.getUserApiKeys(user.id);
        const primaryApiKey = apiKeys.find(key => key.is_active === 1) || apiKeys[0];

        res.status(200).json({
            status: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: user.full_name,
                    plan: user.plan,
                    is_verified: user.is_verified === 1,
                    is_active: user.is_active === 1,
                    created_at: user.created_at
                },
                token,
                session_id: sessionId,
                api_key: primaryApiKey?.key_value || null,
                api_key_info: primaryApiKey ? {
                    id: primaryApiKey.id,
                    name: primaryApiKey.name,
                    daily_limit: primaryApiKey.daily_limit,
                    requests_today: primaryApiKey.requests_today || 0,
                    expires_at: primaryApiKey.expires_at
                } : null
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            status: false,
            message: 'Login failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'] || req.body.session_id;
        
        if (sessionId) {
            await database.deleteSession(sessionId);
        }

        // Also cleanup expired sessions
        await database.cleanupExpiredSessions();

        res.status(200).json({
            status: true,
            message: 'Logout successful'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            status: false,
            message: 'Logout failed'
        });
    }
});

// Get current user info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        // Get fresh user data from database
        const freshUser = await database.findUserById(user.id);
        if (!freshUser) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        // Get user's API keys
        const apiKeys = await database.getUserApiKeys(user.id);
        const primaryApiKey = apiKeys.find(key => key.is_active === 1) || apiKeys[0];
        
        // Get user's usage stats for today
        const usageStats = await database.getUserUsageStats(user.id, 1);
        const todayUsage = usageStats[0] || { total_requests: 0 };

        res.status(200).json({
            status: true,
            data: {
                user: {
                    id: freshUser.id,
                    email: freshUser.email,
                    full_name: freshUser.full_name,
                    plan: freshUser.plan,
                    is_verified: freshUser.is_verified === 1,
                    is_active: freshUser.is_active === 1,
                    created_at: freshUser.created_at
                },
                api_key: primaryApiKey ? {
                    key: primaryApiKey.key_value,
                    name: primaryApiKey.name,
                    daily_limit: primaryApiKey.daily_limit,
                    requests_today: primaryApiKey.requests_today || 0,
                    expires_at: primaryApiKey.expires_at
                } : null,
                usage: {
                    today: {
                        total_requests: todayUsage.total_requests || 0,
                        limit: primaryApiKey?.daily_limit || 100
                    }
                }
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get user info'
        });
    }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        // Get fresh user data
        const freshUser = await database.findUserById(user.id);
        if (!freshUser) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        const newToken = generateToken(freshUser);

        res.status(200).json({
            status: true,
            data: {
                token: newToken
            }
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to refresh token'
        });
    }
});

// Update user profile
router.put('/profile', authenticateToken, [
    body('full_name').optional().trim().isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
    body('current_password').optional(),
    body('new_password').optional().isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                status: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { full_name, current_password, new_password } = req.body;
        const userId = req.user.id;

        // Get current user with password
        const user = await database.findUserById(userId);
        if (!user) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        const updateData = {
            updated_at: new Date().toISOString()
        };

        // Update full name
        if (full_name) {
            updateData.full_name = full_name;
        }

        // Update password if both current and new passwords are provided
        if (current_password && new_password) {
            // Verify current password
            const isPasswordValid = await bcrypt.compare(current_password, user.password);
            if (!isPasswordValid) {
                return res.status(400).json({
                    status: false,
                    message: 'Current password is incorrect'
                });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(new_password, 10);
            updateData.password = hashedPassword;
        }

        // Update user in database
        if (Object.keys(updateData).length > 0) {
            const updatedUser = await database.updateUser(userId, updateData);

            res.status(200).json({
                status: true,
                message: 'Profile updated successfully',
                data: {
                    user: {
                        id: updatedUser.id,
                        email: updatedUser.email,
                        full_name: updatedUser.full_name,
                        plan: updatedUser.plan,
                        is_verified: updatedUser.is_verified === 1
                    }
                }
            });
        } else {
            // No updates provided
            res.status(400).json({
                status: false,
                message: 'No updates provided'
            });
        }

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to update profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Check email availability
router.get('/check-email', async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({
                status: false,
                message: 'Email parameter is required'
            });
        }

        const user = await database.findUserByEmail(email.toLowerCase().trim());
        
        res.status(200).json({
            status: true,
            data: {
                email,
                available: !user,
                exists: !!user
            }
        });
    } catch (error) {
        console.error('Check email error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to check email availability'
        });
    }
});

// Request password reset
router.post('/forgot-password', [
    body('email').isEmail().withMessage('Valid email required')
], async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await database.findUserByEmail(email.toLowerCase().trim());
        
        // Don't reveal if user exists for security
        if (!user) {
            return res.status(200).json({
                status: true,
                message: 'If an account exists with this email, you will receive password reset instructions.'
            });
        }

        // Generate reset token
        const resetToken = require('crypto').randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour

        // Save reset token to database
        await database.saveResetToken(user.id, resetToken, resetTokenExpiry);

        // In production, send email here
        console.log(`Password reset token for ${email}: ${resetToken}`);

        res.status(200).json({
            status: true,
            message: 'If an account exists with this email, you will receive password reset instructions.'
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to process password reset request'
        });
    }
});

// Reset password
router.post('/reset-password', [
    body('token').notEmpty().withMessage('Reset token required'),
    body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
    try {
        const { token, new_password } = req.body;
        
        // Verify reset token
        const resetData = await database.verifyResetToken(token);
        if (!resetData) {
            return res.status(400).json({
                status: false,
                message: 'Invalid or expired reset token'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // Update password
        await database.updateUser(resetData.user_id, {
            password: hashedPassword,
            updated_at: new Date().toISOString()
        });

        // Invalidate used token
        await database.invalidateResetToken(token);

        res.status(200).json({
            status: true,
            message: 'Password has been reset successfully. Please login with your new password.'
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to reset password'
        });
    }
});

// Delete account
router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { confirm_text } = req.body;

        if (!confirm_text || confirm_text.toLowerCase() !== 'delete') {
            return res.status(400).json({
                status: false,
                message: 'Please type "DELETE" to confirm account deletion'
            });
        }

        // Verify password if provided
        if (req.body.password) {
            const user = await database.findUserById(userId);
            const isPasswordValid = await bcrypt.compare(req.body.password, user.password);
            if (!isPasswordValid) {
                return res.status(400).json({
                    status: false,
                    message: 'Invalid password'
                });
            }
        }

        // Delete user account
        const deleted = await database.deleteUser(userId);
        
        if (!deleted) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            status: true,
            message: 'Account deleted successfully'
        });

    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to delete account'
        });
    }
});

// Verify token (for checking if token is still valid)
router.get('/verify-token', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        
        // Get fresh user data
        const freshUser = await database.findUserById(user.id);
        if (!freshUser) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            status: true,
            data: {
                valid: true,
                user: {
                    id: freshUser.id,
                    email: freshUser.email,
                    full_name: freshUser.full_name,
                    plan: freshUser.plan,
                    is_verified: freshUser.is_verified === 1,
                    is_active: freshUser.is_active === 1
                }
            }
        });
    } catch (error) {
        console.error('Verify token error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to verify token'
        });
    }
});

module.exports = router;
