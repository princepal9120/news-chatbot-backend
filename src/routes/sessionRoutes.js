const express = require('express');
const {
  createSession,
  getSession,
  resetSession,
  getChatHistory
} = require('../controllers/sessionController');

const router = express.Router();

router.post('/', createSession);
router.get('/history', getChatHistory);
router.get('/:id', getSession);
router.post('/reset', resetSession);

module.exports = router;