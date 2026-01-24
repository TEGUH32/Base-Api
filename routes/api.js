require('../config')

const express = require('express')
const router = express.Router()
const os = require('os')
const axios = require('axios')

// Helper function untuk format response
const formatResponse = (status, message, data = null) => {
    return {
        status: status,
        creator: global.creator,
        message: message,
        data: data,
        timestamp: new Date().toISOString()
    }
}

// Helper function untuk error response
const errorResponse = (res, message, statusCode = 500) => {
    return res.status(statusCode).json({
        status: false,
        creator: global.creator,
        message: message,
        timestamp: new Date().toISOString()
    })
}

// Helper function untuk success response
const successResponse = (res, message, data = null) => {
    return res.status(200).json({
        status: true,
        creator: global.creator,
        message: message,
        data: data,
        timestamp: new Date().toISOString()
    })
}

// API Status Endpoint
router.get('/status', (req, res) => {
    try {
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const memoryUsagePercent = ((usedMemory / totalMemory) * 100).toFixed(2);

        const statusData = {
            server: {
                platform: os.platform(),
                arch: os.arch(),
                uptime: os.uptime(),
                hostname: os.hostname(),
                cpus: os.cpus().length
            },
            memory: {
                total: totalMemory,
                free: freeMemory,
                used: usedMemory,
                usage_percent: parseFloat(memoryUsagePercent)
            },
            network: {
                interfaces: os.networkInterfaces()
            },
            load: os.loadavg()
        }

        return successResponse(res, 'Server is running normally', statusData)
    } catch (error) {
        console.error('Status endpoint error:', error)
        return errorResponse(res, 'Failed to get server status')
    }
})

// Ping Endpoint
router.get('/ping', (req, res) => {
    return successResponse(res, 'Pong! Server is responsive')
})

// Deepseek AI Endpoint
router.get('/deepseek', async (req, res) => {
    const q = req.query.q
    const model = req.query.model || 'deepseek-chat'

    if (!q || q.trim() === '') {
        return res.status(400).json({
            status: false,
            creator: global.creator,
            message: 'Query parameter "q" is required',
            timestamp: new Date().toISOString()
        })
    }

    try {
        const response = await axios.get(`https://api-rebix.vercel.app/api/deepseek-r1?q=${encodeURIComponent(q)}`, {
            timeout: 30000
        })

        if (response.status === 200) {
            return successResponse(res, 'Deepseek API response successful', {
                model: response.data.model || model,
                response: response.data.response,
                processing_time: response.data.processing_time || 'unknown',
                source: 'external-api'
            })
        } else {
            return errorResponse(res, 'Deepseek API returned an error', response.status)
        }
    } catch (error) {
        console.error('Deepseek API error:', error.message)
        
        // Fallback response jika API external down
        const fallbackResponses = [
            "I'm currently experiencing high load. Please try again in a moment.",
            "I'm here to help! What would you like to know?",
            "Hello! I'm your AI assistant. How can I help you today?"
        ]
        
        return successResponse(res, 'Deepseek API fallback response', {
            model: 'deepseek-fallback',
            response: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
            processing_time: '0ms',
            source: 'fallback',
            note: 'External API may be experiencing issues'
        })
    }
})

