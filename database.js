const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

class Database {
    constructor() {
        const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('Connected to SQLite database');
                this.initializeTables();
            }
        });
    }

    initializeTables() {
        // Users table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                full_name TEXT,
                plan TEXT DEFAULT 'free',
                is_verified BOOLEAN DEFAULT 0,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // API Keys table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key_value TEXT UNIQUE NOT NULL,
                name TEXT,
                is_active BOOLEAN DEFAULT 1,
                daily_limit INTEGER DEFAULT 100,
                requests_today INTEGER DEFAULT 0,
                last_reset_date DATE DEFAULT CURRENT_DATE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Transactions table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                transaction_id TEXT UNIQUE NOT NULL,
                order_id TEXT,
                gross_amount REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                payment_type TEXT,
                plan TEXT,
                payment_date DATETIME,
                fraud_status TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Usage tracking table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS usage_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                api_key_id INTEGER NOT NULL,
                endpoint TEXT NOT NULL,
                status_code INTEGER,
                response_time INTEGER,
                ip_address TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
            )
        `);

        // Pricing plans table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS pricing_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                price INTEGER NOT NULL,
                daily_limit INTEGER NOT NULL,
                monthly_limit INTEGER NOT NULL,
                features TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, () => {
            this.insertDefaultPlans();
        });

        // Sessions table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        console.log('Database tables initialized');
    }

    insertDefaultPlans() {
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

        plans.forEach(plan => {
            this.db.run(
                `INSERT OR IGNORE INTO pricing_plans (name, price, daily_limit, monthly_limit, features) VALUES (?, ?, ?, ?, ?)`,
                [plan.name, plan.price, plan.daily_limit, plan.monthly_limit, plan.features]
            );
        });
    }

    // User methods
    async createUser(email, password, fullName) {
        const hashedPassword = await bcrypt.hash(password, 10);
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO users (email, password, full_name) VALUES (?, ?, ?)`,
                [email, hashedPassword, fullName],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, email, fullName });
                }
            );
        });
    }

    async findUserByEmail(email) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM users WHERE email = ?`,
                [email],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async findUserById(id) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM users WHERE id = ?`,
                [id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async updateUserPlan(userId, plan) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE users SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [plan, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // API Key methods
    async createApiKey(userId, name, expiresIn = 365) {
        const keyValue = 'api_' + require('crypto').randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresIn);

        const user = await this.findUserById(userId);
        const dailyLimit = this.getDailyLimitForPlan(user.plan);

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO api_keys (user_id, key_value, name, daily_limit, expires_at) VALUES (?, ?, ?, ?, ?)`,
                [userId, keyValue, name, dailyLimit, expiresAt.toISOString()],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, key_value: keyValue, name, expires_at: expiresAt });
                }
            );
        });
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
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM api_keys WHERE key_value = ? AND is_active = 1`,
                [keyValue],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async checkAndUpdateApiKeyUsage(apiKeyId) {
        return new Promise((resolve, reject) => {
            // Check if we need to reset the daily counter
            this.db.run(
                `UPDATE api_keys 
                 SET requests_today = CASE 
                     WHEN date(last_reset_date) < date('now') THEN 0 
                     ELSE requests_today 
                 END,
                 last_reset_date = CASE 
                     WHEN date(last_reset_date) < date('now') THEN date('now') 
                     ELSE last_reset_date 
                 END
                 WHERE id = ?`,
                [apiKeyId],
                (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Get the current usage and limit
                    this.db.get(
                        `SELECT requests_today, daily_limit FROM api_keys WHERE id = ?`,
                        [apiKeyId],
                        (err, row) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (!row) {
                                reject(new Error('API key not found'));
                                return;
                            }

                            const hasLimit = row.requests_today < row.daily_limit;

                            if (hasLimit) {
                                // Increment the counter
                                this.db.run(
                                    `UPDATE api_keys SET requests_today = requests_today + 1 WHERE id = ?`,
                                    [apiKeyId],
                                    (err) => {
                                        if (err) reject(err);
                                        else resolve({
                                            allowed: true,
                                            remaining: row.daily_limit - row.requests_today - 1,
                                            limit: row.daily_limit
                                        });
                                    }
                                );
                            } else {
                                resolve({
                                    allowed: false,
                                    remaining: 0,
                                    limit: row.daily_limit
                                });
                            }
                        }
                    );
                }
            );
        });
    }

    async getUserApiKeys(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT id, key_value, name, is_active, daily_limit, requests_today, last_reset_date, created_at, expires_at 
                 FROM api_keys 
                 WHERE user_id = ? 
                 ORDER BY created_at DESC`,
                [userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    async deleteApiKey(keyId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM api_keys WHERE id = ? AND user_id = ?`,
                [keyId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // Transaction methods
    async createTransaction(userId, transactionId, orderId, grossAmount, plan) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO transactions (user_id, transaction_id, order_id, gross_amount, plan) VALUES (?, ?, ?, ?, ?)`,
                [userId, transactionId, orderId, grossAmount, plan],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });
    }

    async updateTransactionStatus(transactionId, status, paymentData = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE transactions 
                 SET status = ?, payment_type = ?, payment_date = ?, fraud_status = ? 
                 WHERE transaction_id = ?`,
                [
                    status,
                    paymentData.payment_type || null,
                    paymentData.payment_date || null,
                    paymentData.fraud_status || null,
                    transactionId
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async getUserTransactions(userId, limit = 20) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM transactions 
                 WHERE user_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT ?`,
                [userId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    // Usage tracking
    async logUsage(userId, apiKeyId, endpoint, statusCode, responseTime, ipAddress) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO usage_logs (user_id, api_key_id, endpoint, status_code, response_time, ip_address) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, apiKeyId, endpoint, statusCode, responseTime, ipAddress],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    async getUserUsageStats(userId, days = 7) {
        return new Promise((resolve, reject) => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            this.db.all(
                `SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as total_requests,
                    AVG(response_time) as avg_response_time,
                    SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
                 FROM usage_logs 
                 WHERE user_id = ? AND created_at >= ?
                 GROUP BY DATE(created_at)
                 ORDER BY date DESC`,
                [userId, startDate.toISOString()],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    // Pricing plans
    async getActivePlans() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM pricing_plans WHERE is_active = 1 ORDER BY price ASC`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(row => ({
                        ...row,
                        features: JSON.parse(row.features)
                    })));
                }
            );
        });
    }

    async getPlanByName(planName) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM pricing_plans WHERE name = ?`,
                [planName],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? { ...row, features: JSON.parse(row.features) } : null);
                }
            );
        });
    }

    // Session management
    async createSession(sessionId, userId, ipAddress, userAgent, expiresIn = '7d') {
        const expiresAt = new Date();
        const expiresInSeconds = expiresIn === '7d' ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
        expiresAt.setSeconds(expiresAt.getSeconds() + expiresInSeconds);

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)`,
                [sessionId, userId, ipAddress, userAgent, expiresAt.toISOString()],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: sessionId, expires_at: expiresAt });
                }
            );
        });
    }

    async findSession(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`,
                [sessionId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async deleteSession(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM sessions WHERE id = ?`,
                [sessionId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async cleanupExpiredSessions() {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('Database connection closed');
            }
        });
    }
}

module.exports = new Database();