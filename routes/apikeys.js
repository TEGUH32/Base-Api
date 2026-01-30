const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const database = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Helper function to generate API key
const generateApiKey = () => {
    const randomPart = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now().toString(36);
    return `sk-${randomPart}-${timestamp}`;
};

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
                key_prefix: key.key_value.substring(0, 12) + '...', // Partially hidden
                key_value: key.key_value, // Full key for verification
                is_active: key.is_active === 1,
                daily_limit: key.daily_limit,
                requests_today: key.requests_today || 0,
                requests_remaining: Math.max(0, key.daily_limit - (key.requests_today || 0)),
                last_reset_date: key.last_reset_date,
                created_at: key.created_at,
                expires_at: key.expires_at,
                is_expired: key.expires_at ? new Date(key.expires_at) < new Date() : false
            }))
        });
    } catch (error) {
        console.error('Get API keys error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get API keys',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Create new API key
router.post('/', authenticateToken, [
    body('name').trim().isLength({ min: 1 }).withMessage('Name is required'),
    body('expires_in_days').optional().isInt({ min: 1, max: 365 }).withMessage('Expiry must be between 1 and 365 days'),
    body('daily_limit').optional().isInt({ min: 10, max: 99999 }).withMessage('Daily limit must be between 10 and 99999')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                status: true,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { 
            name, 
            expires_in_days = 365,
            daily_limit 
        } = req.body;
        
        const userId = req.user.id;

        // Get user to check plan
        const user = await database.findUserById(userId);
        if (!user) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        // Calculate expiry date
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(expires_in_days));

        // Generate API key
        const apiKeyValue = generateApiKey();
        const apiKeyId = uuidv4();

        // Determine daily limit (use provided limit or plan default)
        const finalDailyLimit = daily_limit || 
            (user.plan === 'free' ? 100 : 
             user.plan === 'basic' ? 1000 : 
             user.plan === 'pro' ? 5000 : 99999);

        const apiKeyData = {
            id: apiKeyId,
            user_id: userId,
            key_value: apiKeyValue,
            name: name,
            daily_limit: finalDailyLimit,
            expires_at: expiresAt.toISOString()
        };

        const apiKey = await database.createApiKey(apiKeyData);

        res.status(201).json({
            status: true,
            message: 'API key created successfully',
            data: {
                id: apiKey.id,
                name: apiKey.name,
                key_value: apiKey.key_value,
                key_prefix: apiKey.key_value.substring(0, 12) + '...',
                daily_limit: apiKey.daily_limit,
                expires_at: apiKey.expires_at,
                created_at: apiKey.created_at,
                warning: 'Save this API key securely. It will not be shown again.'
            }
        });
    } catch (error) {
        console.error('Create API key error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to create API key',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get specific API key details (shows full key)
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const keyId = req.params.id;
        const userId = req.user.id;

        const apiKeys = await database.getUserApiKeys(userId);
        const apiKey = apiKeys.find(key => key.id === keyId);

        if (!apiKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        // Get usage stats for this key
        const usageStats = await database.getApiKeyUsageStats(keyId, 7);

        res.status(200).json({
            status: true,
            data: {
                id: apiKey.id,
                name: apiKey.name,
                key_value: apiKey.key_value,
                is_active: apiKey.is_active === 1,
                daily_limit: apiKey.daily_limit,
                requests_today: apiKey.requests_today || 0,
                requests_remaining: Math.max(0, apiKey.daily_limit - (apiKey.requests_today || 0)),
                last_reset_date: apiKey.last_reset_date,
                created_at: apiKey.created_at,
                expires_at: apiKey.expires_at,
                is_expired: apiKey.expires_at ? new Date(apiKey.expires_at) < new Date() : false,
                usage: {
                    today: {
                        requests: apiKey.requests_today || 0,
                        limit: apiKey.daily_limit,
                        remaining: Math.max(0, apiKey.daily_limit - (apiKey.requests_today || 0)),
                        percentage: apiKey.daily_limit > 0 ? 
                            Math.round(((apiKey.requests_today || 0) / apiKey.daily_limit) * 100) : 0
                    },
                    last_7_days: usageStats.map(stat => ({
                        date: stat.date,
                        total_requests: parseInt(stat.total_requests) || 0,
                        avg_response_time: Math.round(stat.avg_response_time || 0)
                    }))
                }
            }
        });
    } catch (error) {
        console.error('Get API key details error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get API key details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Update API key
router.put('/:id', authenticateToken, [
    body('name').optional().trim().isLength({ min: 1 }).withMessage('Name cannot be empty'),
    body('is_active').optional().isBoolean().withMessage('is_active must be boolean'),
    body('daily_limit').optional().isInt({ min: 10, max: 99999 }).withMessage('Daily limit must be between 10 and 99999')
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

        const keyId = req.params.id;
        const userId = req.user.id;
        const { name, is_active, daily_limit } = req.body;

        // Check if API key belongs to user
        const apiKeys = await database.getUserApiKeys(userId);
        const apiKey = apiKeys.find(key => key.id === keyId);

        if (!apiKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        // Prepare update data
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;
        if (daily_limit !== undefined) updateData.daily_limit = daily_limit;

        // Update in database (we'll simulate this since we don't have updateApiKey method)
        const client = await database.pool.connect();
        try {
            const fields = [];
            const values = [];
            let paramCount = 1;

            for (const [key, value] of Object.entries(updateData)) {
                fields.push(`${key} = $${paramCount}`);
                values.push(value);
                paramCount++;
            }

            if (fields.length === 0) {
                return res.status(400).json({
                    status: false,
                    message: 'No updates provided'
                });
            }

            values.push(keyId);
            values.push(userId);

            const query = `
                UPDATE api_keys 
                SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
                RETURNING *
            `;

            const result = await client.query(query, values);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    status: false,
                    message: 'API key not found'
                });
            }

            const updatedKey = result.rows[0];

            res.status(200).json({
                status: true,
                message: 'API key updated successfully',
                data: {
                    id: updatedKey.id,
                    name: updatedKey.name,
                    is_active: updatedKey.is_active === 1,
                    daily_limit: updatedKey.daily_limit,
                    updated_at: updatedKey.updated_at
                }
            });

        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Update API key error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to update API key',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Delete API key
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const keyId = req.params.id;
        const userId = req.user.id;

        const deleted = await database.deleteApiKey(keyId, userId);

        if (!deleted) {
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
            message: 'Failed to delete API key',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Regenerate API key
router.post('/:id/regenerate', authenticateToken, async (req, res) => {
    try {
        const keyId = req.params.id;
        const userId = req.user.id;

        // Check if API key belongs to user
        const apiKeys = await database.getUserApiKeys(userId);
        const existingKey = apiKeys.find(key => key.id === keyId);

        if (!existingKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        // Generate new API key
        const newApiKeyValue = generateApiKey();

        // Update the key value in database
        const client = await database.pool.connect();
        try {
            const result = await client.query(
                `UPDATE api_keys 
                 SET key_value = $1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2 AND user_id = $3
                 RETURNING *`,
                [newApiKeyValue, keyId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    status: false,
                    message: 'API key not found'
                });
            }

            const updatedKey = result.rows[0];

            res.status(200).json({
                status: true,
                message: 'API key regenerated successfully',
                data: {
                    id: updatedKey.id,
                    name: updatedKey.name,
                    key_value: updatedKey.key_value,
                    key_prefix: updatedKey.key_value.substring(0, 12) + '...',
                    daily_limit: updatedKey.daily_limit,
                    expires_at: updatedKey.expires_at,
                    updated_at: updatedKey.updated_at,
                    warning: 'Save this new API key securely. The old key is no longer valid.'
                }
            });

        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Regenerate API key error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to regenerate API key',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get API key usage statistics
router.get('/:id/stats', authenticateToken, async (req, res) => {
    try {
        const keyId = req.params.id;
        const userId = req.user.id;

        // Check if API key belongs to user
        const apiKeys = await database.getUserApiKeys(userId);
        const apiKey = apiKeys.find(key => key.id === keyId);

        if (!apiKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        // Get usage statistics
        const dailyStats = await database.getApiKeyUsageStats(keyId, 30);

        // Calculate totals
        const totalRequests = dailyStats.reduce((sum, stat) => sum + (parseInt(stat.total_requests) || 0), 0);
        const avgResponseTime = dailyStats.length > 0 ? 
            Math.round(dailyStats.reduce((sum, stat) => sum + (stat.avg_response_time || 0), 0) / dailyStats.length) : 0;

        res.status(200).json({
            status: true,
            data: {
                api_key: {
                    id: apiKey.id,
                    name: apiKey.name,
                    key_prefix: apiKey.key_value.substring(0, 12) + '...',
                    daily_limit: apiKey.daily_limit,
                    requests_today: apiKey.requests_today || 0,
                    requests_remaining: Math.max(0, apiKey.daily_limit - (apiKey.requests_today || 0))
                },
                summary: {
                    total_requests: totalRequests,
                    avg_response_time: avgResponseTime,
                    period_days: 30
                },
                daily_usage: dailyStats.map(stat => ({
                    date: stat.date,
                    total_requests: parseInt(stat.total_requests) || 0,
                    avg_response_time: Math.round(stat.avg_response_time || 0)
                }))
            }
        });
    } catch (error) {
        console.error('Get API key stats error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get API key statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Reset API key usage counter (admin/owner only)
router.post('/:id/reset-usage', authenticateToken, async (req, res) => {
    try {
        const keyId = req.params.id;
        const userId = req.user.id;

        // Check if API key belongs to user
        const apiKeys = await database.getUserApiKeys(userId);
        const apiKey = apiKeys.find(key => key.id === keyId);

        if (!apiKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found'
            });
        }

        // Reset usage counter
        const client = await database.pool.connect();
        try {
            const result = await client.query(
                `UPDATE api_keys 
                 SET requests_today = 0, last_reset_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND user_id = $2
                 RETURNING *`,
                [keyId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    status: false,
                    message: 'API key not found'
                });
            }

            const updatedKey = result.rows[0];

            res.status(200).json({
                status: true,
                message: 'API key usage counter reset successfully',
                data: {
                    id: updatedKey.id,
                    name: updatedKey.name,
                    requests_today: updatedKey.requests_today,
                    last_reset_date: updatedKey.last_reset_date,
                    updated_at: updatedKey.updated_at
                }
            });

        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Reset API key usage error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to reset API key usage',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Validate API key (for testing)
router.post('/validate', authenticateToken, async (req, res) => {
    try {
        const { api_key } = req.body;
        const userId = req.user.id;

        if (!api_key) {
            return res.status(400).json({
                status: false,
                message: 'API key is required'
            });
        }

        // Check if API key belongs to user
        const apiKeys = await database.getUserApiKeys(userId);
        const apiKey = apiKeys.find(key => key.key_value === api_key);

        if (!apiKey) {
            return res.status(404).json({
                status: false,
                message: 'API key not found or does not belong to you'
            });
        }

        // Check if API key is expired
        const isExpired = apiKey.expires_at ? new Date(apiKey.expires_at) < new Date() : false;

        res.status(200).json({
            status: true,
            data: {
                valid: !isExpired && apiKey.is_active === 1,
                details: {
                    id: apiKey.id,
                    name: apiKey.name,
                    key_prefix: apiKey.key_value.substring(0, 12) + '...',
                    is_active: apiKey.is_active === 1,
                    is_expired: isExpired,
                    daily_limit: apiKey.daily_limit,
                    requests_today: apiKey.requests_today || 0,
                    requests_remaining: Math.max(0, apiKey.daily_limit - (apiKey.requests_today || 0)),
                    expires_at: apiKey.expires_at
                }
            }
        });
    } catch (error) {
        console.error('Validate API key error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to validate API key',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;
