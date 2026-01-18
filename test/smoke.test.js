/**
 * Basic smoke tests for MongoDB Reflector API
 * These tests verify that the server can start and basic endpoints respond
 */

const http = require('http');

const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * Make a simple HTTP request
 */
function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const requestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      timeout: 5000
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Test suite
 */
const tests = {
  'Server is running': async () => {
    const response = await makeRequest('/');
    if (response.statusCode !== 200) {
      throw new Error(`Expected 200, got ${response.statusCode}`);
    }
    if (!response.body.includes('Mongo Reflector')) {
      throw new Error('Root page missing expected content');
    }
  },

  'English API docs are accessible': async () => {
    const response = await makeRequest('/api/en');
    if (response.statusCode !== 200) {
      throw new Error(`Expected 200, got ${response.statusCode}`);
    }
    if (!response.body.includes('swagger')) {
      throw new Error('API docs missing Swagger UI');
    }
  },

  'Chinese API docs are accessible': async () => {
    const response = await makeRequest('/api/zh_cn');
    if (response.statusCode !== 200) {
      throw new Error(`Expected 200, got ${response.statusCode}`);
    }
    if (!response.body.includes('swagger')) {
      throw new Error('Chinese API docs missing Swagger UI');
    }
  },

  'Ping endpoint responds to POST': async () => {
    const response = await makeRequest('/ping', {
      method: 'POST',
      body: {
        mongoURI: 'mongodb+srv://test:test@test.mongodb.net',
        dbName: 'test',
        collectionName: 'test'
      }
    });
    // Should fail due to invalid credentials, but endpoint should respond
    if (response.statusCode === 404) {
      throw new Error('Ping endpoint not found');
    }
  },

  'Invalid routes return 404': async () => {
    const response = await makeRequest('/invalid-route');
    if (response.statusCode !== 404) {
      throw new Error(`Expected 404 for invalid route, got ${response.statusCode}`);
    }
  }
};

/**
 * Run all tests
 */
async function runTests() {
  console.log('🧪 Running MongoDB Reflector API Tests\n');
  
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const [testName, testFn] of Object.entries(tests)) {
    try {
      await testFn();
      console.log(`✅ ${testName}`);
      passed++;
      results.push({ name: testName, status: 'PASS' });
    } catch (error) {
      console.log(`❌ ${testName}`);
      console.log(`   Error: ${error.message}\n`);
      failed++;
      results.push({ name: testName, status: 'FAIL', error: error.message });
    }
  }

  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);

  if (failed > 0) {
    console.error('Some tests failed!');
    process.exit(1);
  } else {
    console.log('All tests passed! ✨');
    process.exit(0);
  }
}

// Wait for server to be ready before running tests
setTimeout(() => {
  runTests().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
  });
}, 1000);