// Microsoft Copilot AI Endpoint
router.get('/copilot', async (req, res) => {
    const text = req.query.text
    const model = req.query.model || 'copilot-default'

    if (!text || text.trim() === '') {
        return res.status(400).json({
            status: false,
            creator: global.creator,
            message: 'Query parameter "text" is required',
            timestamp: new Date().toISOString()
        })
    }

    try {
        // Call external Copilot API
        const response = await axios.get(`https://api.yupra.my.id/api/ai/copilot?text=${encodeURIComponent(text)}`, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })

        if (response.status === 200) {
            const data = response.data
            
            return res.status(200).json({
                status: true,
                creator: global.creator,
                message: 'Copilot AI response successful',
                model: data.model || model,
                result: data.result,
                citations: data.citations || [],
                processing_time: data.processing_time || 'unknown',
                timestamp: new Date().toISOString(),
                source: 'microsoft-copilot'
            })
        } else {
            return errorResponse(res, 'Copilot API returned an error', response.status)
        }
    } catch (error) {
        console.error('Copilot API error:', error.message)
        
        // Fallback response untuk Copilot
        const fallbackResponses = [
            "Hello! I'm Copilot, your AI assistant. How can I help you today?",
            "Hey there! I'm here to assist with any questions you might have.",
            "Hi! I'm Copilot, ready to help you with information and creative tasks."
        ]
        
        return res.status(200).json({
            status: true,
            creator: global.creator,
            message: 'Copilot API fallback response',
            model: 'copilot-fallback',
            result: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
            citations: [],
            processing_time: '0ms',
            timestamp: new Date().toISOString(),
            source: 'fallback',
            note: 'External API may be experiencing issues'
        })
    }
})

// GPT-5 AI Endpoint
router.get('/gpt5', async (req, res) => {
    const text = req.query.text
    const model = req.query.model || 'gpt-5-smart'

    if (!text || text.trim() === '') {
        return res.status(400).json({
            status: false,
            creator: global.creator,
            message: 'Query parameter "text" is required',
            timestamp: new Date().toISOString()
        })
    }

    try {
        // Call external GPT-5 API
        const response = await axios.get(`https://api.yupra.my.id/api/ai/gpt5?text=${encodeURIComponent(text)}`, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })

        if (response.status === 200) {
            const data = response.data
            
            return res.status(200).json({
                status: true,
                creator: global.creator,
                message: 'GPT-5 AI response successful',
                model: data.model || model,
                result: data.result,
                citations: data.citations || [],
                processing_time: data.processing_time || 'unknown',
                timestamp: new Date().toISOString(),
                source: 'openai-gpt5'
            })
        } else {
            return errorResponse(res, 'GPT-5 API returned an error', response.status)
        }
    } catch (error) {
        console.error('GPT-5 API error:', error.message)
        
        // Fallback response untuk GPT-5
        const fallbackResponses = [
            "Hello! I'm GPT-5, the latest AI model. How can I assist you today?",
            "Hi there! I'm here to help with your questions. What would you like to know?",
            "Greetings! As GPT-5, I can help with various topics. Ask me anything!"
        ]
        
        return res.status(200).json({
            status: true,
            creator: global.creator,
            message: 'GPT-5 API fallback response',
            model: 'gpt-5-fallback',
            result: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
            citations: [],
            processing_time: '0ms',
            timestamp: new Date().toISOString(),
            source: 'fallback',
            note: 'External API may be experiencing issues'
        })
    }
})

