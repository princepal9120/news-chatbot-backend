// server.js - Optimized Express server with performance fixes
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

// Performance monitoring middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 3000) {
      console.warn(`⚠️  SLOW REQUEST: ${req.method} ${req.path} - ${duration}ms`);
    } else if (req.path === '/api/query') {
      console.log(`✅ Query processed in ${duration}ms`);
    }
  });
  next();
});

// Initialize services with optimized configurations
const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    keepAlive: true,
    reconnectDelay: 50
  },
  lazyConnect: true
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://newsai:password@localhost:5432/newsai',
  max: 10, // connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-pro',
  generationConfig: {
    maxOutputTokens: 1000, // Limit response length
    temperature: 0.7
  }
});

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'localhost',
  apiKey: process.env.QDRANT_API_KEY || 'your-api-key',
  timeout: 10000
});

// Optimized News Ingestion and Embedding Service
class NewsIngestionService {
  constructor() {
    this.collectionName = 'news_embeddings';
    this.jinaApiKey = process.env.JINA_API_KEY;
    this.embeddingCache = new Map();
    this.maxCacheSize = 200;

    // Axios instance with optimized config
    this.axiosInstance = axios.create({
      timeout: 8000,
      headers: {
        'Authorization': `Bearer ${this.jinaApiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async initializeVectorDB() {
    try {
      await qdrantClient.createCollection(this.collectionName, {
        vectors: { size: 768, distance: 'Cosine' }
      });
      console.log('Vector collection created successfully');
    } catch (error) {
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
      // World / International News
      'https://feeds.bbci.co.uk/news/world/rss.xml',
      'https://rss.cnn.com/rss/edition_world.rss',
      'https://feeds.reuters.com/reuters/worldNews',
      'https://www.aljazeera.com/xml/rss/all.xml',
      'https://www.theguardian.com/world/rss',
      'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',

      // Politics
      'https://feeds.bbci.co.uk/news/politics/rss.xml',
      'https://rss.cnn.com/rss/cnn_allpolitics.rss',
      'https://www.theguardian.com/politics/rss',
      'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',
      'https://www.politico.com/rss/politics08.xml',

      // Technology
      'https://www.theverge.com/rss/index.xml',
      'https://feeds.arstechnica.com/arstechnica/index',
      'https://www.engadget.com/rss.xml',
      'https://techcrunch.com/feed/',
      'https://www.wired.com/feed/rss',
      'https://www.cnet.com/rss/news/',
      'https://thenextweb.com/feed/',
      'https://www.zdnet.com/news/rss.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',

      // Business / Finance
      'https://feeds.reuters.com/reuters/businessNews',
      'https://www.cnbc.com/id/100003114/device/rss/rss.html',
      'https://www.economist.com/latest/rss.xml',
      'https://www.forbes.com/business/feed2/',
      'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',

      // Sports
      'https://www.espn.com/espn/rss/news',
      'https://www.skysports.com/rss/12040',
      'https://www.bbc.com/sport/rss.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml',
      'https://www.cbssports.com/rss/headlines/',

      // Crypto / Blockchain
      'https://cointelegraph.com/rss',
      'https://news.bitcoin.com/feed/',
      'https://decrypt.co/feed',
      'https://www.coindesk.com/arc/outboundfeeds/rss/',

      // AI
      'https://spectrum.ieee.org/artificial-intelligence/fulltext/rss',
      'https://www.technologyreview.com/feed/',
      'https://venturebeat.com/category/ai/feed/'
    ];

    const articles = [];
    const promises = rssSources.slice(0, 15).map(async (rssUrl) => { // Limit concurrent requests
      try {
        const response = await axios.get(rssUrl, {
          headers: { 'Accept': 'application/rss+xml, application/xml' },
          timeout: 5000
        });

        const $ = cheerio.load(response.data, { xmlMode: true });
        const sourceArticles = [];

        $('item').each((i, item) => {
          if (sourceArticles.length < 10) { // Limit per source
            const title = $(item).find('title').text();
            const description = $(item).find('description').text();
            const link = $(item).find('link').text();
            const pubDate = $(item).find('pubDate').text();

            sourceArticles.push({
              id: uuidv4(),
              title: title.trim(),
              content: description.trim(),
              url: link.trim(),
              publishedAt: pubDate ? new Date(pubDate) : new Date(),
              source: new URL(rssUrl).hostname
            });
          }
        });

        return sourceArticles;
      } catch (error) {
        console.error(`Error scraping ${rssUrl}:`, error.message);
        return [];
      }
    });

    const results = await Promise.allSettled(promises);
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        articles.push(...result.value);
      }
    });

    return articles.slice(0, 100); // Limit total articles
  }

  // Optimized embedding generation with caching and batching
  async generateEmbeddings(texts) {
    const cacheKey = texts.join('|||');

    // Check cache first
    if (this.embeddingCache.has(cacheKey)) {
      console.log('✅ Using cached embeddings');
      return this.embeddingCache.get(cacheKey);
    }

    try {
      const batchSize = 10; // Smaller batches for better performance
      const embeddings = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);

        const response = await this.axiosInstance.post('https://api.jina.ai/v1/embeddings', {
          model: 'jina-embeddings-v2-base-en',
          input: batch
        });

        const batchEmbeddings = response.data.data.map(item => item.embedding);
        embeddings.push(...batchEmbeddings);

        // Small delay between batches
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Cache result
      if (this.embeddingCache.size >= this.maxCacheSize) {
        const firstKey = this.embeddingCache.keys().next().value;
        this.embeddingCache.delete(firstKey);
      }
      this.embeddingCache.set(cacheKey, embeddings);

      console.log("✅ Embeddings generated and cached");
      return embeddings;
    } catch (error) {
      console.error('❌ Embedding generation error:', error.message);
      // Fallback to mock embeddings
      return texts.map(() => Array(768).fill(0).map(() => Math.random()));
    }
  }

  async ingestNews() {
    console.log('🔄 Starting news ingestion...');
    const startTime = Date.now();

    const articles = await this.scrapeNews();
    console.log(`📰 Scraped ${articles.length} articles`);

    const texts = articles.map(article => `${article.title}\n${article.content.substring(0, 500)}`); // Limit content
    const embeddings = await this.generateEmbeddings(texts);

    const points = articles.map((article, index) => ({
      id: article.id,
      vector: embeddings[index],
      payload: {
        title: article.title,
        content: article.content.substring(0, 1000), // Limit stored content
        url: article.url,
        publishedAt: article.publishedAt.toISOString(),
        source: article.source
      }
    }));

    await qdrantClient.upsert(this.collectionName, {
      wait: true,
      points: points
    });

    const totalTime = Date.now() - startTime;
    console.log(`✅ Stored ${points.length} articles in ${totalTime}ms`);
    return articles.length;
  }

  // Optimized similarity search
  async searchSimilar(query, limit = 5) {
    const startTime = Date.now();

    try {
      const queryEmbedding = await this.generateEmbeddings([query]);
      console.log(`🔍 Query embedding: ${Date.now() - startTime}ms`);

      const searchStart = Date.now();
      const searchResult = await qdrantClient.search(this.collectionName, {
        vector: queryEmbedding[0],
        limit: limit,
        with_payload: true,
        score_threshold: 0.2 // Filter out irrelevant results
      });

      console.log(`🔍 Vector search: ${Date.now() - searchStart}ms`);

      return searchResult.map(result => ({
        score: result.score,
        ...result.payload
      }));
    } catch (error) {
      console.error('❌ Search error:', error.message);
      return [];
    }
  }
}

// Optimized Session Management Service
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
      content: content.substring(0, 2000), // Limit message length
      timestamp: new Date().toISOString()
    };

    // Use pipeline for better performance
    const pipeline = this.redis.multi();
    pipeline.lPush(messagesKey, JSON.stringify(message));
    pipeline.hIncrBy(sessionKey, 'message_count', 1);
    pipeline.expire(messagesKey, 3600 * 24);
    pipeline.expire(sessionKey, 3600 * 24);

    await pipeline.exec();
    return message;
  }

  async getSessionHistory(sessionId, limit = 10) {
    const messagesKey = `messages:${sessionId}`;
    const messages = await this.redis.lRange(messagesKey, 0, limit - 1);
    return messages.map(msg => JSON.parse(msg)).reverse();
  }

  async resetSession(sessionId) {
    const sessionKey = `session:${sessionId}`;
    const messagesKey = `messages:${sessionId}`;

    const pipeline = this.redis.multi();
    pipeline.del(messagesKey);
    pipeline.hSet(sessionKey, 'message_count', '0');
    await pipeline.exec();

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

      // Process sessions in parallel with limit
      const batchSize = 10;
      for (let i = 0; i < sessionKeys.length; i += batchSize) {
        const batch = sessionKeys.slice(i, i + batchSize);

        const batchPromises = batch.map(async (sessionKey) => {
          const sessionId = sessionKey.replace('session:', '');
          const sessionData = await this.redis.hGetAll(sessionKey);

          if (sessionData.created_at) {
            const recentMessages = await this.getSessionHistory(sessionId, 2);
            const lastMessage = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

            return {
              sessionId,
              title: lastMessage ? lastMessage.content.substring(0, 50) + '...' : 'New chat',
              messageCount: parseInt(sessionData.message_count) || 0,
              lastMessage: lastMessage ? lastMessage.content.substring(0, 100) + '...' : 'No messages yet',
              timestamp: lastMessage ? lastMessage.timestamp : sessionData.created_at
            };
          }
          return null;
        });

        const batchResults = await Promise.allSettled(batchPromises);
        batchResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            sessions.push(result.value);
          }
        });
      }

      return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      console.error('❌ Error getting all sessions:', error);
      return [];
    }
  }
}

// Optimized Chat Service
class ChatService {
  constructor(newsService, sessionService, geminiModel) {
    this.newsService = newsService;
    this.sessionService = sessionService;
    this.model = geminiModel;
    this.responseCache = new Map();
    this.maxCacheSize = 50;
  }

  // MAIN OPTIMIZATION: Parallel operations and reduced context
  async processQuery(sessionId, userMessage) {
    const startTime = Date.now();

    try {
      // 🚀 OPTIMIZATION 1: Run operations in parallel
      const [relevantNews, history] = await Promise.all([
        this.newsService.searchSimilar(userMessage, 3),
        this.sessionService.getSessionHistory(sessionId, 4) // Reduced from 10 to 4
      ]);

      console.log(`⚡ Parallel fetch: ${Date.now() - startTime}ms`);

      // 🚀 OPTIMIZATION 2: Build optimized context
      const newsContext = this.buildOptimizedNewsContext(relevantNews);
      const conversationHistory = this.buildOptimizedHistory(history);
      const prompt = this.buildOptimizedPrompt(newsContext, conversationHistory, userMessage);

      const geminiStart = Date.now();

      // 🚀 OPTIMIZATION 3: Generate response with timeout and retry
      const response = await this.generateResponseWithTimeout(prompt);

      console.log(`🤖 Gemini: ${Date.now() - geminiStart}ms`);

      // 🚀 OPTIMIZATION 4: Store messages asynchronously (non-blocking)
      this.storeMessagesAsync(sessionId, userMessage, response);

      const totalTime = Date.now() - startTime;
      console.log(`✅ Total processing: ${totalTime}ms`);

      return {
        role: 'bot',
        content: response,
        sources: this.extractOptimizedSources(relevantNews),
        processingTime: totalTime
      };
    } catch (error) {
      console.error('❌ Query processing error:', error.message);
      throw new Error('Failed to generate response');
    }
  }

  // Optimized context builders
  buildOptimizedNewsContext(relevantNews) {
    if (!relevantNews.length) return 'No recent news found.';

    return relevantNews.map(news => {
      const date = new Date(news.publishedAt).toLocaleDateString();
      return `[${news.source} - ${date}]\n${news.title}\n${news.content.substring(0, 300)}...`; // Reduced from 500 to 300
    }).join('\n\n');
  }

  buildOptimizedHistory(history) {
    if (!history.length) return 'No conversation history.';

    return history.slice(-3).map(msg => // Only last 3 messages
      `${msg.role}: ${msg.content.substring(0, 150)}...` // Reduced from 200 to 150
    ).join('\n');
  }

  buildOptimizedPrompt(newsContext, conversationHistory, userMessage) {
    return `You are a concise news assistant. Answer based on the provided articles and context.

Recent News:
${newsContext}

Context:
${conversationHistory}

User: ${userMessage}

Provide a focused, accurate answer (max 200 words):`;
  }

  // Response generation with timeout and retry
  async generateResponseWithTimeout(prompt, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout')), 10000) // 10 second timeout
        );

        const generatePromise = this.model.generateContent(prompt);
        const result = await Promise.race([generatePromise, timeoutPromise]);

        return result.response.text();

      } catch (error) {
        console.warn(`⚠️  Attempt ${attempt} failed: ${error.message}`);
        if (attempt === maxRetries) {
          throw new Error('Failed after retries: ' + error.message);
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // Non-blocking message storage
  async storeMessagesAsync(sessionId, userMessage, response) {
    try {
      await Promise.all([
        this.sessionService.addMessage(sessionId, 'user', userMessage),
        this.sessionService.addMessage(sessionId, 'bot', response)
      ]);
    } catch (error) {
      console.error('⚠️  Message storage error (non-blocking):', error.message);
    }
  }

  extractOptimizedSources(relevantNews) {
    return relevantNews.map(news => ({
      title: news.title,
      url: news.url,
      source: news.source,
      score: Math.round(news.score * 100) / 100 // Round score
    }));
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

    // Optional PostgreSQL storage (non-blocking)
    if (process.env.ENABLE_POSTGRES === 'true') {
      pool.query('INSERT INTO sessions (id, created_at) VALUES ($1, NOW())', [sessionId])
        .catch(err => console.error('PostgreSQL insert error:', err));
    }

    res.json({ sessionId });
  } catch (error) {
    console.error('❌ Session creation error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Process user query (MAIN OPTIMIZED ENDPOINT)
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

    const response = await chatService.processQuery(sessionId, message);

    // Optional PostgreSQL storage (non-blocking)
    if (process.env.ENABLE_POSTGRES === 'true') {
      pool.query(
        'INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [uuidv4(), sessionId, 'user', message, uuidv4(), sessionId, 'bot', response.content]
      ).catch(err => console.error('PostgreSQL message insert error:', err));
    }

    res.json(response);
  } catch (error) {
    console.error('❌ Query processing error:', error);
    res.status(500).json({ error: error.message || 'Failed to process query' });
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
 
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// Get chat history (optimized)
app.get('/api/chat-history', async (req, res) => {
  try {

    const sessions = await sessionService.getAllSessions();
    res.json({ sessions});
  } catch (error) {

    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Admin: Trigger news ingestion
app.post('/api/admin/ingest', async (req, res) => {
  try {
    const count = await newsService.ingestNews();
    res.json({ success: true, articlesIngested: count });
  } catch (error) {
    console.error('❌ News ingestion error:', error);
    res.status(500).json({ error: 'Failed to ingest news' });
  }
});

// Health check with detailed status
app.get('/health', async (req, res) => {
  try {
    const checks = await Promise.allSettled([
      redis.ping(),
      process.env.ENABLE_POSTGRES === 'true' ? pool.query('SELECT 1') : Promise.resolve(),
      qdrantClient.getCollections()
    ]);

    const redisStatus = checks[0].status === 'fulfilled' ? 'healthy' : 'unhealthy';
    const postgresStatus = checks[1].status === 'fulfilled' ? 'healthy' : 'unhealthy';
    const qdrantStatus = checks[2].status === 'fulfilled' ? 'healthy' : 'unhealthy';

    const overall = (redisStatus === 'healthy' && qdrantStatus === 'healthy') ? 'healthy' : 'degraded';

    res.status(overall === 'healthy' ? 200 : 503).json({
      status: overall,
      services: {
        redis: redisStatus,
        postgres: process.env.ENABLE_POSTGRES === 'true' ? postgresStatus : 'disabled',
        qdrant: qdrantStatus
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Initialize and start server
async function startServer() {
  try {
    console.log('🚀 Starting optimized server...');

    // Connect to Redis
    await redis.connect();
    console.log('✅ Connected to Redis');

    // Initialize vector DB
    await newsService.initializeVectorDB();
    console.log('✅ Vector DB initialized');

    // Test PostgreSQL connection (optional)
    if (process.env.ENABLE_POSTGRES === 'true') {
      await pool.query('SELECT NOW()');
      console.log('✅ Connected to PostgreSQL');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`🎉 Server running on port ${PORT}`);
      console.log('📋 Available endpoints:');
      console.log('   POST /api/session - Create new session');
      console.log('   POST /api/query - Process user query (OPTIMIZED)');
      console.log('   GET  /api/session/:id - Get session history');
      console.log('   POST /api/session/reset - Reset session');
      console.log('   GET  /api/chat-history - Get all sessions');
      console.log('   POST /api/admin/ingest - Trigger news ingestion');
      console.log('   GET  /health - Health check');
      
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Shutting down gracefully...');
  try {
    await redis.quit();
    await pool.end();
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 Received SIGINT, shutting down...');
  try {
    await redis.quit();
    await pool.end();
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();