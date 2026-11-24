const config = require('./lib/config'); // loads .env first
const express = require('express');
const cors = require('cors');
const os = require('os');
const { BSON } = require('mongodb');

const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./api/swagger.json');
const swaggerDocumentZh = require('./api/swagger.zh_cn.json');

const { HttpError, badRequest, forbidden, redact, statusFor } = require('./lib/errors');
const { createPool } = require('./lib/mongo-pool');
const { assertClientUriAllowed } = require('./lib/uri-guard');
const { createParsers, isPlainObject } = require('./lib/query');
const { checkToken } = require('./lib/keypairs');
const { version: APP_VERSION } = require('./package.json');

const MAX_FIND_RESPONSE_BYTES = config.maxFindResponseBytes;
const MAX_PAGINATE_LENGTH = config.maxPaginateLength;
const MAX_DISTINCT_VALUES = config.maxDistinctValues;

const pool = createPool(config);
const parse = createParsers(config);

const app = express();
app.disable('x-powered-by');
if (config.trustProxy !== undefined) {
    const tp = config.trustProxy;
    app.set('trust proxy', /^\d+$/.test(tp) ? parseInt(tp, 10) : (tp === 'true' ? true : tp));
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'POST') res.setHeader('Cache-Control', 'no-store');
    next();
});

const CORS_ALLOWED_HEADERS = 'Origin, X-Requested-With, Content-Type, Accept, X-Api-Key, Authorization';
if (config.allowedOrigins.length > 0) {
    const allowAll = config.allowedOrigins.includes('*');
    app.use(cors({
        origin: allowAll ? '*' : config.allowedOrigins,
        methods: 'GET, POST, PUT, DELETE, OPTIONS',
        allowedHeaders: CORS_ALLOWED_HEADERS
    }));
} else {
    // Original behaviour: any origin.
    app.use(cors());
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
        next();
    });
}

// Optional per-IP rate limit for POST requests (RATE_LIMIT_PER_MINUTE).
if (config.rateLimitPerMinute > 0) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [ip, h] of hits) if (h.resetAt <= now) hits.delete(ip);
    }, 60000).unref();

    app.use((req, res, next) => {
        if (req.method !== 'POST') return next();
        const now = Date.now();
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        let h = hits.get(ip);
        if (!h || h.resetAt <= now) {
            h = { count: 0, resetAt: now + 60000 };
            hits.set(ip, h);
        }
        h.count += 1;
        if (h.count > config.rateLimitPerMinute) {
            res.setHeader('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
            return res.status(429).json({ acknowledged: false, message: 'Too many requests' });
        }
        next();
    });
}

// ALLOW_PUBLIC_USE=false: every POST needs a token from ALLOWED_KEYPAIRS that
// has not expired, sent as X-Api-Key or Authorization: Bearer <token>.
// Expiry is checked on every request, so a key stops working the moment it
// expires without restarting the server.
if (!config.allowPublicUse) {
    const AUTH_MESSAGES = {
        missing: 'API key required: send it in the X-Api-Key header (or Authorization: Bearer <key>).',
        invalid: 'Invalid API key.',
        expired: 'API key has expired.'
    };
    app.use((req, res, next) => {
        if (req.method !== 'POST') return next();
        const auth = req.get('authorization') || '';
        const token = req.get('x-api-key') || (/^Bearer /i.test(auth) ? auth.slice(7).trim() : '');
        const check = checkToken(config.keypairs.entries, token);
        if (!check.ok) {
            return res.status(401).json({ acknowledged: false, message: AUTH_MESSAGES[check.reason] });
        }
        res.locals.apiUser = check.user;
        next();
    });
}

