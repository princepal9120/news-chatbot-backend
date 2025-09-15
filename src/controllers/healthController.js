const { redis, pool } = require('../config/db');
const qdrantClient = require('../config/qdrant');
const logger = require('../utils/logger');

const healthCheck = async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {}
    };

    // Check Redis
    try {
      await redis.ping();
      health.services.redis = 'healthy';
    } catch (error) {
      health.services.redis = 'unhealthy';
      health.status = 'degraded';
    }

    // Check PostgreSQL (if enabled)
    if (process.env.ENABLE_POSTGRES === 'true') {
      try {
        await pool.query('SELECT 1');
        health.services.postgresql = 'healthy';
      } catch (error) {
        health.services.postgresql = 'unhealthy';
        health.status = 'degraded';
      }
    }

    // Check Qdrant
    try {
      await qdrantClient.getCollections();
      health.services.qdrant = 'healthy';
    } catch (error) {
      health.services.qdrant = 'unhealthy';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  healthCheck
};