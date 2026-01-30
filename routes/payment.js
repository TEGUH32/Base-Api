const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const midtransService = require('../services/midtrans');
const database = require('../database');

// Get available pricing plans
router.get('/plans', async (req, res) => {
    try {
        const plans = await midtransService.getAvailablePlans();
        res.status(200).json(plans);
    } catch (error) {
        console.error('Get plans error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get pricing plans'
        });
    }
});

// Create payment transaction
router.post('/create', authenticateToken, [
    body('plan').isIn(['free', 'basic', 'pro', 'enterprise']).withMessage('Invalid plan'),
    body('orderId').optional()
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

        const { plan, orderId } = req.body;
        const userId = req.user.id;

        // Check if user is trying to upgrade to free plan (shouldn't happen, but handle it)
        if (plan === 'free') {
            return res.status(400).json({
                status: false,
                message: 'Free plan does not require payment'
            });
        }

        // Get current user plan
        const user = await database.findUserById(userId);
        const currentPlan = await database.getPlanByName(user.plan);

        // Get requested plan
        const requestedPlan = await database.getPlanByName(plan);

        // Check if downgrading
        if (currentPlan && currentPlan.price > requestedPlan.price) {
            return res.status(400).json({
                status: false,
                message: 'Cannot downgrade plan. Please contact support for assistance.'
            });
        }

        // Create payment transaction
        const payment = await midtransService.createPayment(userId, plan, orderId);

        res.status(200).json(payment);
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to create payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Midtrans notification handler (webhook)
router.post('/notification', async (req, res) => {
    try {
        const notification = req.body;
        
        // Verify the notification
        await midtransService.verifyPaymentNotification(notification);

        res.status(200).json({
            status: true,
            message: 'Notification processed successfully'
        });
    } catch (error) {
        console.error('Payment notification error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to process notification'
        });
    }
});

// Check transaction status
router.get('/status/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;

        const status = await midtransService.checkTransactionStatus(orderId);

        res.status(200).json(status);
    } catch (error) {
        console.error('Check transaction status error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to check transaction status'
        });
    }
});

// Get user's transaction history
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = parseInt(req.query.limit) || 20;

        const transactions = await database.getUserTransactions(userId, limit);

        res.status(200).json({
            status: true,
            data: transactions.map(tx => ({
                id: tx.id,
                transaction_id: tx.transaction_id,
                order_id: tx.order_id,
                gross_amount: tx.gross_amount,
                status: tx.status,
                plan: tx.plan,
                payment_type: tx.payment_type,
                payment_date: tx.payment_date,
                created_at: tx.created_at
            }))
        });
    } catch (error) {
        console.error('Get transaction history error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to get transaction history'
        });
    }
});

// Cancel transaction
router.post('/cancel/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        // Verify that the transaction belongs to the user
        const transaction = await new Promise((resolve, reject) => {
            database.db.get(
                'SELECT * FROM transactions WHERE order_id = ? AND user_id = ?',
                [orderId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!transaction) {
            return res.status(404).json({
                status: false,
                message: 'Transaction not found'
            });
        }

        if (transaction.status !== 'pending') {
            return res.status(400).json({
                status: false,
                message: 'Cannot cancel transaction. Status is not pending.'
            });
        }

        await midtransService.cancelTransaction(orderId);

        res.status(200).json({
            status: true,
            message: 'Transaction cancelled successfully'
        });
    } catch (error) {
        console.error('Cancel transaction error:', error);
        res.status(500).json({
            status: false,
            message: 'Failed to cancel transaction'
        });
    }
});

module.exports = router;