// Instagram Downloader Endpoint
router.get('/instagram', async (req, res) => {
    const url = req.query.url

    if (!url || url.trim() === '') {
        return res.status(400).json({
            status: false,
            creator: global.creator,
            message: 'Query parameter "url" is required',
            timestamp: new Date().toISOString(),
            example: '/api/instagram?url=https://www.instagram.com/p/Cxample123/'
        })
    }

    // Validasi URL Instagram
    if (!url.includes('instagram.com')) {
        return res.status(400).json({
            status: false,
            creator: global.creator,
            message: 'URL must be a valid Instagram link',
            timestamp: new Date().toISOString(),
            supported_formats: [
                'https://www.instagram.com/p/',
                'https://www.instagram.com/reel/',
                'https://www.instagram.com/tv/'
            ]
        })
    }

    try {
        const startTime = Date.now();
        // Call external Instagram API
        const response = await axios.get(`https://api.vreden.my.id/api/v1/download/instagram?url=${encodeURIComponent(url)}`, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Referer': 'https://www.instagram.com/'
            }
        })

        if (response.status === 200) {
            const data = response.data
            const processingTime = Date.now() - startTime;
            
            return res.status(200).json({
                status: true,
                status_code: 200,
                creator: global.creator,
                message: 'Instagram data fetched successfully',
                processing_time: `${processingTime}ms`,
                timestamp: new Date().toISOString(),
                result: data.result || data,
                metadata: {
                    url_provided: url,
                    content_type: data.result?.data?.[0]?.type || 'unknown',
                    has_video: data.result?.data?.some(item => item.type === 'video') || false,
                    has_image: data.result?.data?.some(item => item.type === 'image') || false,
                    total_media: data.result?.data?.length || 0
                }
            })
        } else {
            return errorResponse(res, 'Instagram API returned an error', response.status)
        }
    } catch (error) {
        console.error('Instagram API error:', error.message)
        
        // Fallback response untuk Instagram
        return res.status(200).json({
            status: false,
            status_code: 500,
            creator: global.creator,
            message: 'Failed to fetch Instagram data',
            timestamp: new Date().toISOString(),
            error: error.message,
            note: 'Instagram API may be experiencing issues or the URL is invalid',
            supported_urls: [
                'Instagram Posts: https://www.instagram.com/p/ABC123/',
                'Instagram Reels: https://www.instagram.com/reel/ABC123/',
                'Instagram TV: https://www.instagram.com/tv/ABC123/'
            ]
        })
    }
})

// Facebook Downloader Endpoint (BARU)
router.get('/facebook', async (req, res) => {
    const url = req.query.url

    if (!url || url.trim() === '') {
        return res.status(400).json({
            status: false,
            status_code: 400,
            creator: global.creator,
            message: 'Query parameter "url" is required',
            timestamp: new Date().toISOString(),
            example: '/api/facebook?url=https://www.facebook.com/share/r/16sXMhKi6e/'
        })
    }

    // Validasi URL Facebook
    if (!url.includes('facebook.com') && !url.includes('fb.watch') && !url.includes('fb.com')) {
        return res.status(400).json({
            status: false,
            status_code: 400,
            creator: global.creator,
            message: 'URL must be a valid Facebook link',
            timestamp: new Date().toISOString(),
            supported_formats: [
                'https://www.facebook.com/share/r/',
                'https://www.facebook.com/video.php?v=',
                'https://www.facebook.com/watch/?v=',
                'https://fb.watch/',
                'https://m.facebook.com/'
            ]
        })
    }

    try {
        const startTime = Date.now();
        
        // Call external Facebook API
        const response = await axios.get(`https://api.vreden.my.id/api/v1/download/facebook?url=${encodeURIComponent(url)}`, {
            timeout: 45000, // Timeout lebih lama untuk video besar
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.facebook.com/',
                'Origin': 'https://www.facebook.com',
                'DNT': '1'
            },
            validateStatus: (status) => status < 500 // Accept all status codes less than 500
        })

        const processingTime = Date.now() - startTime;
        
        if (response.status === 200) {
            const data = response.data
            
            // Format response sesuai dengan struktur yang diberikan
            return res.status(200).json({
                status: data.status || true,
                status_code: data.status_code || 200,
                creator: data.creator || global.creator,
                processing_time: `${processingTime}ms`,
                timestamp: new Date().toISOString(),
                result: {
                    title: data.result?.title || 'Facebook Video',
                    thumbnail: data.result?.thumbnail || null,
                    durasi: data.result?.durasi || '0:00',
                    download: data.result?.download || {
                        hd: null,
                        sd: null,
                        audio: null
                    },
                    metadata: {
                        url_provided: url,
                        has_hd: !!data.result?.download?.hd,
                        has_sd: !!data.result?.download?.sd,
                        duration_formatted: data.result?.durasi || 'unknown',
                        video_type: data.result?.title?.includes('Video') ? 'video' : 'post'
                    }
                }
            })
        } else {
            // Jika API external mengembalikan error
            return res.status(response.status).json({
                status: false,
                status_code: response.status,
                creator: global.creator,
                message: 'Facebook API returned an error',
                processing_time: `${processingTime}ms`,
                timestamp: new Date().toISOString(),
                error: response.data?.message || 'Unknown error from external API',
                original_response: response.data
            })
        }
    } catch (error) {
        console.error('Facebook API error:', error.message)
        
        // Fallback response untuk Facebook dengan data dummy
        return res.status(200).json({
            status: false,
            status_code: 500,
            creator: global.creator,
            message: 'Failed to fetch Facebook data',
            processing_time: '0ms',
            timestamp: new Date().toISOString(),
            error: error.message,
            note: 'Facebook API may be experiencing issues or the URL is invalid/private',
            fallback_data: {
                title: 'Facebook Video (Demo)',
                thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Facebook_f_logo_%282019%29.svg/1200px-Facebook_f_logo_%282019%29.svg.png',
                durasi: '1:30',
                download: {
                    hd: 'https://example.com/video-hd.mp4',
                    sd: 'https://example.com/video-sd.mp4'
                }
            },
            supported_urls: [
                'Facebook Video: https://www.facebook.com/share/r/VIDEO_ID/',
                'Facebook Watch: https://www.facebook.com/watch/?v=VIDEO_ID',
                'Facebook Reel: https://www.facebook.com/reel/REEL_ID',
                'Facebook Post: https://www.facebook.com/PROFILE/posts/POST_ID'
            ],
            troubleshooting: [
                'Ensure the video is public (not private)',
                'Try using the full URL of the video',
                'Check if the video is still available',
                'Use a direct video link if possible'
            ]
        })
    }
})

