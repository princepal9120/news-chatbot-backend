const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('redis');
const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { QdrantClient } = require('@qdrant/js-client-rest');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize services
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redis.on('error', (err) => console.log('Redis Client Error', err));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://newsai:password@localhost:5432/newsai'
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const qdrantClient = new QdrantClient({
  url: `https://${process.env.QDRANT_HOST}`,  // Use full https URL
  apiKey: process.env.QDRANT_API_KEY,        // Pass your API key
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
        vectors: { size: 768, distance: 'Cosine' },
        // Declare payload schema so Qdrant knows what fields to index
        on_disk_payload: true,
        sparse_vectors: {},
        optimizers_config: { default_segment_number: 2 },
        hnsw_config: { m: 16, ef_construct: 100 },
        // <---- important
        payload_schema: {
          category: { type: 'keyword' },
          source: { type: 'keyword' },
          publishedAt: { type: 'datetime' }
        }
      });
      console.log('Vector collection created successfully');
    } catch (error) {
      if (
        error.status === 409 ||
        error.message?.includes('already exists') ||
        error.data?.status?.error?.includes('already exists')
      ) {
        console.log('Vector collection already exists');
      } else {
        throw error;
      }
    }
  }


  async scrapeNews() {
    const rssSources = {
      // 🌍 World / International News (limit per category)
      world: [
        'https://feeds.bbci.co.uk/news/world/rss.xml',
        'https://rss.cnn.com/rss/edition_world.rss',
        'https://feeds.reuters.com/reuters/worldNews',
        'https://www.theguardian.com/world/rss',
        'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'
      ],

      // 🏛 Politics
      politics: [
        'https://feeds.bbci.co.uk/news/politics/rss.xml',
        'https://rss.cnn.com/rss/cnn_allpolitics.rss',
        'https://www.theguardian.com/politics/rss',
        'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml'
      ],

      // 💻 Technology
      technology: [
        'https://www.theverge.com/rss/index.xml',
        'https://feeds.arstechnica.com/arstechnica/index',
        'https://www.engadget.com/rss.xml',
        'https://techcrunch.com/feed/',
        'https://www.wired.com/feed/rss',
        'https://thenextweb.com/feed/',
        'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml'
      ],

      // 💹 Business / Finance
      business: [
        'https://feeds.reuters.com/reuters/businessNews',
        'https://www.cnbc.com/id/100003114/device/rss/rss.html',
        'https://www.forbes.com/real-time/feed2/',
        'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml'
      ],

      // 🏟 Sports
      sports: [
        'https://www.espn.com/espn/rss/news',
        'https://feeds.bbci.co.uk/sport/rss.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml'
      ],

      // 🪙 Crypto / Blockchain
      crypto: [
        'https://cointelegraph.com/rss',
        'https://www.coindesk.com/arc/outboundfeeds/rss/',
        'https://decrypt.co/feed'
      ],

      // 🤖 AI / Science
      ai_science: [
        'https://www.technologyreview.com/feed/',
        'https://venturebeat.com/category/ai/feed/',
        'https://feeds.feedburner.com/oreilly/radar'
      ]
    };

    const articles = [];
    const articlesPerCategory = 15; // Ensure balanced coverage
    const maxTotalArticles = 200; // Increased total limit

    for (const [category, urls] of Object.entries(rssSources)) {
      console.log(`Scraping ${category} news...`);
      let categoryCount = 0;

      for (const rssUrl of urls) {
        if (categoryCount >= articlesPerCategory || articles.length >= maxTotalArticles) {
          break;
        }

        try {
          console.log(`Fetching: ${rssUrl}`);
          const response = await axios.get(rssUrl, {
            headers: {
              'Accept': 'application/rss+xml, application/xml, text/xml',
              'User-Agent': 'NewsAI-Bot/1.0'
            },
            timeout: 10000 // 10 second timeout
          });

          const $ = cheerio.load(response.data, { xmlMode: true });

          // Handle both 'item' and 'entry' tags (RSS vs Atom feeds)
          const items = $('item, entry');
          console.log(`Found ${items.length} items in ${rssUrl}`);

          items.each((i, item) => {
            if (categoryCount < articlesPerCategory && articles.length < maxTotalArticles) {
              const $item = $(item);

              // Handle both RSS and Atom formats
              const title = $item.find('title').text().trim();
              const description = $item.find('description, summary, content').first().text().trim();
              const link = $item.find('link').text().trim() || $item.find('link').attr('href');
              const pubDate = $item.find('pubDate, published, updated').first().text().trim();

              // Only add articles with substantial content
              if (title && title.length > 10 && description && description.length > 50) {
                const article = {
                  id: uuidv4(),
                  title: title,
                  content: description,
                  url: link,
                  publishedAt: pubDate ? new Date(pubDate) : new Date(),
                  source: new URL(rssUrl).hostname,
                  category: category
                };

                articles.push(article);
                categoryCount++;

                console.log(`Added article: ${title.substring(0, 50)}... (Category: ${category})`);
              }
            }
          });

        } catch (error) {
          console.error(`Error scraping ${rssUrl}:`, error.message);
          continue; // Continue with next source instead of failing
        }
      }

      console.log(`Category ${category}: ${categoryCount} articles added`);
    }

    // Log category distribution
    const categoryStats = articles.reduce((stats, article) => {
      stats[article.category] = (stats[article.category] || 0) + 1;
      return stats;
    }, {});

    console.log('Articles by category:', categoryStats);
    console.log(`Total articles scraped: ${articles.length}`);

    return articles;
  }

  // Also update the ingestNews method to provide better logging
  async ingestNews() {
    console.log('Starting news ingestion...');

    const articles = await this.scrapeNews();

    if (articles.length === 0) {
      console.warn('No articles were scraped!');
      return 0;
    }

    console.log(`Scraped ${articles.length} articles`);

    // Filter out articles with insufficient content
    const validArticles = articles.filter(article =>
      article.title && article.title.length > 10 &&
      article.content && article.content.length > 50
    );

    console.log(`${validArticles.length} articles have sufficient content for embedding`);

    if (validArticles.length === 0) {
      console.warn('No valid articles for embedding!');
      return 0;
    }

    const texts = validArticles.map(article => `${article.title}\n${article.content}`);

    try {
      const embeddings = await this.generateEmbeddings(texts);

      const points = validArticles.map((article, index) => ({
        id: article.id,
        vector: embeddings[index],
        payload: {
          title: article.title,
          content: article.content,
          url: article.url,
          publishedAt: article.publishedAt.toISOString(),
          source: article.source,
          category: article.category // Add category to payload
        }
      }));

      await qdrantClient.upsert(this.collectionName, {
        wait: true,
        points: points
      });

      console.log(`Successfully stored ${points.length} articles in vector DB`);

      // Log final category distribution
      const finalStats = validArticles.reduce((stats, article) => {
        stats[article.category] = (stats[article.category] || 0) + 1;
        return stats;
      }, {});

      console.log('Final embedded articles by category:', finalStats);

      return validArticles.length;

    } catch (error) {
      console.error('Error during embedding process:', error);
      throw error;
    }
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

  async searchSimilar(query, limit = 5) {
    const queryEmbedding = await this.generateEmbeddings([query]);

    // Detect if this is a category-specific query
    const queryLower = query.toLowerCase();
    const categoryKeywords = {
      sports: ['sport', 'sports', 'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'hockey', 'olympics', 'nfl', 'nba', 'mlb', 'espn'],
      technology: ['tech', 'technology', 'ai', 'artificial intelligence', 'computer', 'software', 'app', 'digital'],
      politics: ['politics', 'political', 'government', 'election', 'president', 'congress', 'senate'],
      business: ['business', 'finance', 'economy', 'stock', 'market', 'company', 'corporate'],
      crypto: ['crypto', 'cryptocurrency', 'bitcoin', 'blockchain', 'ethereum'],
      world: ['world', 'international', 'global', 'country', 'nation']
    };

    let targetCategory = null;
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => queryLower.includes(keyword))) {
        targetCategory = category;
        break;
      }
    }

    let searchResult;

    if (targetCategory) {
      // First try to find articles from the specific category
      searchResult = await qdrantClient.search(this.collectionName, {
        vector: queryEmbedding[0],
        limit: limit * 2, // Get more results to filter
        with_payload: true,
        filter: {
          must: [
            {
              key: 'category',
              match: {
                value: targetCategory
              }
            }
          ]
        }
      });

      // If we don't get enough category-specific results, fall back to general search
      if (searchResult.length < limit) {
        console.log(`Only found ${searchResult.length} ${targetCategory} articles, supplementing with general search`);
        const generalSearch = await qdrantClient.search(this.collectionName, {
          vector: queryEmbedding[0],
          limit: limit,
          with_payload: true
        });

        // Combine and deduplicate results
        const existingIds = new Set(searchResult.map(r => r.id));
        const supplementalResults = generalSearch.filter(r => !existingIds.has(r.id));
        searchResult = [...searchResult, ...supplementalResults].slice(0, limit);
      } else {
        searchResult = searchResult.slice(0, limit);
      }
    } else {
      // General search if no specific category detected
      searchResult = await qdrantClient.search(this.collectionName, {
        vector: queryEmbedding[0],
        limit: limit,
        with_payload: true
      });
    }

    console.log(`Search for "${query}" (category: ${targetCategory || 'general'}) returned ${searchResult.length} results`);

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
    const relevantNews = await this.newsService.searchSimilar(userMessage, 5);

    // Get recent chat history for context
    const history = await this.sessionService.getSessionHistory(sessionId, 10);

    // Check if we found relevant articles
    if (relevantNews.length === 0) {
      const response = "I don't have any recent news articles that match your query. Please try asking about different topics or check back later as I regularly update my news database.";

      await this.sessionService.addMessage(sessionId, 'user', userMessage);
      await this.sessionService.addMessage(sessionId, 'bot', response);

      return {
        role: 'bot',
        content: response,
        sources: []
      };
    }

    // Build context for Gemini
    const newsContext = relevantNews.map((news, index) =>
      `Article ${index + 1} [${news.source} - ${news.category?.toUpperCase() || 'NEWS'} - ${new Date(news.publishedAt).toLocaleDateString()}]:
Title: ${news.title}
Content: ${news.content}`
    ).join('\n\n');

    const conversationHistory = history.slice(-5).map(msg =>
      `${msg.role}: ${msg.content}`
    ).join('\n');

    // Detect query type for better responses
    const queryLower = userMessage.toLowerCase();
    const isSportsQuery = ['sport', 'sports', 'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'hockey', 'olympics', 'nfl', 'nba', 'mlb'].some(term => queryLower.includes(term));

    const prompt = `
You are a helpful news assistant. Answer the user's question based on the following recent news articles and conversation history.

Recent News Articles (${relevantNews.length} articles found):
${newsContext}

Recent Conversation:
${conversationHistory}

User Question: ${userMessage}

Instructions:
- Provide accurate information based ONLY on the news articles provided above
- If you found relevant articles, use them to answer the question thoroughly
- ${isSportsQuery ? 'Focus on sports-related content and provide detailed sports information' : 'Provide comprehensive coverage of the topic'}
- Be specific and cite information from the articles
- If the articles don't fully answer the question, mention what information is available
- Include relevant details like dates, sources, and key facts
- Be engaging and informative
- Always mention the category of news (e.g., SPORTS, TECH, POLITICS) when relevant

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
          source: news.source,
          category: news.category
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