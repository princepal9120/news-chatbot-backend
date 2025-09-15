
// scripts/test-api.js
const axios = require('axios');
require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

async function testAPI() {
  try {
    console.log('Testing News AI Chat API...\n');

    // 1. Health check
    console.log('1. Testing health endpoint...');
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check:', health.data.status);

    // 2. Create session
    console.log('\n2. Creating new session...');
    const sessionResponse = await axios.post(`${BASE_URL}/api/session`);
    const sessionId = sessionResponse.data.sessionId;
    console.log('✅ Session created:', sessionId);

    // 3. Send query
    console.log('\n3. Sending query...');
    const queryResponse = await axios.post(`${BASE_URL}/api/query`, {
      sessionId,
      message: "What's happening in the global economy?"
    });
    console.log('✅ Query response:', queryResponse.data.content.substring(0, 100) + '...');

    // 4. Get session history
    console.log('\n4. Fetching session history...');
    const historyResponse = await axios.get(`${BASE_URL}/api/session/${sessionId}`);
    console.log('✅ Message count:', historyResponse.data.messages.length);

    // 5. Reset session
    console.log('\n5. Resetting session...');
    const resetResponse = await axios.post(`${BASE_URL}/api/session/reset`, {
      sessionId
    });
    console.log('✅ Session reset:', resetResponse.data.success);

    console.log('\n🎉 All API tests passed!');

  } catch (error) {
    console.error('❌ API test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

// Run if called directly
if (require.main === module) {
  testAPI();
}

module.exports = { testAPI };