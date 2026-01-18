# Copilot Instructions for NodeJS-MongoReflector

## Project Overview
A lightweight MongoDB proxy API server that enables frontend-only applications to execute database operations without backend infrastructure. Deployed on Vercel/Render as serverless/containerized functions. Single-file architecture with Express.js handling all routing.

## Key Architecture Patterns

### Connection Pooling (In-Memory Cache)
- **Pattern**: `clientCache` (Map) in `server.js` caches MongoDB connections keyed by `mongoURI`
- **Purpose**: Reduces connection overhead across requests; avoid recreating connections
- **Exception**: `/ping` endpoint uses short-lived connections (no caching) for connectivity checks
- **Configuration**: `maxPoolSize: 10`, `serverSelectionTimeoutMS: 5000` (lines 20-27)
- **When adding endpoints**: Use `getMongoCollection(mongoURI, dbName, collectionName)` helper for cached access, or create new client for one-off operations

### Query Safety
- **Sanitization**: `sanitizeQuery()` (lines 50-61) handles RegExp string conversion (`"RegExp(...)"` → actual RegExp objects)
- **Scope**: Applied only to `/find` and `/paginatefind` endpoints; direct query params used elsewhere
- **Client responsibility**: Callers must pass valid MongoDB queries; no schema validation

### Async Error Handling
- **Decorator**: `asyncHandler` (lines 48-49) wraps route handlers to catch Promise rejections
- **Usage**: Used inconsistently—`/find`, `/ping`, `/distinct_field` use it; `/insert`, `/update`, `/delete` use try-catch
- **Consistency goal**: Migrate write operations to use `asyncHandler` to reduce code duplication

## API Endpoint Structure

### Response Format (Standard)
```json
{ "acknowledged": true, "results": [...] }  // Success
{ "acknowledged": false, "message": "..." }  // Error
```

### Paginated Queries (`/paginatefind`)
- Implements DataTables server-side pagination protocol
- Supports: `skip`/`limit`, global search (`$or` across columns), sorting
- Key params: `columns` (array with `.data` field), `order` (array with column index & direction)
- Returns: `{ draw, recordsTotal, recordsFiltered, data }`

### Operations Coverage
- **Read**: `/find` (basic), `/distinct_field`, `/paginatefind` (with pagination)
- **Write**: `/insert` (single/batch), `/insertTimeSeries`, `/update` (updateMany with upsert default)
- **Delete**: `/delete` (deleteOne/deleteMany via `multi` flag)
- **Utility**: `/ping` (connectivity), `/insert`, `/update`, `/delete` GET endpoints (examples)

## Deployment & Runtime

### Startup Behavior
- **Port**: Defaults to `process.env.PORT || 3000`
- **Auto-retry**: If port in use, automatically selects next available port (lines 388-397)
- **Entry point**: `server.js` (package.json main), started with `npm start`
- **Vercel config**: Routes all requests to `/server.js` with CORS headers pre-set

### Swagger Documentation
- Docs served at `/api` path using `swagger-ui-express`
- Spec files: `./swagger.json` (root) and `./api/swagger.json` (referenced but not used)
- Static files served from `node_modules/swagger-ui-dist`

## Common Modifications

### Adding a New Endpoint
1. **Choose connection pattern**: Cached via `getMongoCollection()` (reads/distinct) or new client (write operations)
2. **Wrap with handler**: Use `asyncHandler()` for consistency
3. **Validate params**: Check required `mongoURI`, `dbName`, `collectionName` at start
4. **Return acknowledged format**: Always include `{ acknowledged: boolean, ... }`
5. **Example**: See `/distinct_field` (lines 179-184) for minimal read endpoint

### Modifying Write Operations
- Current pattern: New `MongoClient` per request with try-catch (not using asyncHandler)
- Issue: `insertTimeSeries` modifies input `documents` object directly (line 197) — avoid side effects
- If migrating to `asyncHandler`: Remove try-catch, let decorator handle errors

### Debugging Connection Issues
- Add logging in `getMongoCollection()` to track cache hits/misses
- Check `serverSelectionTimeoutMS` if remote MongoDB connections timeout
- Verify `mongoURI` format: driver expects full connection string with protocol

## Dependencies & External Services
- **Express.js**: HTTP routing and middleware
- **MongoDB driver v6.9.0**: Native async/await support; ServerAPI v1 enforced
- **Swagger UI**: Documentation frontend (read-only)
- **CORS**: Pre-configured to allow all origins (`*`)
- **Vercel/Render**: Deployment targets; auto-scales based on traffic

## Testing Notes
- No test framework installed (`"test": "echo error"`)
- Manual testing recommended via Swagger UI at `/api` endpoint
- Cross-origin requests will be allowed from any domain due to CORS config