// Advanced AI Chat Endpoint - Multiple Models
router.get('/ai/chat', async (req, res) => {
    const { text, model = 'auto' } = req.query

    if (!text || text.trim() === '') {
        return errorResponse(res, 'Query parameter "text" is required', 400)
    }

    try {
        let aiResponse
        let selectedModel = model

        // Pilih model berdasarkan parameter atau secara otomatis
        if (model === 'auto' || model === 'copilot') {
            selectedModel = 'copilot'
            const response = await axios.get(`https://api.yupra.my.id/api/ai/copilot?text=${encodeURIComponent(text)}`, {
                timeout: 20000
            })
            aiResponse = response.data
        } else if (model === 'deepseek') {
            selectedModel = 'deepseek'
            const response = await axios.get(`https://api-rebix.vercel.app/api/deepseek-r1?q=${encodeURIComponent(text)}`, {
                timeout: 20000
            })
            aiResponse = response.data
        } else if (model === 'gpt5') {
            selectedModel = 'gpt5'
            const response = await axios.get(`https://api.yupra.my.id/api/ai/gpt5?text=${encodeURIComponent(text)}`, {
                timeout: 20000
            })
            aiResponse = response.data
        } else {
            return errorResponse(res, `Model '${model}' is not supported. Available: auto, copilot, deepseek, gpt5`, 400)
        }

        return successResponse(res, `${selectedModel} AI response successful`, {
            model: selectedModel,
            query: text,
            response: aiResponse.result || aiResponse.response || 'No response from AI',
            source: selectedModel,
            details: aiResponse
        })
    } catch (error) {
        console.error('AI Chat endpoint error:', error.message)
        return errorResponse(res, 'Failed to get AI response. Please try again.')
    }
})

