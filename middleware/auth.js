const jwt = require('jsonwebtoken');
const database = require('../database');

// Authentication middleware (JWT Token)
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                status: false,
                message: 'Access token required',
                code: 'TOKEN_REQUIRED'
            });
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key-change-this-in-production');
        
        // Check if user exists and is active
        const user = await database.findUserById(decoded.id || decoded.userId);
        
        if (!user) {
            return res.status(401).json({
                status: false,
                message: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Check if user is active (as integer 1/0)
        if (user.is_active !== 1) {
            return res.status(401).json({
                status: false,
                message: 'Account is deactivated',
                code: 'ACCOUNT_DEACTIVATED'
            });
        }

        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            plan: user.plan,
            is_verified: user.is_verified === 1,
            is_active: user.is_active === 1
        };

        next();
    } catch (error) {
        console.error('JWT Authentication error:', error.message);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                status: false,
                message: 'Token has expired',
                code: 'TOKEN_EXPIRED'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({
                status: false,
                message: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }

        return res.status(500).json({
            status: false,
            message: 'Authentication failed',
            code: 'AUTH_FAILED'
        });
    }
};

// API Key authentication middleware
const authenticateApiKey = async (req, res, next) => {
    try {
        // Get API key from various sources
        const apiKey = req.headers['x-api-key'] || 
                      req.headers['authorization']?.replace('Bearer ', '') ||
                      req.query.api_key;

        if (!apiKey) {
            return res.status(401).json({
                status: false,
                message: 'API key required',
                code: 'API_KEY_MISSING',
                docs: 'Include your API key in the X-API-Key header'
            });
        }

        // Find API key in database
        const keyData = await database.findApiKeyByValue(apiKey);
        
        if (!keyData) {
            return res.status(401).json({
                status: false,
                message: 'Invalid API key',
                code: 'INVALID_API_KEY'
            });
        }

        // Check if API key is active
        if (keyData.is_active !== 1) {
            return res.status(401).json({
                status: false,
                message: 'API key is deactivated',
                code: 'API_KEY_DEACTIVATED'
            });
        }

        // Check if API key is expired
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            return res.status(401).json({
                status: false,
                message: 'API key has expired',
                code: 'API_KEY_EXPIRED',
                data: {
                    expires_at: keyData.expires_at
                }
            });
        }

        // Check if user is active
        if (keyData.user_active !== 1) {
            return res.status(401).json({
                status: false,
                message: 'User account is inactive',
                code: 'USER_INACTIVE'
            });
        }

        // Check and update API key usage
        const usageResult = await database.updateApiKeyUsage(keyData.id);
        
        if (!usageResult) {
            return res.status(500).json({
                status: false,
                message: 'Failed to check API usage',
                code: 'USAGE_CHECK_FAILED'
            });
        }

        // Check if daily limit exceeded
        const { requests_today, daily_limit } = usageResult;
        if (requests_today > daily_limit) {
            return res.status(429).json({
                status: false,
                message: 'Daily API limit exceeded',
                code: 'RATE_LIMIT_EXCEEDED',
                data: {
                    limit: daily_limit,
                    used: requests_today,
                    remaining: 0
                }
            });
        }

        // Get user information
        const user = await database.findUserById(keyData.user_id);
        if (!user) {
            return res.status(401).json({
                status: false,
                message: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Attach data to request
        req.apiKey = {
            id: keyData.id,
            key_value: keyData.key_value,
            name: keyData.name,
            daily_limit: keyData.daily_limit,
            user_id: keyData.user_id
        };

        req.user = {
            id: user.id,
            email: user.email,
            plan: user.plan
        };

        req.usage = {
            used: requests_today,
            limit: daily_limit,
            remaining: Math.max(0, daily_limit - requests_today)
        };

        // Log the API usage
        try {
            await database.logUsage({
                user_id: user.id,
                api_key_id: keyData.id,
                endpoint: req.path,
                status_code: null, // Will be updated in response
                response_time: null, // Will be updated in response
                ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress
            });
        } catch (logError) {
            console.error('Failed to log API usage:', logError);
            // Continue even if logging fails
        }

        next();
    } catch (error) {
        console.error('API Key authentication error:', error);

        // Handle specific database errors
        if (error.message && error.message.includes('connection')) {
            return res.status(503).json({
                status: false,
                message: 'Service temporarily unavailable',
                code: 'SERVICE_UNAVAILABLE'
            });
        }

        return res.status(500).json({
            status: false,
            message: 'Authentication failed',
            code: 'AUTH_FAILED',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Optional API key authentication (allows requests without API key)
const optionalApiKey = async (req, res, next) => {
    try {
        // Get API key from various sources
        const apiKey = req.headers['x-api-key'] || 
                      req.headers['authorization']?.replace('Bearer ', '') ||
                      req.query.api_key;

        if (apiKey) {
            // Try to authenticate with API key
            const keyData = await database.findApiKeyByValue(apiKey);
            
            if (keyData && keyData.is_active === 1) {
                // Check if API key is expired
                const isExpired = keyData.expires_at && new Date(keyData.expires_at) < new Date();
                
                if (!isExpired) {
                    // Check and update usage
                    const usageResult = await database.updateApiKeyUsage(keyData.id);
                    
                    if (usageResult && usageResult.requests_today <= keyData.daily_limit) {
                        // Get user information
                        const user = await database.findUserById(keyData.user_id);
                        
                        if (user && user.is_active === 1) {
                            req.apiKey = {
                                id: keyData.id,
                                key_value: keyData.key_value,
                                name: keyData.name
                            };

                            req.user = {
                                id: user.id,
                                email: user.email,
                                plan: user.plan
                            };

                            req.usage = {
                                used: usageResult.requests_today,
                                limit: keyData.daily_limit,
                                remaining: Math.max(0, keyData.daily_limit - usageResult.requests_today)
                            };

                            // Log the API usage
                            try {
                                await database.logUsage({
                                    user_id: user.id,
                                    api_key_id: keyData.id,
                                    endpoint: req.path,
                                    status_code: null,
                                    response_time: null,
                                    ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress
                                });
                            } catch (logError) {
                                console.error('Failed to log API usage:', logError);
                            }
                        }
                    }
                }
            }
        }

        next();
    } catch (error) {
        console.error('Optional API key authentication error:', error);
        next(); // Continue even if authentication fails
    }
};

// Rate limiting middleware
const rateLimiter = (limit = 60, windowMs = 60 * 1000) => {
    const requests = new Map();

    return async (req, res, next) => {
        const key = req.apiKey ? req.apiKey.id : req.ip;
        const now = Date.now();
        
        if (!requests.has(key)) {
            requests.set(key, []);
        }
        
        const windowStart = now - windowMs;
        const userRequests = requests.get(key).filter(time => time > windowStart);
        
        if (userRequests.length >= limit) {
            return res.status(429).json({
                status: false,
                message: 'Too many requests',
                code: 'RATE_LIMITED',
                data: {
                    limit: limit,
                    window: windowMs / 1000 + ' seconds'
                }
            });
        }
        
        userRequests.push(now);
        requests.set(key, userRequests);
        
        // Clean up old entries periodically
        if (Math.random() < 0.01) { // 1% chance to clean up
            for (const [k, reqs] of requests.entries()) {
                requests.set(k, reqs.filter(time => time > now - windowMs * 2));
            }
        }
        
        next();
    };
};

// Admin middleware
const isAdmin = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                status: false,
                message: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        // Check if user has admin plan
        if (req.user.plan === 'admin') {
            next();
        } else {
            res.status(403).json({
                status: false,
                message: 'Admin access required',
                code: 'ADMIN_REQUIRED'
            });
        }
    } catch (error) {
        console.error('Admin middleware error:', error);
        res.status(500).json({
            status: false,
            message: 'Authorization failed',
            code: 'AUTH_FAILED'
        });
    }
};

// Premium plan middleware
const requirePremiumPlan = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                status: false,
                message: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        const premiumPlans = ['basic', 'pro', 'enterprise', 'admin'];
        
        if (premiumPlans.includes(req.user.plan)) {
            next();
        } else {
            res.status(403).json({
                status: false,
                message: 'Premium plan required',
                code: 'PREMIUM_REQUIRED',
                data: {
                    current_plan: req.user.plan,
                    required_plans: premiumPlans.filter(p => p !== 'admin')
                }
            });
        }
    } catch (error) {
        console.error('Premium plan middleware error:', error);
        res.status(500).json({
            status: false,
            message: 'Authorization failed',
            code: 'AUTH_FAILED'
        });
    }
};

// Response time middleware
const responseTimeLogger = (req, res, next) => {
    const startTime = Date.now();
    
    // Store original send function
    const originalSend = res.send;
    
    res.send = function(body) {
        const responseTime = Date.now() - startTime;
        
        // Add response time header
        res.set('X-Response-Time', `${responseTime}ms`);
        
        // Update usage log if it exists
        if (req.apiKey && req.user) {
            try {
                // This would typically be done in a separate async process
                // to not block the response
                const statusCode = res.statusCode;
                
                // In production, you might want to queue this for async processing
                database.logUsage({
                    user_id: req.user.id,
                    api_key_id: req.apiKey.id,
                    endpoint: req.path,
                    status_code: statusCode,
                    response_time: responseTime,
                    ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress
                }).catch(err => console.error('Failed to update usage log:', err));
            } catch (error) {
                console.error('Error in response time logger:', error);
            }
        }
        
        // Call original send
        return originalSend.call(this, body);
    };
    
    next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
    console.error('Global error handler:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
    });

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            status: false,
            message: 'Invalid token',
            code: 'INVALID_TOKEN'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            status: false,
            message: 'Token expired',
            code: 'TOKEN_EXPIRED'
        });
    }

    // Validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            status: false,
            message: err.message,
            code: 'VALIDATION_ERROR'
        });
    }

    // Database errors
    if (err.code && err.code.startsWith('23')) { // PostgreSQL error codes 23xxx are constraint violations
        return res.status(400).json({
            status: false,
            message: 'Database constraint violation',
            code: 'DB_CONSTRAINT_ERROR',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }

    // Rate limit errors
    if (err.status === 429) {
        return res.status(429).json({
            status: false,
            message: err.message || 'Too many requests',
            code: 'RATE_LIMITED'
        });
    }

    // Default error
    res.status(err.status || 500).json({
        status: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message,
        code: 'INTERNAL_ERROR',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

// Not found middleware
const notFoundHandler = (req, res) => {
    res.status(404).json({
        status: false,
        message: 'Endpoint not found',
        code: 'NOT_FOUND',
        path: req.path
    });
};

module.exports = {
    authenticateToken,
    authenticateApiKey,
    optionalApiKey,
    rateLimiter,
    isAdmin,
    requirePremiumPlan,
    responseTimeLogger,
    errorHandler,
    notFoundHandler
};
