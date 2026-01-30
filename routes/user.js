const express = require('express');
const router = express.Router();
const database = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get user dashboard overview
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get user information
        const user = await database.findUserById(userId);
        
        // Get user's API keys
        const apiKeys = await database.getUserApiKeys(userId);
        const activeApiKey = apiKeys.find(key => key.is_active);
        
        // Get usage statistics
        const usageStats = await database.getUserUsageStats(userId, 7);
        
        // Get recent transactions
        const transactions = await database.getUserTransactions(userId, 5);
        
        // Calculate total usage
        const totalRequestsToday = apiKeys.reduce((sum, key) => sum + key.requests_today, 0);
        const totalLimit = apiKeys.reduce((sum, key) => sum + key.daily_limit, 0);
        
        res.status(200).json({
            status: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    plan: user.plan,
                    isVerified: user.is_verified,
                    createdAt: user.created_at
                },
                api_keys: {
                    total: apiKeys.length,
                    active: apiKeys.filter(key => key.is_active).length,
                    primary_key: activeApiKey ? {
                        id: activeApiKey.id,
                        name: activeApiKey.name,
                        key_value: activeApiKey.key_value.substring(0, 12) + '...',
                        daily_limit: activeApiKey.daily_limit,
                        requests_today: activeApiKey.requests_today,
                        requests_remaining: activeApiKey.daily_limit - activeApiKey.requests_today
                    } : null
                },
                usage: {
                    today: {
                        requests: totalRequestsToday,
                        limit: totalLimit,
                        remaining: totalLimit - totalRequestsToday,
                        percentage: totalLimit > 0 ? Math.round((totalRequestsToday / totalLimit) * 100) : 0
                    },
                    last_7_days: usageStats.map(stat => ({
                        date: stat.date,
                        requests: stat.total_requests,
                        avg_response_time: Math.round(stat.avg_response_time || 0),
                        error_count: stat.error_count
                    }))
                },
                recent_transactions: transactions.map(tx => ({
                    id: tx.id,
                    transaction_id: tx.transaction_id,
                    order_id: tx.order_id,
                    gross_amount: tx.gross_amount,
                    status: tx.status,
                    plan: tx.plan,
                    created_at: tx.created_at
                }))
            }
        });
    } catch (error) {
        console.error('Get dashboard error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get dashboard data'
        });
    }
});

// Get usage statistics
router.get('/usage', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const days = parseInt(req.query.days) || 7;
        
        const stats = await database.getUserUsageStats(userId, days);
        
        // Get user's API keys for daily limits
        const apiKeys = await database.getUserApiKeys(userId);
        const totalLimit = apiKeys.reduce((sum, key) => sum + key.daily_limit, 0);
        
        res.status(200).json({
            status: true,
            data: {
                period: {
                    days,
                    start_date: stats[stats.length - 1]?.date || null,
                    end_date: stats[0]?.date || null
                },
                daily_limit: totalLimit,
                statistics: stats.map(stat => ({
                    date: stat.date,
                    requests: stat.total_requests,
                    avg_response_time: Math.round(stat.avg_response_time || 0),
                    error_count: stat.error_count,
                    success_rate: stat.total_requests > 0 
                        ? Math.round(((stat.total_requests - stat.error_count) / stat.total_requests) * 100) 
                        : 100
                }))
            }
        });
    } catch (error) {
        console.error('Get usage error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get usage statistics'
        });
    }
});

// Update user settings
router.put('/settings', authenticateToken, async (req, res) => {
    try {
        const { notifications, emailAlerts } = req.body;
        const userId = req.user.id;

        // For now, we'll just return success as settings would be stored in a separate table
        // You can extend this to actually store settings in the database
        
        res.status(200).json({
            status: true,
            message: 'Settings updated successfully',
            data: {
                notifications: notifications !== undefined ? notifications : true,
                emailAlerts: emailAlerts !== undefined ? emailAlerts : true
            }
        });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to update settings'
        });
    }
});

// Delete user account
router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { confirmation } = req.body;

        if (confirmation !== 'DELETE_MY_ACCOUNT') {
            return res.status(400).json({
                status: false,
                message: 'Invalid confirmation. Please type "DELETE_MY_ACCOUNT" to confirm.'
            });
        }

        // Soft delete by deactivating the user
        await new Promise((resolve, reject) => {
            database.db.run(
                'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        // Deactivate all API keys
        await new Promise((resolve, reject) => {
            database.db.run(
                'UPDATE api_keys SET is_active = 0 WHERE user_id = ?',
                [userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

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

module.exports = router;