// Social Media Tools Endpoint
router.get('/social/media', async (req, res) => {
    const { url, platform = 'auto' } = req.query

    if (!url || url.trim() === '') {
        return errorResponse(res, 'Query parameter "url" is required', 400)
    }

    try {
        let result
        let detectedPlatform = platform

        // Auto-detect platform dari URL
        if (platform === 'auto') {
            if (url.includes('instagram.com')) {
                detectedPlatform = 'instagram'
            } else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
                detectedPlatform = 'facebook'
            } else if (url.includes('tiktok.com')) {
                detectedPlatform = 'tiktok'
            } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
                detectedPlatform = 'youtube'
            } else if (url.includes('twitter.com') || url.includes('x.com')) {
                detectedPlatform = 'twitter'
            } else {
                detectedPlatform = 'unknown'
            }
        }

        if (detectedPlatform === 'instagram') {
            const response = await axios.get(`https://api.vreden.my.id/api/v1/download/instagram?url=${encodeURIComponent(url)}`, {
                timeout: 30000
            })
            result = response.data
        } else if (detectedPlatform === 'facebook') {
            const response = await axios.get(`https://api.vreden.my.id/api/v1/download/facebook?url=${encodeURIComponent(url)}`, {
                timeout: 45000
            })
            result = response.data
        } else {
            return errorResponse(res, `Platform '${detectedPlatform}' is not supported yet. Currently only Instagram and Facebook are supported.`, 400)
        }

        return successResponse(res, `${detectedPlatform} data fetched successfully`, {
            platform: detectedPlatform,
            url: url,
            result: result.result || result,
            supported_features: ['download', 'metadata', 'statistics']
        })
    } catch (error) {
        console.error('Social Media endpoint error:', error.message)
        return errorResponse(res, 'Failed to fetch social media data')
    }
})

// Video Downloader Endpoint (Unified - BARU)
router.get('/video/download', async (req, res) => {
    const { url, quality = 'best', platform = 'auto' } = req.query

    if (!url || url.trim() === '') {
        return errorResponse(res, 'Query parameter "url" is required', 400)
    }

    try {
        let result
        let detectedPlatform = platform

        // Auto-detect platform dari URL
        if (platform === 'auto') {
            if (url.includes('instagram.com')) {
                detectedPlatform = 'instagram'
            } else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
                detectedPlatform = 'facebook'
            } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
                detectedPlatform = 'youtube'
            } else {
                detectedPlatform = 'unknown'
            }
        }

        const startTime = Date.now();
        
        if (detectedPlatform === 'instagram') {
            const response = await axios.get(`https://api.vreden.my.id/api/v1/download/instagram?url=${encodeURIComponent(url)}`, {
                timeout: 30000
            })
            result = response.data
        } else if (detectedPlatform === 'facebook') {
            const response = await axios.get(`https://api.vreden.my.id/api/v1/download/facebook?url=${encodeURIComponent(url)}`, {
                timeout: 45000
            })
            result = response.data
        } else {
            return errorResponse(res, `Platform '${detectedPlatform}' is not supported. Currently only Instagram and Facebook are supported.`, 400)
        }

        const processingTime = Date.now() - startTime;
        
        // Format response yang konsisten
        return res.status(200).json({
            status: true,
            status_code: 200,
            creator: global.creator,
            message: `${detectedPlatform} video data fetched successfully`,
            processing_time: `${processingTime}ms`,
            timestamp: new Date().toISOString(),
            platform: detectedPlatform,
            url: url,
            quality_requested: quality,
            result: result.result || result,
            download_options: {
                available_qualities: detectedPlatform === 'facebook' ? ['hd', 'sd'] : ['best', 'high', 'medium', 'low'],
                recommended: detectedPlatform === 'facebook' ? 'hd' : 'best',
                note: quality === 'best' ? 'Automatically selects the best available quality' : `Requested: ${quality}`
            }
        })
    } catch (error) {
        console.error('Video Download endpoint error:', error.message)
        return errorResponse(res, `Failed to fetch video data from ${platform}`)
    }
})

// Health Check Endpoint
router.get('/health', (req, res) => {
    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        endpoints: {
            total: 10,
            available: [
                '/api/status',
                '/api/ping',
                '/api/deepseek',
                '/api/copilot',
                '/api/gpt5',
                '/api/instagram',
                '/api/facebook',
                '/api/social/media',
                '/api/video/download',
                '/api/ai/chat'
            ]
        },
        rate_limit: {
            window: '1 minute',
            max_requests: 2000
        }
    }

    return res.status(200).json(healthData)
})

