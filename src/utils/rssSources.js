const rssSources = {
  // 🌍 World / International News
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

const categoryKeywords = {
  sports: ['sport', 'sports', 'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'hockey', 'olympics', 'nfl', 'nba', 'mlb', 'espn'],
  technology: ['tech', 'technology', 'ai', 'artificial intelligence', 'computer', 'software', 'app', 'digital'],
  politics: ['politics', 'political', 'government', 'election', 'president', 'congress', 'senate'],
  business: ['business', 'finance', 'economy', 'stock', 'market', 'company', 'corporate'],
  crypto: ['crypto', 'cryptocurrency', 'bitcoin', 'blockchain', 'ethereum'],
  world: ['world', 'international', 'global', 'country', 'nation']
};

module.exports = {
  rssSources,
  categoryKeywords
};