
const { v4: uuidv4 } = require('uuid');
const { redis } = require('../config/db');
const logger = require('../utils/logger');

class SessionService {
  constructor() {
    this.redis = redis;
  }

  async createSession() {
    const sessionId = uuidv4();
    const sessionKey = `session:${sessionId}`;

    await this.redis.hSet(sessionKey, {
      created_at: new Date().toISOString(),
      message_count: '0'
    });

    await this.redis.expire(sessionKey, 3600 * 24); // 24 hours TTL
    logger.info(`Created new session: ${sessionId}`);

    return sessionId;
  }

  async addMessage(sessionId, role, content) {
    const sessionKey = `session:${sessionId}`;
    const messagesKey = `messages:${sessionId}`;

    const messageId = uuidv4();
    const message = {
      id: messageId,
      role,
      content,
      timestamp: new Date().toISOString()
    };

    await this.redis.lPush(messagesKey, JSON.stringify(message));
    await this.redis.hIncrBy(sessionKey, 'message_count', 1);
    await this.redis.expire(messagesKey, 3600 * 24);

    logger.debug(`Added message to session ${sessionId}: ${role}`);
    return message;
  }

  async getSessionHistory(sessionId, limit = 50) {
    const messagesKey = `messages:${sessionId}`;
    const messages = await this.redis.lRange(messagesKey, 0, limit - 1);

    return messages.map(msg => JSON.parse(msg)).reverse();
  }

  async resetSession(sessionId) {
    const sessionKey = `session:${sessionId}`;
    const messagesKey = `messages:${sessionId}`;

    await this.redis.del(messagesKey);
    await this.redis.hSet(sessionKey, 'message_count', '0');

    logger.info(`Reset session: ${sessionId}`);
    return true;
  }

  async sessionExists(sessionId) {
    const sessionKey = `session:${sessionId}`;
    return await this.redis.exists(sessionKey);
  }

  async getAllSessions() {
    try {
      const sessionKeys = await this.redis.keys('session:*');
      const sessions = [];

      for (const sessionKey of sessionKeys) {
        const sessionId = sessionKey.replace('session:', '');
        const sessionData = await this.redis.hGetAll(sessionKey);

        if (sessionData.created_at) {
          const recentMessages = await this.getSessionHistory(sessionId, 3);
          const lastMessage = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

          sessions.push({
            sessionId,
            title: lastMessage ? lastMessage.content.substring(0, 50) + '...' : 'New chat',
            messageCount: parseInt(sessionData.message_count) || 0,
            lastMessage: lastMessage ? lastMessage.content : 'No messages yet',
            timestamp: lastMessage ? lastMessage.timestamp : sessionData.created_at
          });
        }
      }

      sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return sessions;
    } catch (error) {
      logger.error('Error getting all sessions:', error);
      return [];
    }
  }
}

module.exports = SessionService;
