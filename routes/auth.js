const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const database = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Generate JWT token
const generateToken = (userId) => {
    return jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

// Register new user
router.post('/register', [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('fullName').optional().trim()
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

        const { email, password, fullName } = req.body;

        // Check if user already exists
        const existingUser = await database.findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                status: false,
                message: 'User with this email already exists'
            });
        }

        // Create new user
        const user = await database.createUser(email, password, fullName || email.split('@')[0]);

        // Generate JWT token
        const token = generateToken(user.id);

        // Create session
        const sessionId = 'sess_' + require('crypto').randomBytes(32).toString('hex');
        await database.createSession(
            sessionId,
            user.id,
            req.ip,
            req.get('user-agent')
        );

        // Create default API key for new user
        const apiKey = await database.createApiKey(user.id, 'Default API Key');

        res.status(201).json({
            status: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    plan: 'free'
                },
                token,
                session_id: sessionId,
                api_key: apiKey.key_value,
                daily_limit: apiKey.daily_limit
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            status: false,
            message: 'Registration failed',
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
        if (!user.is_active) {
            return res.status(401).json({
                status: false,
                message: 'Account is inactive'
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
        const token = generateToken(user.id);

        // Create session
        const sessionId = 'sess_' + require('crypto').randomBytes(32).toString('hex');
        await database.createSession(
            sessionId,
            user.id,
            req.ip,
            req.get('user-agent')
        );

        // Get user's API keys
        const apiKeys = await database.getUserApiKeys(user.id);
        const activeApiKey = apiKeys.find(key => key.is_active);

        res.status(200).json({
            status: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    plan: user.plan,
                    isVerified: user.is_verified
                },
                token,
                session_id: sessionId,
                api_key: activeApiKey?.key_value || null,
                daily_limit: activeApiKey?.daily_limit || 100
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
        const sessionId = req.headers['x-session-id'];
        
        if (sessionId) {
            await database.deleteSession(sessionId);
        }

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
        
        res.status(200).json({
            status: true,
            data: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                plan: user.plan,
                isVerified: user.is_verified,
                isActive: user.is_active,
                createdAt: user.created_at
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
        const newToken = generateToken(req.user.id);

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
    body('fullName').optional().trim().isLength({ min: 2 }),
    body('currentPassword').optional(),
    body('newPassword').optional().isLength({ min: 6 })
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

        const { fullName, currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        // Update full name
        if (fullName) {
            await new Promise((resolve, reject) => {
                database.db.run(
                    'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [fullName, userId],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.changes);
                    }
                );
            });
        }

        // Update password
        if (currentPassword && newPassword) {
            const user = await database.findUserById(userId);
            const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
            
            if (!isPasswordValid) {
                return res.status(400).json({
                    status: false,
                    message: 'Current password is incorrect'
                });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await new Promise((resolve, reject) => {
                database.db.run(
                    'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [hashedPassword, userId],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.changes);
                    }
                );
            });
        }

        // Get updated user
        const updatedUser = await database.findUserById(userId);

        res.status(200).json({
            status: true,
            message: 'Profile updated successfully',
            data: {
                id: updatedUser.id,
                email: updatedUser.email,
                fullName: updatedUser.full_name,
                plan: updatedUser.plan
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to update profile'
        });
    }
});

module.exports = router;