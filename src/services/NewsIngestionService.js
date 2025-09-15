
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const qdrantClient = require('../config/qdrant');
const { rssSources, categoryKeywords } = require('../utils/rssSources');
const logger = require('../utils/logger');

class NewsIngestionService {
  constructor() {
    this.collectionName = 'news_embeddings';
    this.jinaApiKey = process.env.JINA_API_KEY;
  }

  async initializeVectorDB() {
    try {
      // First, try to get collection info to see if it exists
      try {
        await qdrantClient.getCollection(this.collectionName);
        logger.info('Vector collection already exists, checking indexes...');
        
        // Recreate collection with proper indexes to fix the filter issue
        await qdrantClient.deleteCollection(this.collectionName);
        logger.info('Deleted existing collection to recreate with proper indexes');
      } catch (error) {
        // Collection doesn't exist, which is fine
        logger.info('Creating new vector collection...');
      }

      // Create collection with explicit field indexes
      await qdrantClient.createCollection(this.collectionName, {
        vectors: { 
          size: 768, 
          distance: 'Cosine' 
        },
        optimizers_config: {
          default_segment_number: 2
        },
        hnsw_config: {
          m: 16,
          ef_construct: 100
        }
      });

      // Create field indexes for filtering - THIS FIXES THE ERROR
      await qdrantClient.createFieldIndex(this.collectionName, {
        field_name: 'category',
        field_type: 'keyword'
      });

      await qdrantClient.createFieldIndex(this.collectionName, {
        field_name: 'source',
        field_type: 'keyword'
      });

      await qdrantClient.createFieldIndex(this.collectionName, {
        field_name: 'publishedAt',
        field_type: 'datetime'
      });

      logger.info('Vector collection created successfully with field indexes');
    } catch (error) {
      logger.error('Error initializing vector DB:', error);
      throw error;
    }
  }

  async scrapeNews() {
    const articles = [];
    const articlesPerCategory = 15;
    const maxTotalArticles = 200;

    for (const [category, urls] of Object.entries(rssSources)) {
      logger.info(`Scraping ${category} news...`);
      let categoryCount = 0;

      for (const rssUrl of urls) {
        if (categoryCount >= articlesPerCategory || articles.length >= maxTotalArticles) {
          break;
        }

        try {
          logger.info(`Fetching: ${rssUrl}`);
          const response = await axios.get(rssUrl, {
            headers: {
              'Accept': 'application/rss+xml, application/xml, text/xml',
              'User-Agent': 'NewsAI-Bot/1.0'
            },
            timeout: 10000
          });

          const $ = cheerio.load(response.data, { xmlMode: true });
          const items = $('item, entry');
          logger.info(`Found ${items.length} items in ${rssUrl}`);

          items.each((i, item) => {
            if (categoryCount < articlesPerCategory && articles.length < maxTotalArticles) {
              const $item = $(item);

              const title = $item.find('title').text().trim();
              const description = $item.find('description, summary, content').first().text().trim();
              const link = $item.find('link').text().trim() || $item.find('link').attr('href');
              const pubDate = $item.find('pubDate, published, updated').first().text().trim();

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

                logger.debug(`Added article: ${title.substring(0, 50)}... (Category: ${category})`);
              }
            }
          });

        } catch (error) {
          logger.error(`Error scraping ${rssUrl}:`, error.message);
          continue;
        }
      }

      logger.info(`Category ${category}: ${categoryCount} articles added`);
    }

    const categoryStats = articles.reduce((stats, article) => {
      stats[article.category] = (stats[article.category] || 0) + 1;
      return stats;
    }, {});

    logger.info('Articles by category:', categoryStats);
    logger.info(`Total articles scraped: ${articles.length}`);

    return articles;
  }

  async ingestNews() {
    logger.info('Starting news ingestion...');

    const articles = await this.scrapeNews();

    if (articles.length === 0) {
      logger.warn('No articles were scraped!');
      return 0;
    }

    const validArticles = articles.filter(article =>
      article.title && article.title.length > 10 &&
      article.content && article.content.length > 50
    );

    logger.info(`${validArticles.length} articles have sufficient content for embedding`);

    if (validArticles.length === 0) {
      logger.warn('No valid articles for embedding!');
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
          category: article.category
        }
      }));

      await qdrantClient.upsert(this.collectionName, {
        wait: true,
        points: points
      });

      logger.info(`Successfully stored ${points.length} articles in vector DB`);

      const finalStats = validArticles.reduce((stats, article) => {
        stats[article.category] = (stats[article.category] || 0) + 1;
        return stats;
      }, {});

      logger.info('Final embedded articles by category:', finalStats);
      return validArticles.length;

    } catch (error) {
      logger.error('Error during embedding process:', error);
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
      
      logger.info("Embeddings generated successfully");
      return response.data.data.map(item => item.embedding);
    } catch (error) {
      logger.error('Error generating embeddings:', error);
      // Fallback to mock embeddings for testing
      return texts.map(() => Array(768).fill(0).map(() => Math.random()));
    }
  }

  async searchSimilar(query, limit = 5) {
    try {
      const queryEmbedding = await this.generateEmbeddings([query]);

      // Detect category-specific query
      const queryLower = query.toLowerCase();
      let targetCategory = null;
      
      for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(keyword => queryLower.includes(keyword))) {
          targetCategory = category;
          break;
        }
      }

      let searchResult;

      if (targetCategory) {
        // Search with category filter - now with proper field index
        searchResult = await qdrantClient.search(this.collectionName, {
          vector: queryEmbedding[0],
          limit: limit * 2,
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

        if (searchResult.length < limit) {
          logger.info(`Only found ${searchResult.length} ${targetCategory} articles, supplementing with general search`);
          const generalSearch = await qdrantClient.search(this.collectionName, {
            vector: queryEmbedding[0],
            limit: limit,
            with_payload: true
          });

          const existingIds = new Set(searchResult.map(r => r.id));
          const supplementalResults = generalSearch.filter(r => !existingIds.has(r.id));
          searchResult = [...searchResult, ...supplementalResults].slice(0, limit);
        } else {
          searchResult = searchResult.slice(0, limit);
        }
      } else {
        // General search
        searchResult = await qdrantClient.search(this.collectionName, {
          vector: queryEmbedding[0],
          limit: limit,
          with_payload: true
        });
      }

      logger.info(`Search for "${query}" (category: ${targetCategory || 'general'}) returned ${searchResult.length} results`);

      return searchResult.map(result => ({
        score: result.score,
        ...result.payload
      }));
    } catch (error) {
      logger.error('Error in searchSimilar:', error);
      throw error;
    }
  }
}
module.exports = NewsIngestionService;