# 🧪 Quick Test Reference

## Local Testing Commands

```bash
# Run smoke tests
npm test

# Alternative
npm run test:smoke

# Start server (required for tests)
npm start

# Run on custom port
PORT=8080 npm start
```

## GitHub Actions Workflows

### ✅ Automatic Triggers
- Push to `main` or `develop` branch
- Pull Request to `main` or `develop` branch
- Daily at 2 AM UTC (advanced-tests.yml only)

### 📊 What Gets Tested Automatically

| Test | Command | Purpose |
|------|---------|---------|
| Syntax Check | `node -c server.js` | Validate JavaScript |
| Dependencies | `npm ci` | Install locked versions |
| Server Startup | `npm start` | Can server start? |
| Root Endpoint | `curl http://localhost:3000/` | Language selector works |
| English Docs | `curl http://localhost:3000/api/en` | Swagger UI accessible |
| Chinese Docs | `curl http://localhost:3000/api/zh_cn` | Chinese UI accessible |
| Ping Endpoint | `POST /ping` | API endpoint callable |
| Invalid Routes | `curl /invalid` | 404 handling works |
| JSON Validation | `JSON.parse(swagger.json)` | File integrity check |
| Multi-Version | Node 14/16/18/20 | Compatibility testing |
| Security | `npm audit` | Vulnerability scan |

## Test Files

| File | Type | Purpose |
|------|------|---------|
| `test/smoke.test.js` | Smoke Tests | Basic functionality (5 tests) |
| `.github/workflows/node.js.yml` | CI Workflow | Quick build & test |
| `.github/workflows/advanced-tests.yml` | CI Workflow | Comprehensive testing |

## View Results

### GitHub UI
1. Go to **Actions** tab
2. Select workflow run
3. Click job to see details
4. Check "Summary" for overview

### Terminal
```bash
# Check workflow files syntax
yamllint .github/workflows/*.yml

# View last run (if git-installed)
git log --oneline | head -5
```

## Test Output Example

```
✅ Server is running
✅ English API docs are accessible
✅ Chinese API docs are accessible
✅ Ping endpoint responds to POST
✅ Invalid routes return 404

📊 Test Results: 5 passed, 0 failed out of 5 tests
```

## Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| Tests timeout | Increase timeout in smoke.test.js |
| "Cannot find module" | Run `npm ci` to clean install |
| Port in use | Use `PORT=3001 npm start` |
| Server won't start | Check `server.js` syntax: `node -c server.js` |
| Workflow not running | Check `.github/workflows/` file syntax |

## Files Changed by CI/CD Setup

```
Created:
✓ .github/workflows/node.js.yml
✓ .github/workflows/advanced-tests.yml
✓ test/smoke.test.js
✓ TESTING.md
✓ CI_CD_SUMMARY.md

Modified:
✓ package.json (added test scripts)
```

## Next Time You Push

```
1. Make changes to code
2. Commit and push to GitHub
3. GitHub automatically:
   ✓ Runs workflows in parallel
   ✓ Tests on 4 Node versions
   ✓ Checks security
   ✓ Reports status in PR
4. View results in Actions tab
```

## Status Badges

Add to README.md:

```markdown
[![Node.js CI](https://github.com/DynastyKids/NodeJS-MongoReflector/workflows/Node.js%20CI/badge.svg)](https://github.com/DynastyKids/NodeJS-MongoReflector/actions/workflows/node.js.yml)

[![Advanced Tests](https://github.com/DynastyKids/NodeJS-MongoReflector/workflows/Advanced%20Node.js%20Tests/badge.svg)](https://github.com/DynastyKids/NodeJS-MongoReflector/actions/workflows/advanced-tests.yml)
```

---

**Need more details?** → See [TESTING.md](./TESTING.md) or [CI_CD_SUMMARY.md](./CI_CD_SUMMARY.md)
