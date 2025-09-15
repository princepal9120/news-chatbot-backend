
const ChatService = require('../services/ChatService');
const SessionService = require('../services/SessionService');
const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const chatService = new ChatService();
const sessionService = new SessionService();

const processQuery = async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'Session ID and message are required' });
    }

    const sessionExists = await sessionService.sessionExists(sessionId);
    if (!sessionExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const startTime = Date.now();
    const response = await chatService.processQuery(sessionId, message);
    const processingTime = Date.now() - startTime;

    logger.info(`Query processed in ${processingTime}ms`);

    // Optional: Store in PostgreSQL
    if (process.env.ENABLE_POSTGRES === 'true') {
      await pool.query(
        'INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [uuidv4(), sessionId, 'user', message, uuidv4(), sessionId, 'bot', response.content]
      );
    }

    res.json(response);
  } catch (error) {
    logger.error('Error processing query:', error);
    res.status(500).json({ error: 'Failed to process query' });
  }
};

module.exports = {
  processQuery
};
