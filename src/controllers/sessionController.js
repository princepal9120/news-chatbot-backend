
const SessionService = require('../services/SessionService');
const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const sessionService = new SessionService();

const createSession = async (req, res) => {
  try {
    const sessionId = await sessionService.createSession();

    // Optional: Store in PostgreSQL
    if (process.env.ENABLE_POSTGRES === 'true') {
      await pool.query(
        'INSERT INTO sessions (id, created_at) VALUES ($1, NOW())',
        [sessionId]
      );
    }

    res.json({ sessionId });
  } catch (error) {
    logger.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
};

const getSession = async (req, res) => {
  try {
    const sessionId = req.params.id;

    const sessionExists = await sessionService.sessionExists(sessionId);
    if (!sessionExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const history = await sessionService.getSessionHistory(sessionId);
    res.json({ sessionId, messages: history });
  } catch (error) {
    logger.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
};

const resetSession = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const sessionExists = await sessionService.sessionExists(sessionId);
    if (!sessionExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await sessionService.resetSession(sessionId);
    res.json({ success: true, message: 'Session reset successfully' });
  } catch (error) {
    logger.error('Error resetting session:', error);
    res.status(500).json({ error: 'Failed to reset session' });
  }
};

const getChatHistory = async (req, res) => {
  try {
    const sessions = await sessionService.getAllSessions();
    res.json({ sessions });
  } catch (error) {
    logger.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
};

module.exports = {
  createSession,
  getSession,
  resetSession,
  getChatHistory
};
