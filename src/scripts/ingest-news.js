
// scripts/ingest-news.js
const axios = require('axios');
require('dotenv').config();

async function ingestNews() {
  try {
    console.log('Triggering news ingestion...');
    
    const response = await axios.post(`http://localhost:${process.env.PORT || 3000}/api/admin/ingest`);
    
    console.log('Ingestion completed:', response.data);
  } catch (error) {
    console.error('Error triggering ingestion:', error.message);
    process.exit(1);
  }
}

ingestNews();
