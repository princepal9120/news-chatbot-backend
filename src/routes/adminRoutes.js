const express = require('express');
const { ingestNews, getCollectionStats } = require('../controllers/adminController');

const router = express.Router();

// Middleware for admin routes (add authentication as needed)
const adminAuth = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
router.use(adminAuth);

router.post('/ingest', ingestNews);
router.get('/stats', getCollectionStats);

module.exports = router;