// API Information Endpoint
router.get('/info', (req, res) => {
    const apiInfo = {
        name: 'API Teguh - Advanced REST API Server',
        version: '3.2.0',
        creator: global.creator,
        description: 'Multi-model AI API server with social media and video download tools',
        endpoints: {
            status: {
                path: '/api/status',
                method: 'GET',
                description: 'Get server status and system information',
                parameters: 'none'
            },
            ping: {
                path: '/api/ping',
                method: 'GET',
                description: 'Simple health check endpoint',
                parameters: 'none'
            },
            deepseek: {
                path: '/api/deepseek',
                method: 'GET',
                description: 'Deepseek AI chat endpoint',
                parameters: 'q (required) - Your question'
            },
            copilot: {
                path: '/api/copilot',
                method: 'GET',
                description: 'Microsoft Copilot AI endpoint',
                parameters: 'text (required) - Your message'
            },
            gpt5: {
                path: '/api/gpt5',
                method: 'GET',
                description: 'GPT-5 AI endpoint',
                parameters: 'text (required) - Your message'
            },
            instagram: {
                path: '/api/instagram',
                method: 'GET',
                description: 'Instagram downloader and metadata',
                parameters: 'url (required) - Instagram post/reel URL'
            },
            facebook: {
                path: '/api/facebook',
                method: 'GET',
                description: 'Facebook video downloader',
                parameters: 'url (required) - Facebook video URL'
            },
            social_media: {
                path: '/api/social/media',
                method: 'GET',
                description: 'Social media tools (Instagram & Facebook support)',
                parameters: 'url (required), platform (optional: auto, instagram, facebook)'
            },
            video_download: {
                path: '/api/video/download',
                method: 'GET',
                description: 'Unified video downloader for multiple platforms',
                parameters: 'url (required), quality (optional: best, hd, sd), platform (optional: auto, instagram, facebook)'
            },
            ai_chat: {
                path: '/api/ai/chat',
                method: 'GET',
                description: 'Multi-model AI chat endpoint',
                parameters: 'text (required), model (optional: auto, copilot, deepseek, gpt5)'
            }
        },
        features: [
            'AI Chat with multiple models (Deepseek, Copilot, GPT-5)',
            'Instagram video/photo downloader',
            'Facebook video downloader',
            'Social media metadata extraction',
            'Unified video download endpoint',
            'Server monitoring',
            'Rate limiting'
        ],
        rate_limiting: '2000 requests per minute per IP',
        documentation: 'Visit / on your browser for full documentation',
        video_support: {
            facebook: {
                formats: ['HD (720p+)', 'SD (360p+)'],
                max_duration: 'No limit',
                requirements: 'Public videos only'
            },
            instagram: {
                formats: ['Best available', 'Multiple qualities'],
                content_types: ['Reels', 'Posts', 'Stories', 'IGTV'],
                requirements: 'Public/Private (if logged in via API)'
            }
        }
    }

    return successResponse(res, 'API information retrieved successfully', apiInfo)
})

// Catch-all for undefined API routes
router.all('*', (req, res) => {
    return res.status(404).json({
        status: false,
        creator: global.creator,
        message: `API endpoint ${req.method} ${req.originalUrl} not found`,
        available_endpoints: [
            'GET /api/status',
            'GET /api/ping',
            'GET /api/deepseek?q=your_question',
            'GET /api/copilot?text=your_message',
            'GET /api/gpt5?text=your_message',
            'GET /api/instagram?url=instagram_url',
            'GET /api/facebook?url=facebook_url',
            'GET /api/social/media?url=social_media_url&platform=auto',
            'GET /api/video/download?url=video_url&quality=best',
            'GET /api/ai/chat?text=message&model=auto',
            'GET /api/health',
            'GET /api/info'
        ],
        timestamp: new Date().toISOString()
    })
})

module.exports = router
