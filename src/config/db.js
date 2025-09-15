const { createClient } = require('redis');
const { Pool } = require('pg');
const logger = require('../utils/logger');

// Redis client
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redis.on('error', (err) => logger.error('Redis Client Error', err));
redis.on('connect', () => logger.info('Connected to Redis'));

// PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://newsai:password@localhost:5432/newsai'
});

pool.on('error', (err) => logger.error('PostgreSQL pool error', err));

async function initializeConnections() {
  try {
    // Connect to Redis
    await redis.connect();
    logger.info('Redis connection established');
    
    // Test PostgreSQL connection (optional)
    if (process.env.ENABLE_POSTGRES === 'true') {
      await pool.query('SELECT NOW()');
      logger.info('PostgreSQL connection established');
    }
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
}

module.exports = {
  redis,
  pool,
  initializeConnections
};