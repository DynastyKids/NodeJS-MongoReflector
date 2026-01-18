# Testing & CI/CD

This document describes the testing setup and CI/CD workflows for MongoDB Reflector.

## Local Testing

### Run Smoke Tests

Start the server in one terminal:

```bash
npm start
```

In another terminal, run the tests:

```bash
npm test
```

Or specifically:

```bash
npm run test:smoke
```

### Manual Server Testing

Start the server:

```bash
npm start
```

Test the endpoints:

```bash
# Test root page (with language selector)
curl http://localhost:3000/

# Test English API documentation
curl http://localhost:3000/api/en

# Test Chinese API documentation
curl http://localhost:3000/api/zh_cn

# Test ping endpoint (will fail without valid MongoDB URI)
curl -X POST http://localhost:3000/ping \
  -H "Content-Type: application/json" \
  -d '{
    "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
    "dbName": "test",
    "collectionName": "test"
  }'
```

## GitHub Actions Workflows

Two automated workflows are configured:

### 1. Node.js CI (`node.js.yml`)

**Triggers**: Push to `main`/`develop`, PR to `main`/`develop`

**Matrix Testing**:
- Node.js 14.x, 16.x, 18.x, 20.x

**Steps**:
1. Checkout code
2. Setup Node.js environment
3. Install dependencies with `npm ci`
4. Run linter (if available)
5. Run build (if available)
6. Run tests
7. Verify server startup
8. Check API endpoints
9. Generate summary report

**What it tests**:
- ✅ Dependencies installation
- ✅ Code syntax validation
- ✅ Server can start without errors
- ✅ Root endpoint (`/`) returns 200
- ✅ English API docs (`/api/en`) accessible
- ✅ Chinese API docs (`/api/zh_cn`) accessible

### 2. Advanced Node.js Tests (`advanced-tests.yml`)

**Triggers**: Push, PR, and daily schedule (2 AM UTC)

**Four parallel jobs**:

#### Job 1: Lint & Syntax Check
- Syntax validation with `node -c`
- Dependency verification

#### Job 2: Multi-Version Testing
- Tests on Node.js 14.x, 16.x, 18.x, 20.x
- Starts server and runs smoke tests
- Uploads server logs on failure

#### Job 3: Security & Dependencies
- Checks for vulnerabilities (`npm audit`)
- Identifies outdated packages
- Non-blocking (doesn't fail the build)

#### Job 4: Integration Tests
- Tests server startup on multiple ports (3000, 8080)
- Validates JSON syntax of Swagger files
- Verifies file integrity

#### Job 5: Build Summary
- Aggregates results from all jobs
- Generates final status report

## Test Files

### `test/smoke.test.js`

Lightweight smoke tests that verify:

1. **Server is running** - Root endpoint responds with 200
2. **English API docs** - Swagger UI loads correctly
3. **Chinese API docs** - Chinese documentation accessible
4. **Ping endpoint** - POST endpoint is callable
5. **Invalid routes** - 404 errors work correctly

Run with:
```bash
node test/smoke.test.js
```

## Continuous Integration Flow

```
┌─────────────────────────────────────────────┐
│  Push to main/develop or PR created          │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   node.js.yml          advanced-tests.yml
   (Basic CI)           (Comprehensive)
        │                       │
        ├─────────┬─────────┐   │
        │         │         │   │
      Test    Lint      Build  │
     Multi-   Check     (if    │
    Version            exist)  │
        │         │         │   │
        └────┬────┘         │   │
             ▼              │   │
        Tests Pass?         │   │
             │              │   │
        ┌────┴──────────────┴───┴────┐
        ▼                            ▼
    ✅ Build OK              ❌ Build Failed
        │                            │
        └────────┬────────────────────┘
                 ▼
        Artifacts & Reports
        (Logs, Summary, etc.)
```

## CI/CD Status

Check the status of workflows:

1. **GitHub**: Go to your repository → **Actions** tab
2. **Status badge**: Add to README:

```markdown
![Node.js CI](https://github.com/DynastyKids/NodeJS-MongoReflector/workflows/Node.js%20CI/badge.svg)
![Advanced Tests](https://github.com/DynastyKids/NodeJS-MongoReflector/workflows/Advanced%20Node.js%20Tests/badge.svg)
```

## Troubleshooting

### Tests fail with "Server timeout"

**Solution**: Increase timeout in test/smoke.test.js:
```javascript
timeout: 10000  // Increase from 5000 to 10000ms
```

### "Cannot find module" errors

**Solution**: 
```bash
npm ci  # Clean install dependencies
npm test
```

### Port already in use

**Solution**:
```bash
PORT=3001 npm start
```

### MongoDB connection in tests

The smoke tests don't require MongoDB - they only test HTTP endpoints. The Ping endpoint will fail without valid credentials, which is expected.

## Adding More Tests

1. Create test files in `test/` directory
2. Update `package.json` scripts:
```json
{
  "test": "node test/smoke.test.js && node test/other.test.js",
  "test:unit": "node test/unit.test.js",
  "test:integration": "node test/integration.test.js"
}
```

3. Update workflows to run your new tests

## Best Practices

✅ **Do**:
- Run tests locally before pushing
- Keep tests lightweight and fast
- Test critical functionality
- Use meaningful test names
- Handle errors gracefully

❌ **Don't**:
- Require external services (except in integration tests)
- Leave tests hanging/timing out
- Test implementation details
- Skip important checks

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Node.js Testing](https://nodejs.org/en/docs/guides/testing/)
- [npm Scripts](https://docs.npmjs.com/cli/v8/using-npm/scripts)

---

**Last Updated**: January 18, 2026  
**Version**: 1.0.0
