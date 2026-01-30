const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const database = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get all API keys for authenticated user
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const apiKeys = await database.getUserApiKeys(userId);

        res.status(200).json({
            status: true,
            data: apiKeys.map(key => ({
                id: key.id,
                name: key.name,
                key_value: key.key_value.substring(0, 12) + '...', // Partially hidden
                full_key: key.key_value,
                is_active: key.is_active,
                daily_limit: key.daily_limit,
                requests_today: key.requests_today,
                requests_remaining: key.daily_limit - key.requests_today,
                last_reset_date: key.last_reset_date,
                created_at: key.created_at,
                expires_at: key.expires_at
            }))
        });
    } catch (error) {
        console.error('Get API keys error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get API keys'
        });
    }
});

// Create new API key
router.post('/', authenticateToken, [
    body('name').trim().isLength({ min: 1 }).withMessage('Name is required'),
    body('expiresIn').optional().isInt({ min: 1, max: 365 })
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

        const { name, expiresIn = 365 } = req.body;
        const userId = req.user.id;

        const apiKey = await database.createApiKey(userId, name, expiresIn);

        res.status(201).json({
            status: true,
            message: 'API key created successfully',
            data: {
                id: apiKey.id,
                name: apiKey.name,
                key_value: apiKey.key_value,
                daily_limit: apiKey.daily_limit,
                expires_at: apiKey.expires_at,
                created_at: new Date()
            }
        });
    } catch (error) {
        console.error('Create API key error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to create API key'
        });
    }
});

// Delete API key
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        const userId = req.user.id;

        const deleted = await database.deleteApiKey(keyId, userId);

        if (deleted === 0) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        res.status(200).json({
            status: true,
            message: 'API key deleted successfully'
        });
    } catch (error) {
        console.error('Delete API key error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to delete API key'
        });
    }
});

// Regenerate API key
router.post('/:id/regenerate', authenticateToken, async (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        const userId = req.user.id;

        // Get the existing API key
        const existingKey = await new Promise((resolve, reject) => {
            database.db.get(
                'SELECT * FROM api_keys WHERE id = ? AND user_id = ?',
                [keyId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!existingKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        // Delete the old key
        await database.deleteApiKey(keyId, userId);

        // Create a new key
        const newApiKey = await database.createApiKey(
            userId,
            existingKey.name,
            existingKey.expires_at ? Math.ceil((new Date(existingKey.expires_at) - new Date()) / (1000 * 60 * 60 * 24)) : 365
        );

        res.status(200).json({
            status: true,
            message: 'API key regenerated successfully',
            data: {
                id: newApiKey.id,
                name: newApiKey.name,
                key_value: newApiKey.key_value,
                daily_limit: newApiKey.daily_limit,
                expires_at: newApiKey.expires_at
            }
        });
    } catch (error) {
        console.error('Regenerate API key error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to regenerate API key'
        });
    }
});

// Get API key usage statistics
router.get('/:id/stats', authenticateToken, async (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        const userId = req.user.id;

        const apiKey = await new Promise((resolve, reject) => {
            database.db.get(
                'SELECT * FROM api_keys WHERE id = ? AND user_id = ?',
                [keyId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!apiKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        // Get usage statistics for the last 7 days
        const stats = await database.getUserUsageStats(userId, 7);

        // Calculate current day's usage
        const today = new Date().toISOString().split('T')[0];
        const todayUsage = stats.find(s => s.date === today);

        res.status(200).json({
            status: true,
            data: {
                api_key: {
                    id: apiKey.id,
                    name: apiKey.name,
                    daily_limit: apiKey.daily_limit
                },
                usage: {
                    today: {
                        requests: apiKey.requests_today,
                        limit: apiKey.daily_limit,
                        remaining: apiKey.daily_limit - apiKey.requests_today,
                        percentage: Math.round((apiKey.requests_today / apiKey.daily_limit) * 100)
                    },
                    last_7_days: stats.map(s => ({
                        date: s.date,
                        requests: s.total_requests,
                        avg_response_time: Math.round(s.avg_response_time || 0),
                        error_count: s.error_count
                    }))
                }
            }
        });
    } catch (error) {
        console.error('Get API key stats error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get API key statistics'
        });
    }
});

module.exports = router;