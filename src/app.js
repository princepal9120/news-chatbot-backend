
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

// Routes
app.use('/api', routes);

// Error handling middleware
app.use((error, req, res, next) => {
    logger.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

async function startServer() {
    try {
        // Initialize database connections
        const { initializeConnections } = require('./config/db');
        await initializeConnections();

        // Initialize vector DB
        const NewsIngestionService = require('./services/NewsIngestionService');
        const newsService = new NewsIngestionService();
        await newsService.initializeVectorDB();

        // Start server
        app.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.info('Available endpoints:');
            logger.info('POST /api/session - Create new session');
            logger.info('POST /api/chat/query - Process user query');
            logger.info('GET /api/session/:id - Get session history');
            logger.info('POST /api/session/reset - Reset session');
            logger.info('POST /api/admin/ingest - Trigger news ingestion');
            logger.info('GET /api/health - Health check');
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        throw error;
    }
}

module.exports = { app, startServer };
