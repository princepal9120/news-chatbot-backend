// server.js - Main Express server
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Redis = require('redis');
const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { QdrantClient } = require('@qdrant/js-client-rest');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize services
const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://newsai:password@localhost:5432/newsai'
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'localhost',
  apiKey: process.env.QDRANT_API_KEY || 'your-api-key'
});

// News Ingestion and Embedding Service
class NewsIngestionService {
  constructor() {
    this.collectionName = 'news_embeddings';
    this.jinaApiKey = process.env.JINA_API_KEY;
  }

  async initializeVectorDB() {
    try {
      await qdrantClient.createCollection(this.collectionName, {
        vectors: { size: 768, distance: 'Cosine' }
      });
      console.log('Vector collection created successfully');
    } catch (error) {
      // Check for conflict status (409) or error message containing 'already exists'
      if (error.status === 409 ||
        error.message?.includes('already exists') ||
        error.data?.status?.error?.includes('already exists')) {
        console.log('Vector collection already exists');
      } else {
        throw error;
      }
    }
  }



  async scrapeNews() {
    const rssSources = [
      // 🌍 World / International News
      'https://feeds.bbci.co.uk/news/world/rss.xml',
      'https://rss.cnn.com/rss/edition_world.rss',
      'https://feeds.reuters.com/reuters/worldNews',
      'https://www.aljazeera.com/xml/rss/all.xml',
      'https://www.theguardian.com/world/rss',
      'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',

      // 🏛 Politics
      'https://feeds.bbci.co.uk/news/politics/rss.xml',
      'https://rss.cnn.com/rss/cnn_allpolitics.rss',
      'https://www.theguardian.com/politics/rss',
      'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',
      'https://www.politico.com/rss/politics08.xml',

      // 💻 Technology
      'https://www.theverge.com/rss/index.xml',
      'https://feeds.arstechnica.com/arstechnica/index',
      'https://www.engadget.com/rss.xml',
      'https://techcrunch.com/feed/',
      'https://www.wired.com/feed/rss',
      'https://www.cnet.com/rss/news/',
      'https://thenextweb.com/feed/',
      'https://www.zdnet.com/news/rss.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',

      // 💹 Business / Finance
      'https://feeds.reuters.com/reuters/businessNews',
      'https://www.cnbc.com/id/100003114/device/rss/rss.html',
      'https://www.economist.com/latest/rss.xml',
      'https://www.forbes.com/business/feed2/',
      'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
      'https://www.ft.com/?format=rss',
      'https://www.bloomberg.com/feed/podcast/businessweek.xml',

      // 🏟 Sports
      'https://www.espn.com/espn/rss/news',
      'https://www.skysports.com/rss/12040',
      'https://www.bbc.com/sport/rss.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml',
      'https://www.cbssports.com/rss/headlines/',

      // ✈ Travel
      'https://www.nationalgeographic.com/content/nationalgeographic/en_us/travel.rss',
      'https://www.lonelyplanet.com/news.rss',
      'https://rss.nytimes.com/services/xml/rss/nyt/Travel.xml',
      'https://feeds.bbci.co.uk/news/world/asia/rss.xml', // has travel-style stories too

      // 🪙 Crypto / Blockchain
      'https://cointelegraph.com/rss',
      'https://news.bitcoin.com/feed/',
      'https://decrypt.co/feed',
      'https://www.coindesk.com/arc/outboundfeeds/rss/',

      // 🤖 Artificial Intelligence
      'https://spectrum.ieee.org/artificial-intelligence/fulltext/rss',
      'https://www.technologyreview.com/feed/', // MIT Tech Review (AI heavy)
      'https://venturebeat.com/category/ai/feed/',
      'https://towardsdatascience.com/feed'
    ];

    const articles = [];

    for (const rssUrl of rssSources) {
      if (articles.length >= 100) break; // increase limit for more categories

      try {
        const response = await axios.get(rssUrl, {
          headers: { 'Accept': 'application/rss+xml, application/xml' }
        });

        const $ = cheerio.load(response.data, { xmlMode: true });

        $('item').each((i, item) => {
          if (articles.length < 100) {
            const title = $(item).find('title').text();
            const description = $(item).find('description').text();
            const link = $(item).find('link').text();
            const pubDate = $(item).find('pubDate').text();

            articles.push({
              id: uuidv4(),
              title: title.trim(),
              content: description.trim(),
              url: link.trim(),
              publishedAt: pubDate ? new Date(pubDate) : new Date(),
              source: new URL(rssUrl).hostname
            });
          }
        });
      } catch (error) {
        console.error(`Error scraping ${rssUrl}:`, error.message);
      }
    }

    return articles;
  }




