const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrantClient = new QdrantClient({
  url: `https://${process.env.QDRANT_HOST}`,
  apiKey: process.env.QDRANT_API_KEY,
});

module.exports = qdrantClient;