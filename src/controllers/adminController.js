
const NewsIngestionService = require('../services/NewsIngestionService');
const logger = require('../utils/logger');

const newsService = new NewsIngestionService();

const ingestNews = async (req, res) => {
  try {
    logger.info('Manual news ingestion triggered');
    const count = await newsService.ingestNews();
    res.json({ success: true, articlesIngested: count });
  } catch (error) {
    logger.error('Error ingesting news:', error);
    res.status(500).json({ error: 'Failed to ingest news' });
  }
};

const getCollectionStats = async (req, res) => {
  try {
    const qdrantClient = require('../config/qdrant');
    const collectionInfo = await qdrantClient.getCollection('news_embeddings');
    res.json({ 
      success: true, 
      stats: {
        pointsCount: collectionInfo.points_count,
        vectorsCount: collectionInfo.vectors_count,
        segments: collectionInfo.segments_count,
        status: collectionInfo.status
      }
    });
  } catch (error) {
    logger.error('Error getting collection stats:', error);
    res.status(500).json({ error: 'Failed to get collection stats' });
  }
};

module.exports = {
  ingestNews,
  getCollectionStats
};