  async generateEmbeddings(texts) {



    try {
      const response = await axios.post('https://api.jina.ai/v1/embeddings', {
        model: 'jina-embeddings-v2-base-en',
        input: texts
      }, {
        headers: {
          'Authorization': `Bearer ${this.jinaApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      console.log("Embeddings generated successfully");

      return response.data.data.map(item => item.embedding);
    } catch (error) {
      console.error('Error generating embeddings:', error);
      // Fallback to mock embeddings for testing
      return texts.map(() => Array(768).fill(0).map(() => Math.random()));
    }
  }

  async ingestNews() {
    console.log('Starting news ingestion...');

    const articles = await this.scrapeNews();
    console.log(`Scraped ${articles.length} articles`);

    const texts = articles.map(article => `${article.title}\n${article.content}`);
    const embeddings = await this.generateEmbeddings(texts);

    const points = articles.map((article, index) => ({
      id: article.id,
      vector: embeddings[index],
      payload: {
        title: article.title,
        content: article.content,
        url: article.url,
        publishedAt: article.publishedAt.toISOString(),
        source: article.source
      }
    }));

    await qdrantClient.upsert(this.collectionName, {
      wait: true,
      points: points
    });

    console.log(`Stored ${points.length} articles in vector DB`);
    return articles.length;
  }

  async searchSimilar(query, limit = 5) {
    const queryEmbedding = await this.generateEmbeddings([query]);

    const searchResult = await qdrantClient.search(this.collectionName, {
      vector: queryEmbedding[0],
      limit: limit,
      with_payload: true
    });

    return searchResult.map(result => ({
      score: result.score,
      ...result.payload
    }));
  }
}

// Session Management Service
class SessionService {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async createSession() {
    const sessionId = uuidv4();
    const sessionKey = `session:${sessionId}`;

    await this.redis.hSet(sessionKey, {
      created_at: new Date().toISOString(),
      message_count: '0'
    });

    await this.redis.expire(sessionKey, 3600 * 24); // 24 hours TTL

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

    return true;
  }

  async sessionExists(sessionId) {
    const sessionKey = `session:${sessionId}`;
    return await this.redis.exists(sessionKey);
  }

  async getAllSessions() {
    try {
      // Get all session keys
      const sessionKeys = await this.redis.keys('session:*');
      const sessions = [];

      for (const sessionKey of sessionKeys) {
        const sessionId = sessionKey.replace('session:', '');
        const sessionData = await this.redis.hGetAll(sessionKey);

        if (sessionData.created_at) {
          // Get recent messages for this session
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

      // Sort by timestamp (most recent first)
      sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return sessions;
    } catch (error) {
      console.error('Error getting all sessions:', error);
      return [];
    }
  }
}

// Chat Service
class ChatService {
  constructor(newsService, sessionService, geminiModel) {
    this.newsService = newsService;
    this.sessionService = sessionService;
    this.model = geminiModel;
  }

  async processQuery(sessionId, userMessage) {
    // Retrieve relevant news passages
    const relevantNews = await this.newsService.searchSimilar(userMessage, 3);

    // Get recent chat history for context
    const history = await this.sessionService.getSessionHistory(sessionId, 10);

    // Build context for Gemini
    const newsContext = relevantNews.map(news =>
      `[${news.source} - ${news.publishedAt}] ${news.title}\n${news.content}`
    ).join('\n\n');

    const conversationHistory = history.slice(-5).map(msg =>
      `${msg.role}: ${msg.content}`
    ).join('\n');

    const prompt = `
You are a helpful news assistant. Answer the user's question based on the following recent news articles and conversation history.

Recent News Articles:
${newsContext}

Recent Conversation:
${conversationHistory}

User Question: ${userMessage}

Instructions:
- Provide accurate information based on the news articles
- If the question can't be answered from the articles, say so clearly
- Be concise but informative
- Cite sources when relevant
- Maintain conversation context

Answer:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();

      // Store both user message and bot response
      await this.sessionService.addMessage(sessionId, 'user', userMessage);
      await this.sessionService.addMessage(sessionId, 'bot', response);

      return {
        role: 'bot',
        content: response,
        sources: relevantNews.map(news => ({
          title: news.title,
          url: news.url,
          source: news.source
        }))
      };
    } catch (error) {
      console.error('Error generating response:', error);
      throw new Error('Failed to generate response');
    }
  }
}

// Initialize services
const newsService = new NewsIngestionService();
const sessionService = new SessionService(redis);
const chatService = new ChatService(newsService, sessionService, model);

// API Routes

// Create new session
app.post('/api/session', async (req, res) => {
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
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Process user query
app.post('/api/query', async (req, res) => {
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

    console.log(`Query processed in ${processingTime}ms`);

    // Optional: Store in PostgreSQL
    if (process.env.ENABLE_POSTGRES === 'true') {
      await pool.query(
        'INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [uuidv4(), sessionId, 'user', message, uuidv4(), sessionId, 'bot', response.content]
      );
    }

    res.json(response);
  } catch (error) {
    console.error('Error processing query:', error);
    res.status(500).json({ error: 'Failed to process query' });
  }
});

// Get session history
app.get('/api/session/:id', async (req, res) => {
  try {
    const sessionId = req.params.id;

    const sessionExists = await sessionService.sessionExists(sessionId);
    if (!sessionExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const history = await sessionService.getSessionHistory(sessionId);
    res.json({ sessionId, messages: history });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Reset session
app.post('/api/session/reset', async (req, res) => {
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
    console.error('Error resetting session:', error);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// Get chat history (all sessions with recent messages)
app.get('/api/chat-history', async (req, res) => {
  try {
    const sessions = await sessionService.getAllSessions();
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Admin: Trigger news ingestion
app.post('/api/admin/ingest', async (req, res) => {
  try {
    const count = await newsService.ingestNews();
    res.json({ success: true, articlesIngested: count });
  } catch (error) {
    console.error('Error ingesting news:', error);
    res.status(500).json({ error: 'Failed to ingest news' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

// Initialize and start server
async function startServer() {
  try {
    // Connect to Redis
    await redis.connect();
    console.log('Connected to Redis');

    // Initialize vector DB
    await newsService.initializeVectorDB();

    // Test PostgreSQL connection (optional)
    if (process.env.ENABLE_POSTGRES === 'true') {
      await pool.query('SELECT NOW()');
      console.log('Connected to PostgreSQL');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Available endpoints:');
      console.log('POST /api/session - Create new session');
      console.log('POST /api/query - Process user query');
      console.log('GET /api/session/:id - Get session history');
      console.log('POST /api/session/reset - Reset session');
      console.log('POST /api/admin/ingest - Trigger news ingestion');
      console.log('GET /health - Health check');
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await redis.quit();
  await pool.end();
  process.exit(0);
});

startServer();