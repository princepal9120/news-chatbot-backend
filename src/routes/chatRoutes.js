const express = require('express');
const { processQuery } = require('../controllers/chatController');

const router = express.Router();

router.post('/query', processQuery);

module.exports = router;
