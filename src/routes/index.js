
const express = require('express');
const sessionRoutes = require('./sessionRoutes');
const chatRoutes = require('./chatRoutes');
const adminRoutes = require('./adminRoutes');
const healthRoutes = require('./healthRoutes');

const router = express.Router();

router.use('/session', sessionRoutes);
router.use('/chat', chatRoutes);
router.use('/admin', adminRoutes);
router.use('/health', healthRoutes);

module.exports = router;