const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

class Database {
    constructor() {
        const connectionString = process.env.DATABASE_URL || process.env.NEON_URL;
        
        if (!connectionString) {
            throw new Error('DATABASE_URL environment variable is required');
        }

        this.pool = new Pool({
            connectionString: connectionString,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        this.pool.on('connect', () => {
            console.log('Connected to PostgreSQL database');
        });

        this.pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
        });

        // Initialize database
        this.initializeTables();
    }

    async initializeTables() {
        try {
            // Enable UUID extension
            await this.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
            
            // Users table
            await this.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    plan VARCHAR(50) DEFAULT 'free',
                    is_verified BOOLEAN DEFAULT false,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // API Keys table
            await this.query(`
                CREATE TABLE IF NOT EXISTS api_keys (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    key_value VARCHAR(255) UNIQUE NOT NULL,
                    name VARCHAR(255),
                    is_active BOOLEAN DEFAULT true,
                    daily_limit INTEGER DEFAULT 100,
                    requests_today INTEGER DEFAULT 0,
                    last_reset_date DATE DEFAULT CURRENT_DATE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP WITH TIME ZONE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            // Transactions table
            await this.query(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    transaction_id VARCHAR(255) UNIQUE NOT NULL,
                    order_id VARCHAR(255),
                    gross_amount DECIMAL(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    payment_type VARCHAR(100),
                    plan VARCHAR(50),
                    payment_date TIMESTAMP WITH TIME ZONE,
                    fraud_status VARCHAR(50),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            // Usage tracking table
            await this.query(`
                CREATE TABLE IF NOT EXISTS usage_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    api_key_id INTEGER NOT NULL,
                    endpoint VARCHAR(255) NOT NULL,
                    status_code INTEGER,
                    response_time INTEGER,
                    ip_address VARCHAR(45),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
                )
            `);

            // Pricing plans table
            await this.query(`
                CREATE TABLE IF NOT EXISTS pricing_plans (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    price INTEGER NOT NULL,
                    daily_limit INTEGER NOT NULL,
                    monthly_limit INTEGER NOT NULL,
                    features TEXT,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Sessions table
            await this.query(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id VARCHAR(255) PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    ip_address VARCHAR(45),
                    user_agent TEXT,
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            await this.insertDefaultPlans();
            console.log('Database tables initialized successfully');
        } catch (error) {
            console.error('Error initializing database tables:', error);
        }
    }

    async insertDefaultPlans() {
        try {
            const plans = [
                {
                    name: 'free',
                    price: 0,
                    daily_limit: 100,
                    monthly_limit: 3000,
                    features: JSON.stringify(['100 requests/day', 'Basic support', 'Rate limiting'])
                },
                {
                    name: 'basic',
                    price: 49000,
                    daily_limit: 1000,
                    monthly_limit: 30000,
                    features: JSON.stringify(['1000 requests/day', 'Priority support', 'Faster response', 'Rate limiting'])
                },
                {
                    name: 'pro',
                    price: 99000,
                    daily_limit: 5000,
                    monthly_limit: 150000,
                    features: JSON.stringify(['5000 requests/day', '24/7 support', 'Fastest response', 'Advanced analytics', 'Rate limiting'])
                },
                {
                    name: 'enterprise',
                    price: 249000,
                    daily_limit: 99999,
                    monthly_limit: 999999,
                    features: JSON.stringify(['Unlimited requests', 'Dedicated support', 'Custom integration', 'Advanced analytics', 'Priority queue', 'Rate limiting'])
                }
            ];

            for (const plan of plans) {
                await this.query(
                    `INSERT INTO pricing_plans (name, price, daily_limit, monthly_limit, features) 
                     VALUES ($1, $2, $3, $4, $5) 
                     ON CONFLICT (name) DO NOTHING`,
                    [plan.name, plan.price, plan.daily_limit, plan.monthly_limit, plan.features]
                );
            }
        } catch (error) {
            console.error('Error inserting default plans:', error);
        }
    }

    async query(text, params) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // User methods
    async createUser(email, password, fullName) {
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const result = await this.query(
                `INSERT INTO users (email, password, full_name) 
                 VALUES ($1, $2, $3) 
                 RETURNING id, email, full_name, created_at`,
                [email, hashedPassword, fullName]
            );
            return {
                id: result.rows[0].id,
                email: result.rows[0].email,
                fullName: result.rows[0].full_name,
                createdAt: result.rows[0].created_at
            };
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }

    async findUserByEmail(email) {
        try {
            const result = await this.query(
                `SELECT * FROM users WHERE email = $1`,
                [email]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error finding user by email:', error);
            throw error;
        }
    }

    async findUserById(id) {
        try {
            const result = await this.query(
                `SELECT * FROM users WHERE id = $1`,
                [id]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error finding user by id:', error);
            throw error;
        }
    }

    async updateUserPlan(userId, plan) {
        try {
            const result = await this.query(
                `UPDATE users 
                 SET plan = $1, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $2 
                 RETURNING *`,
                [plan, userId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error updating user plan:', error);
            throw error;
        }
    }

    // API Key methods
    async createApiKey(userId, name, expiresIn = 365) {
        try {
            const keyValue = 'api_' + require('crypto').randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + expiresIn);

            const user = await this.findUserById(userId);
            const dailyLimit = this.getDailyLimitForPlan(user.plan);

            const result = await this.query(
                `INSERT INTO api_keys (user_id, key_value, name, daily_limit, expires_at) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING *`,
                [userId, keyValue, name, dailyLimit, expiresAt.toISOString()]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error creating API key:', error);
            throw error;
        }
    }

    getDailyLimitForPlan(plan) {
        const limits = {
            'free': 100,
            'basic': 1000,
            'pro': 5000,
            'enterprise': 99999
        };
        return limits[plan] || 100;
    }

    async findApiKey(keyValue) {
        try {
            const result = await this.query(
                `SELECT * FROM api_keys 
                 WHERE key_value = $1 AND is_active = true`,
                [keyValue]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error finding API key:', error);
            throw error;
        }
    }

    async checkAndUpdateApiKeyUsage(apiKeyId) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Check if we need to reset the daily counter
            await client.query(
                `UPDATE api_keys 
                 SET requests_today = CASE 
                     WHEN last_reset_date < CURRENT_DATE THEN 0 
                     ELSE requests_today 
                 END,
                 last_reset_date = CASE 
                     WHEN last_reset_date < CURRENT_DATE THEN CURRENT_DATE 
                     ELSE last_reset_date 
                 END
                 WHERE id = $1`,
                [apiKeyId]
            );

            // Get the current usage and limit
            const usageResult = await client.query(
                `SELECT requests_today, daily_limit FROM api_keys WHERE id = $1`,
                [apiKeyId]
            );

            if (usageResult.rows.length === 0) {
                throw new Error('API key not found');
            }

            const row = usageResult.rows[0];
            const hasLimit = row.requests_today < row.daily_limit;

            if (hasLimit) {
                // Increment the counter
                await client.query(
                    `UPDATE api_keys SET requests_today = requests_today + 1 WHERE id = $1`,
                    [apiKeyId]
                );

                await client.query('COMMIT');
                return {
                    allowed: true,
                    remaining: row.daily_limit - row.requests_today - 1,
                    limit: row.daily_limit
                };
            } else {
                await client.query('COMMIT');
                return {
                    allowed: false,
                    remaining: 0,
                    limit: row.daily_limit
                };
            }
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error checking API key usage:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async getUserApiKeys(userId) {
        try {
            const result = await this.query(
                `SELECT id, key_value, name, is_active, daily_limit, 
                        requests_today, last_reset_date, created_at, expires_at 
                 FROM api_keys 
                 WHERE user_id = $1 
                 ORDER BY created_at DESC`,
                [userId]
            );
            return result.rows;
        } catch (error) {
            console.error('Error getting user API keys:', error);
            throw error;
        }
    }

    async deleteApiKey(keyId, userId) {
        try {
            const result = await this.query(
                `DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id`,
                [keyId, userId]
            );
            return result.rowCount;
        } catch (error) {
            console.error('Error deleting API key:', error);
            throw error;
        }
    }

    // Transaction methods
    async createTransaction(userId, transactionId, orderId, grossAmount, plan) {
        try {
            const result = await this.query(
                `INSERT INTO transactions (user_id, transaction_id, order_id, gross_amount, plan) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING id`,
                [userId, transactionId, orderId, grossAmount, plan]
            );
            return { id: result.rows[0].id };
        } catch (error) {
            console.error('Error creating transaction:', error);
            throw error;
        }
    }

    async updateTransactionStatus(transactionId, status, paymentData = {}) {
        try {
            const result = await this.query(
                `UPDATE transactions 
                 SET status = $1, 
                     payment_type = $2, 
                     payment_date = $3, 
                     fraud_status = $4 
                 WHERE transaction_id = $5 
                 RETURNING *`,
                [
                    status,
                    paymentData.payment_type || null,
                    paymentData.payment_date || null,
                    paymentData.fraud_status || null,
                    transactionId
                ]
            );
            return result.rowCount;
        } catch (error) {
            console.error('Error updating transaction status:', error);
            throw error;
        }
    }

    async getUserTransactions(userId, limit = 20) {
        try {
            const result = await this.query(
                `SELECT * FROM transactions 
                 WHERE user_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT $2`,
                [userId, limit]
            );
            return result.rows;
        } catch (error) {
            console.error('Error getting user transactions:', error);
            throw error;
        }
    }

    // Usage tracking
    async logUsage(userId, apiKeyId, endpoint, statusCode, responseTime, ipAddress) {
        try {
            const result = await this.query(
                `INSERT INTO usage_logs (user_id, api_key_id, endpoint, status_code, response_time, ip_address) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 RETURNING id`,
                [userId, apiKeyId, endpoint, statusCode, responseTime, ipAddress]
            );
            return result.rows[0].id;
        } catch (error) {
            console.error('Error logging usage:', error);
            throw error;
        }
    }

    async getUserUsageStats(userId, days = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const result = await this.query(
                `SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as total_requests,
                    AVG(response_time) as avg_response_time,
                    SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
                 FROM usage_logs 
                 WHERE user_id = $1 AND created_at >= $2
                 GROUP BY DATE(created_at)
                 ORDER BY date DESC`,
                [userId, startDate.toISOString()]
            );
            return result.rows;
        } catch (error) {
            console.error('Error getting user usage stats:', error);
            throw error;
        }
    }

    // Pricing plans
    async getActivePlans() {
        try {
            const result = await this.query(
                `SELECT * FROM pricing_plans 
                 WHERE is_active = true 
                 ORDER BY price ASC`
            );
            return result.rows.map(row => ({
                ...row,
                features: row.features ? JSON.parse(row.features) : []
            }));
        } catch (error) {
            console.error('Error getting active plans:', error);
            throw error;
        }
    }

    async getPlanByName(planName) {
        try {
            const result = await this.query(
                `SELECT * FROM pricing_plans WHERE name = $1`,
                [planName]
            );
            if (result.rows[0]) {
                return {
                    ...result.rows[0],
                    features: result.rows[0].features ? JSON.parse(result.rows[0].features) : []
                };
            }
            return null;
        } catch (error) {
            console.error('Error getting plan by name:', error);
            throw error;
        }
    }

    // Session management
    async createSession(sessionId, userId, ipAddress, userAgent, expiresIn = '7d') {
        try {
            const expiresAt = new Date();
            const expiresInSeconds = expiresIn === '7d' ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
            expiresAt.setSeconds(expiresAt.getSeconds() + expiresInSeconds);

            const result = await this.query(
                `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING *`,
                [sessionId, userId, ipAddress, userAgent, expiresAt.toISOString()]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error creating session:', error);
            throw error;
        }
    }

    async findSession(sessionId) {
        try {
            const result = await this.query(
                `SELECT * FROM sessions 
                 WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP`,
                [sessionId]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Error finding session:', error);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            const result = await this.query(
                `DELETE FROM sessions WHERE id = $1 RETURNING id`,
                [sessionId]
            );
            return result.rowCount;
        } catch (error) {
            console.error('Error deleting session:', error);
            throw error;
        }
    }

    async cleanupExpiredSessions() {
        try {
            const result = await this.query(
                `DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP RETURNING id`
            );
            return result.rowCount;
        } catch (error) {
            console.error('Error cleaning up expired sessions:', error);
            throw error;
        }
    }

    async close() {
        try {
            await this.pool.end();
            console.log('Database connection pool closed');
        } catch (error) {
            console.error('Error closing database connection pool:', error);
        }
    }
}

module.exports = new Database();