app.use(express.json({ limit: config.bodyLimit }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function body(req) {
    return isPlainObject(req.body) ? req.body : {};
}

function isNonEmptyString(v) {
    return typeof v === 'string' && v.length > 0;
}

function assertNames(dbName, collectionName) {
    if (!isNonEmptyString(dbName) || !isNonEmptyString(collectionName)) {
        throw badRequest('dbName and collectionName must be non-empty strings.');
    }
    if (dbName.includes('\0') || collectionName.includes('\0')) {
        throw badRequest('dbName and collectionName must not contain null characters.');
    }
}

/** Picks the connection string for a request and checks it is allowed. */
function resolveUri(mongoURI) {
    if (mongoURI !== undefined && mongoURI !== null && mongoURI !== '') {
        if (typeof mongoURI !== 'string') throw badRequest('mongoURI must be a string.');
        if (!config.allowClientMongoURI) {
            throw forbidden('This server does not accept mongoURI from requests.');
        }
        if (!/^mongodb(\+srv)?:\/\//i.test(mongoURI)) {
            throw badRequest('mongoURI must start with mongodb:// or mongodb+srv://');
        }
        return { uri: mongoURI, validate: () => assertClientUriAllowed(mongoURI, config) };
    }
    if (config.defaultMongoURI) {
        return { uri: config.defaultMongoURI, validate: null };
    }
    throw badRequest('mongoURI is required.');
}

async function acquireClient(b) {
    const { uri, validate } = resolveUri(b.mongoURI);
    return pool.acquire(uri, validate);
}

/** Runs fn(collection, client) with a pooled client for this request. */
async function withCollection(b, fn) {
    assertNames(b.dbName, b.collectionName);
    const lease = await acquireClient(b);
    try {
        return await fn(lease.client.db(b.dbName).collection(b.collectionName), lease.client);
    } finally {
        lease.release();
    }
}

function applyMaxTime(options) {
    if (config.maxTimeMS > 0) {
        const requested = Number(options.maxTimeMS);
        options.maxTimeMS = Number.isFinite(requested) && requested > 0
            ? Math.min(requested, config.maxTimeMS)
            : config.maxTimeMS;
    }
    return options;
}

/** Old code treated any truthy value as true; the strings "false"/"0" now mean false. */
function truthy(value) {
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        return !(v === '' || v === 'false' || v === '0');
    }
    return !!value;
}

/** Sends JSON; when the request asks for responseFormat "ejson", types are kept as Extended JSON. */
function send(req, res, payload) {
    if (body(req).responseFormat === 'ejson') {
        return res.json(BSON.EJSON.serialize(payload, { relaxed: true }));
    }
    return res.json(payload);
}

function estimateJsonBytes(value) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

async function collectCursorWithLimit(cursor, maxBytes, maxItems = Number.POSITIVE_INFINITY, mapper = value => value) {
    const items = [];
    let payloadBytes = 0;
    let scanned = 0;
    let truncated = false;

    try {
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            scanned += 1;

            const mapped = mapper(doc);
            const itemBytes = estimateJsonBytes(mapped) + 1;

            if (items.length >= maxItems) {
                truncated = true;
                break;
            }

            if (items.length > 0 && (payloadBytes + itemBytes) > maxBytes) {
                truncated = true;
                break;
            }

            if (items.length === 0 && itemBytes > maxBytes) {
                truncated = true;
                break;
            }

            items.push(mapped);
            payloadBytes += itemBytes;
        }
    } finally {
        await cursor.close();
    }

    return { items, payloadBytes, scanned, truncated };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSafeFieldPath(name) {
    return name !== undefined && name !== null && name !== '' && !String(name).startsWith('$');
}

function isValidUpdate(update) {
    return isPlainObject(update) || (Array.isArray(update) && update.length > 0 && update.every(isPlainObject));
}

// Get local IP address
function getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        const iface = interfaces[interfaceName];
        for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Read-only mode
// ---------------------------------------------------------------------------

const WRITE_ROUTES = [
    '/insert', '/insertTimeSeries', '/timeseries_insert',
    '/update', '/updateOne', '/replaceOne',
    '/delete', '/deleteTimeseries', '/delete_timeseries',
    '/deleteTimeseries_legacy', '/delete_timeseries_legacy', '/timeseries_delete',
    '/findOneAndUpdate', '/findOneAndReplace', '/findOneAndDelete', '/bulkWrite'
];
if (config.readOnly) {
    app.post(WRITE_ROUTES, (req, res) => {
        res.status(403).json({ acknowledged: false, message: 'This server is in read-only mode.' });
    });
}

// ---------------------------------------------------------------------------
// Docs and health
// ---------------------------------------------------------------------------

app.get('/test', (req, res) => {
    res.json({
        name: 'MONGOREFLECTOR',
        test: 'OK',
        version: APP_VERSION
    });
});

const LANDING_PAGE = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>API文档 / API Documentation</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: sans-serif; padding: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                h1 { color: #333; text-align: center; margin-bottom: 30px; }
                .selector { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
                .lang-btn { padding: 15px 30px; font-size: 16px; border: 2px solid #4CAF50; background: white; color: #4CAF50; border-radius: 5px; cursor: pointer; text-decoration: none; transition: all 0.3s; font-weight: bold; }
                .lang-btn:hover { background: #4CAF50; color: white; }
                .info { margin-top: 30px; padding: 15px; background: #f0f0f0; border-left: 4px solid #4CAF50; border-radius: 4px; }
                .info p { margin: 8px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Mongo Reflector</h1>
                <h1>🌐 API Documentation Language / 选择语言 : </h1>
                <div class="selector">
                    <a href="/api/zh_cn" class="lang-btn">中文 🇨🇳</a>
                    <a href="/api/en" class="lang-btn">English 🇬🇧</a>
                </div>
            </div>
        </body>
        </html>
    `;

app.get('/', (req, res) => res.send(LANDING_PAGE));
app.get('/api', (req, res) => res.send(LANDING_PAGE));

app.use('/api/en', swaggerUi.serve, (req, res) => {
    swaggerUi.setup(swaggerDocument, {
        explorer: true,
        customSiteTitle: 'MongoReflector API Documentation'
    })(req, res);
});

app.use('/api/zh_cn', swaggerUi.serve, (req, res) => {
    swaggerUi.setup(swaggerDocumentZh, {
        explorer: true,
        customSiteTitle: 'MongoReflector 文档'
    })(req, res);
});

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

app.post('/ping', asyncHandler(async (req, res) => {
    const b = body(req);
    const { dbName, collectionName } = b;
    if (!dbName || !collectionName || (!b.mongoURI && !config.defaultMongoURI)) {
        return res.status(400).json({ acknowledged: false, message: 'Missing params' });
    }
    await withCollection(b, async (collection, client) => {
        await client.db(dbName).command({ ping: 1 });
    });
    res.json({ acknowledged: true, message: 'Cloud connection successful' });
}));

app.post('/find', asyncHandler(async (req, res) => {
    const b = body(req);
    const filter = parse.filter(b.query);
    const findOptions = applyMaxTime(parse.options(b.options));

    const out = await withCollection(b, collection =>
        collectCursorWithLimit(collection.find(filter, findOptions), MAX_FIND_RESPONSE_BYTES));

    send(req, res, {
        acknowledged: true,
        results: out.items,
        truncated: out.truncated,
        maxPayloadBytes: MAX_FIND_RESPONSE_BYTES,
        payloadBytes: out.payloadBytes,
        scanned: out.scanned
    });
}));

app.post('/findOne', asyncHandler(async (req, res) => {
    const b = body(req);
    const filter = parse.filter(b.query);
    const options = applyMaxTime(parse.options(b.options));
    const result = await withCollection(b, collection => collection.findOne(filter, options));
    send(req, res, { acknowledged: true, result });
}));

app.post('/count', asyncHandler(async (req, res) => {
    const b = body(req);
    const options = applyMaxTime(parse.options(b.options));
    const count = await withCollection(b, collection => (truthy(b.estimated)
        ? collection.estimatedDocumentCount(options)
        : collection.countDocuments(parse.filter(b.query), options)));
    send(req, res, { acknowledged: true, count });
}));

app.post('/aggregate', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!Array.isArray(b.pipeline) || !b.pipeline.every(isPlainObject)) {
        return res.status(400).json({ acknowledged: false, message: 'pipeline must be an array of stage objects.' });
    }
    const pipeline = parse.pipeline(b.pipeline);
    for (const stage of pipeline) {
        const name = Object.keys(stage)[0];
        if ((name === '$out' || name === '$merge') && (config.readOnly || !config.allowAggregateWrites)) {
            throw forbidden(`${name} writes data and is disabled for /aggregate. Set ALLOW_AGGREGATE_WRITES=true to enable it.`);
        }
    }
    const options = applyMaxTime(parse.options(b.options));

    const out = await withCollection(b, collection =>
        collectCursorWithLimit(collection.aggregate(pipeline, options), MAX_FIND_RESPONSE_BYTES));

    send(req, res, {
        acknowledged: true,
        results: out.items,
        truncated: out.truncated,
        maxPayloadBytes: MAX_FIND_RESPONSE_BYTES,
        payloadBytes: out.payloadBytes,
        scanned: out.scanned
    });
}));

// DataTables server-side processing
const paginateFind = asyncHandler(async (req, res) => {
    const b = body(req);
    const { query, start, length, order, search, columns } = b;
    const skip = Math.max(parseInt(start, 10) || 0, 0);
    const parsedLength = parseInt(length, 10);
    // DataTables sends length -1 for "show all"; cap it at the max page size.
    const requestedLength = parsedLength === -1 ? MAX_PAGINATE_LENGTH : (parsedLength || 10);
    const limit = Math.min(Math.max(requestedLength, 1), MAX_PAGINATE_LENGTH);
    let filter = parse.filter(query);
    const normalizedColumns = Array.isArray(columns) ? columns : [];

    // Global search across columns
    const searchValue = search && search.value ? String(search.value) : '';
    if (searchValue) {
        const searchColumns = normalizedColumns.filter(c => c && isSafeFieldPath(c.data));
        if (searchColumns.length > 0) {
            let searchRegex;
            try {
                searchRegex = new RegExp(searchValue, 'i');
            } catch {
                // Not a valid pattern: search for the literal text instead of failing.
                searchRegex = new RegExp(escapeRegExp(searchValue), 'i');
            }
            const searchOr = searchColumns.map(c => ({ [String(c.data)]: searchRegex }));
            // Keep an existing $or in the base query instead of overwriting it.
            filter = filter.$or ? { $and: [filter, { $or: searchOr }] } : { ...filter, $or: searchOr };
        }
    }

    // Sorting (all order entries, in order)
    const sort = {};
    if (Array.isArray(order) && normalizedColumns.length > 0) {
        for (const o of order) {
            if (!o) continue;
            const colName = normalizedColumns[parseInt(o.column, 10)]?.data;
            if (isSafeFieldPath(colName) && !(colName in sort)) {
                sort[colName] = o.dir === 'asc' ? 1 : -1;
            }
        }
    }

    const maxTime = applyMaxTime({});
    const [pageData, total, filteredTotal] = await withCollection(b, collection => Promise.all([
        collectCursorWithLimit(
            collection.find(filter, maxTime).sort(sort).skip(skip).limit(limit),
            MAX_FIND_RESPONSE_BYTES,
            limit
        ),
        collection.countDocuments({}, maxTime),
        collection.countDocuments(filter, maxTime)
    ]));

    send(req, res, {
        draw: parseInt(b.draw, 10) || 1,
        recordsTotal: total,
        recordsFiltered: filteredTotal,
        data: pageData.items,
        truncated: pageData.truncated,
        maxPayloadBytes: MAX_FIND_RESPONSE_BYTES,
        payloadBytes: pageData.payloadBytes,
        scanned: pageData.scanned,
        effectiveLength: limit
    });
});
app.post(['/paginatefind', '/datatables_paginatefind'], paginateFind);

app.post('/distinct_field', asyncHandler(async (req, res) => {
    const b = body(req);
    const { field_name } = b;
    if (!field_name || typeof field_name !== 'string') {
        return res.status(400).json({ acknowledged: false, message: 'field_name is required' });
    }
    if (field_name.startsWith('$')) {
        return res.status(400).json({ acknowledged: false, message: 'field_name must not start with $' });
    }
    const safeQuery = parse.filter(b.query);

    const distinctData = await withCollection(b, collection => collectCursorWithLimit(
        collection.aggregate([
            { $match: safeQuery },
            { $group: { _id: `$${field_name}` } },
            { $project: { _id: 0, value: '$_id' } }
        ], applyMaxTime({ allowDiskUse: true })),
        MAX_FIND_RESPONSE_BYTES,
        MAX_DISTINCT_VALUES,
        doc => doc.value
    ));

    send(req, res, {
        acknowledged: true,
        results: distinctData.items,
        truncated: distinctData.truncated,
        maxPayloadBytes: MAX_FIND_RESPONSE_BYTES,
        payloadBytes: distinctData.payloadBytes,
        scanned: distinctData.scanned,
        maxValues: MAX_DISTINCT_VALUES
    });
}));

// ---------------------------------------------------------------------------
// Write endpoints
// ---------------------------------------------------------------------------

function hasTarget(b) {
    return (b.mongoURI || config.defaultMongoURI) && b.dbName && b.collectionName;
}

const insertTimeSeries = asyncHandler(async (req, res) => {
    const b = body(req);
    const { timeField } = b;
    if (!hasTarget(b) || !b.documents) {
        return res.status(400).json({
            acknowledged: false,
            message: 'Please provide mongoURI, dbName, collectionName, timeField, documents and options(not mandatory).'
        });
    }
    const docs = parse.document(b.documents);
    const list = Array.isArray(docs) ? docs : [docs];
    if (list.length === 0 || !list.every(isPlainObject)) {
        throw badRequest('documents must be an object or a non-empty array of objects.');
    }

    if (timeField !== undefined && timeField !== null) {
        if (!isPlainObject(timeField) || !isNonEmptyString(timeField.name)) {
            throw badRequest('timeField must be an object like { "name": "timestamp", "val": "2026-01-18T10:30:00Z" }.');
        }
        const time = timeField.val === undefined || timeField.val === null ? new Date() : new Date(timeField.val);
        if (Number.isNaN(time.getTime())) throw badRequest('timeField.val is not a valid date.');
        for (const d of list) {
            Object.defineProperty(d, timeField.name, { value: time, enumerable: true, writable: true, configurable: true });
        }
    }

    const options = parse.options(b.options);
    const result = await withCollection(b, collection => (Array.isArray(docs)
        ? collection.insertMany(list, options)
        : collection.insertOne(list[0], options)));

    send(req, res, { acknowledged: true, result });
});
app.post(['/insertTimeSeries', '/timeseries_insert'], insertTimeSeries);

app.post('/insert', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !b.documents) {
        return res.status(400).json({
            acknowledged: false,
            message: 'Please provide mongoURI, dbName, collectionName, documents and options(not mandatory).'
        });
    }
    const docs = parse.document(b.documents);
    if (Array.isArray(docs) ? !docs.every(isPlainObject) : !isPlainObject(docs)) {
        throw badRequest('documents must be an object or an array of objects.');
    }
    const options = parse.options(b.options);
    const result = await withCollection(b, collection => (Array.isArray(docs)
        ? collection.insertMany(docs, options)
        : collection.insertOne(docs, options)));

    send(req, res, { acknowledged: true, result });
}));

app.get('/insert', (req, res) => {
    res.json({
        description: 'Example request to insert multiple data from MongoDB.',
        method: 'POST',
        url: '/insert',
        requestBody: {
            mongoURI: 'mongodb://localhost:27017 [string, Mandatory]',
            dbName: 'testDB [string, Mandatory]',
            collectionName: 'testCollection [string, Mandatory]',
            documents: ['values'],
            options: {
                field: 'values'
            }
        }
    });
});

function updateResponse(result, message) {
    return {
        acknowledged: true,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount || 0,
        upsertedId: result.upsertedId || null,
        message
    };
}

// updateMany; upsert is on unless explicitly turned off (original behaviour).
app.post('/update', asyncHandler(async (req, res) => {
    const b = body(req);
    const { query, update, upsert } = b;

    if (!hasTarget(b) || !query || !update) {
        return res.status(400).json({
            acknowledged: false,
            message: 'Please provide mongoURI, dbName, collectionName, query, and update.'
        });
    }
    if (!isPlainObject(query)) {
        return res.status(400).json({ acknowledged: false, message: 'query must be a JSON object.' });
    }
    if (!isValidUpdate(update)) {
        return res.status(400).json({ acknowledged: false, message: 'update must be a JSON object (or an aggregation pipeline array).' });
    }

    const safeQuery = parse.filter(query);
    if (Object.keys(safeQuery).length === 0) {
        return res.status(400).json({ acknowledged: false, message: 'query cannot be an empty object for /update.' });
    }

    const parsedOptions = parse.options(b.options);
    const rawUpsert = (isPlainObject(b.options) ? b.options.upsert : undefined) ?? upsert;
    const isExplicitFalse = rawUpsert === false || (typeof rawUpsert === 'string' && rawUpsert.trim().toLowerCase() === 'false');
    parsedOptions.upsert = !isExplicitFalse;

    const result = await withCollection(b, collection =>
        collection.updateMany(safeQuery, parse.update(update), parsedOptions));

    send(req, res, updateResponse(result, 'Update operation successful'));
}));

app.get('/update', (req, res) => {
    res.json({
        description: 'Example request to update data in MongoDB',
        method: 'POST',
        url: '/update',
        requestBody: {
            mongoURI: 'mongodb://your-mongo-uri',
            dbName: 'your-database-name',
            collectionName: 'your-collection-name',
            query: {
                field: 'value'
            },
            update: {
                '$set': { 'fieldToUpdate': 'newValue' }
            },
            options: {
                upsert: true
            }
        }
    });
});

// updateOne with MongoDB's own defaults (upsert only if options.upsert is true).
app.post('/updateOne', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !isPlainObject(b.query) || !isValidUpdate(b.update)) {
        throw badRequest('Please provide mongoURI, dbName, collectionName, query (object) and update (object or pipeline array).');
    }
    const result = await withCollection(b, collection =>
        collection.updateOne(parse.filter(b.query), parse.update(b.update), parse.options(b.options)));
    send(req, res, updateResponse(result, 'Update operation successful'));
}));

app.post('/replaceOne', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !isPlainObject(b.query) || !isPlainObject(b.replacement)) {
        throw badRequest('Please provide mongoURI, dbName, collectionName, query (object) and replacement (object).');
    }
    const result = await withCollection(b, collection =>
        collection.replaceOne(parse.filter(b.query), parse.document(b.replacement), parse.options(b.options)));
    send(req, res, updateResponse(result, 'Replace operation successful'));
}));

function findAndModifyOptions(b) {
    const options = applyMaxTime(parse.options(b.options));
    options.includeResultMetadata = false;
    return options;
}

app.post('/findOneAndUpdate', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !isPlainObject(b.query) || !isValidUpdate(b.update)) {
        throw badRequest('Please provide mongoURI, dbName, collectionName, query (object) and update (object or pipeline array).');
    }
    const result = await withCollection(b, collection =>
        collection.findOneAndUpdate(parse.filter(b.query), parse.update(b.update), findAndModifyOptions(b)));
    send(req, res, { acknowledged: true, result });
}));

app.post('/findOneAndReplace', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !isPlainObject(b.query) || !isPlainObject(b.replacement)) {
        throw badRequest('Please provide mongoURI, dbName, collectionName, query (object) and replacement (object).');
    }
    const result = await withCollection(b, collection =>
        collection.findOneAndReplace(parse.filter(b.query), parse.document(b.replacement), findAndModifyOptions(b)));
    send(req, res, { acknowledged: true, result });
}));

app.post('/findOneAndDelete', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !isPlainObject(b.query)) {
        throw badRequest('Please provide mongoURI, dbName, collectionName and query (object).');
    }
    const result = await withCollection(b, collection =>
        collection.findOneAndDelete(parse.filter(b.query), findAndModifyOptions(b)));
    send(req, res, { acknowledged: true, result });
}));

const BULK_OPS = new Set(['insertOne', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany']);

function parseBulkOperation(op, index) {
    const keys = isPlainObject(op) ? Object.keys(op) : [];
    const name = keys[0];
    if (keys.length !== 1 || !BULK_OPS.has(name) || !isPlainObject(op[name])) {
        throw badRequest(`operations[${index}] must be one of: ${[...BULK_OPS].join(', ')}.`);
    }
    const spec = op[name];
    if (name === 'insertOne') {
        if (!isPlainObject(spec.document)) throw badRequest(`operations[${index}].insertOne.document must be an object.`);
        return { insertOne: { document: parse.document(spec.document) } };
    }
    if (!isPlainObject(spec.filter)) throw badRequest(`operations[${index}].${name}.filter must be an object.`);
    const out = { ...spec, filter: parse.filter(spec.filter) };
    if (name === 'updateOne' || name === 'updateMany') {
        if (!isValidUpdate(spec.update)) throw badRequest(`operations[${index}].${name}.update must be an object or pipeline array.`);
        out.update = parse.update(spec.update);
        if (Array.isArray(spec.arrayFilters)) {
            out.arrayFilters = spec.arrayFilters.map(f => parse.filter(f));
        }
    }
    if (name === 'replaceOne') {
        if (!isPlainObject(spec.replacement)) throw badRequest(`operations[${index}].replaceOne.replacement must be an object.`);
        out.replacement = parse.document(spec.replacement);
    }
    for (const key of ['collation', 'hint']) {
        if (spec[key] !== undefined) out[key] = parse.update(spec[key]);
    }
    return { [name]: out };
}

app.post('/bulkWrite', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !Array.isArray(b.operations) || b.operations.length === 0) {
        throw badRequest('Please provide mongoURI, dbName, collectionName and a non-empty operations array.');
    }
    const operations = b.operations.map(parseBulkOperation);
    const options = parse.options(b.options);
    const result = await withCollection(b, collection => collection.bulkWrite(operations, options));
    send(req, res, {
        acknowledged: true,
        insertedCount: result.insertedCount,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
        upsertedCount: result.upsertedCount,
        insertedIds: result.insertedIds,
        upsertedIds: result.upsertedIds
    });
}));

// ---------------------------------------------------------------------------
// Delete endpoints
// ---------------------------------------------------------------------------

app.post('/delete', asyncHandler(async (req, res) => {
    const b = body(req);
    if (!hasTarget(b) || !b.query) {
        return res.status(400).json({ acknowledged: false, message: 'Please provide mongoURI, dbName, collectionName, and query.' });
    }
    if (!isPlainObject(b.query)) {
        return res.status(400).json({ acknowledged: false, message: 'query must be a JSON object.' });
    }
    const filter = parse.filter(b.query);
    const result = await withCollection(b, collection => (truthy(b.multi)
        ? collection.deleteMany(filter)
        : collection.deleteOne(filter)));

    send(req, res, {
        acknowledged: true,
        deletedCount: result.deletedCount,
        message: `Delete operation successful, deleted ${result.deletedCount} record(s)`
    });
}));

/** Adds the optional { name, start, end } time range to a filter. */
function withTimeRange(filter, timeField) {
    if (!isPlainObject(timeField) || (!timeField.start && !timeField.end)) return filter;
    const name = isNonEmptyString(timeField.name) ? timeField.name : 'timestamp';
    const range = {};
    for (const [key, op] of [['start', '$gte'], ['end', '$lte']]) {
        if (!timeField[key]) continue;
        const d = new Date(timeField[key]);
        if (Number.isNaN(d.getTime())) throw badRequest(`timeField.${key} is not a valid date.`);
        range[op] = d;
    }
    return filter[name] === undefined ? { ...filter, [name]: range } : { $and: [filter, { [name]: range }] };
}

function requireDeleteParams(b, res) {
    if (!hasTarget(b) || !b.query) {
        res.status(400).json({ acknowledged: false, message: 'Please provide mongoURI, dbName, collectionName, and query.' });
        return false;
    }
    if (!isPlainObject(b.query)) {
        res.status(400).json({ acknowledged: false, message: 'query must be a JSON object.' });
        return false;
    }
    return true;
}

const deleteTimeseries = asyncHandler(async (req, res) => {
    const b = body(req);
    if (!requireDeleteParams(b, res)) return;
    const filter = withTimeRange(parse.filter(b.query), b.timeField);
    const result = await withCollection(b, collection => (truthy(b.multi)
        ? collection.deleteMany(filter)
        : collection.deleteOne(filter)));

    send(req, res, {
        acknowledged: true,
        deletedCount: result.deletedCount,
        message: `Delete operation successful, deleted ${result.deletedCount} record(s) from TimeSeries collection`
    });
});
app.post(['/deleteTimeseries', '/delete_timeseries'], deleteTimeseries);

// Legacy (MongoDB 6 compatible): deletes matching documents one by one.
const deleteTimeseriesLegacy = asyncHandler(async (req, res) => {
    const b = body(req);
    if (!requireDeleteParams(b, res)) return;
    const filter = withTimeRange(parse.filter(b.query), b.timeField);

    const counts = await withCollection(b, async collection => {
        const cursor = collection.find(filter, { projection: { _id: 1 } });
        let totalCount = 0;
        let deletedCount = 0;
        let failedCount = 0;
        try {
            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                totalCount++;
                try {
                    const result = await collection.deleteOne({ _id: doc._id });
                    if (result.deletedCount > 0) deletedCount++;
                } catch (deleteErr) {
                    console.error(`Failed to delete a document: ${redact(deleteErr.message)}`);
                    failedCount++;
                }
            }
        } finally {
            await cursor.close();
        }
        return { totalCount, deletedCount, failedCount };
    });

    send(req, res, {
        acknowledged: true,
        deletedCount: counts.deletedCount,
        failedCount: counts.failedCount,
        totalMatched: counts.totalCount,
        message: `Legacy delete operation successful, deleted ${counts.deletedCount}/${counts.totalCount} record(s) from TimeSeries collection${counts.failedCount > 0 ? `, ${counts.failedCount} failed` : ''}`
    });
});
app.post(['/deleteTimeseries_legacy', '/delete_timeseries_legacy', '/timeseries_delete'], deleteTimeseriesLegacy);

// ---------------------------------------------------------------------------
// 404 and error handling (must be registered after all routes)
// ---------------------------------------------------------------------------

app.use((req, res) => {
    res.status(404).json({ acknowledged: false, message: `Not found: ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = statusFor(err);
    const message = redact(err && err.message ? err.message : 'Internal Server Error');
    if (status >= 500) {
        console.error(`API error on ${req.method} ${req.path}: ${err && err.name}: ${message}`);
    }
    const payload = {
        acknowledged: false,
        message,
        timestamp: new Date().toISOString()
    };
    if (status >= 500) payload.status = 'Server error';
    if (err && err.code !== undefined && typeof err.code !== 'object') payload.code = err.code;
    if (err && err.codeName) payload.codeName = err.codeName;
    if (err && Array.isArray(err.writeErrors)) {
        payload.writeErrors = err.writeErrors.map(e => ({ index: e.index, code: e.code, errmsg: redact(e.errmsg) }));
    }
    res.status(status).json(payload);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function startupWarnings() {
    for (const w of config.keypairs.warnings) console.warn(`WARNING: ${w}`);
    if (config.allowPublicUseRaw && !/^(true|1|yes|on|false|0|no|off)$/i.test(config.allowPublicUseRaw)) {
        console.warn(`WARNING: ALLOW_PUBLIC_USE="${config.allowPublicUseRaw}" is not true/false; treating it as false.`);
    }
    if (config.allowPublicUse) {
        console.log('Access: public (ALLOW_PUBLIC_USE is not false).');
    } else {
        const now = Date.now();
        const active = config.keypairs.entries.filter(e => e.expiresAt > now);
        console.log(`Access: restricted to ALLOWED_KEYPAIRS (${active.length} active, ${config.keypairs.entries.length - active.length} expired).`);
        for (const e of config.keypairs.entries) {
            const soon = e.expiresAt > now && e.expiresAt - now < 7 * 24 * 3600 * 1000;
            if (soon) console.warn(`WARNING: key for user "${e.user}" expires ${new Date(e.expiresAt).toISOString()}.`);
        }
        if (active.length === 0) {
            console.warn('WARNING: ALLOW_PUBLIC_USE=false but no valid, unexpired keys in ALLOWED_KEYPAIRS. All POST requests will be refused.');
        }
    }
    if (config.defaultMongoURI && config.allowPublicUse) {
        console.warn('WARNING: DEFAULT_MONGO_URI is set while ALLOW_PUBLIC_USE is not false. Anyone who can reach this server can use that database.');
    }
    if (config.allowClientMongoURI && config.allowedMongoHosts.length === 0 && !config.blockPrivateHosts) {
        console.warn('NOTE: requests may connect to any host. Set ALLOWED_MONGO_HOSTS or BLOCK_PRIVATE_HOSTS=true for public deployments.');
    }
}

const server = app.listen(config.port, () => {
    const ipAddress = getLocalIPAddress();
    console.log(`API server running at http://${ipAddress}:${config.port}`);
    startupWarnings();
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${config.port} is in use, trying another port...`);
        const newServer = app.listen(0, () => {
            const newPort = newServer.address().port;
            console.log(`API server running at http://localhost:${newPort}`);
        });
    } else {
        console.error(`Server error: ${err.message}`);
    }
});

function shutdown() {
    server.close();
    pool.closeAll().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
