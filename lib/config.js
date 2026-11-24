const fs = require('fs');
const path = require('path');
const { parseKeypairs } = require('./keypairs');

// Depth of [ ] / { } outside quoted strings, to find where a multi-line value ends.
function bracketDepth(text) {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') depth--;
    }
    return depth;
}

function loadDotEnv(envPath = path.resolve(__dirname, '..', '.env')) {
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (let n = 0; n < lines.length; n++) {
        const line = lines[n].trim();
        if (!line || line.startsWith('#')) continue;
        const [rawKey, ...rest] = line.split('=');
        const key = rawKey.trim();
        if (!key) continue;
        let value = rest.join('=').trim();
        // A value starting with [ or { may continue over several lines
        // (e.g. ALLOWED_KEYPAIRS); read until the brackets are balanced.
        if ((value.startsWith('[') || value.startsWith('{')) && bracketDepth(value) > 0) {
            while (n + 1 < lines.length && bracketDepth(value) > 0) {
                n++;
                value += '\n' + lines[n].trim();
            }
        }
        if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
            value = value.slice(1, -1);
        }
        if (!value) continue;
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

// Must run before any value below is read (previously the limits were read
// before .env was loaded, so setting them in .env had no effect).
loadDotEnv();

const env = process.env;

function positiveInt(name, fallback) {
    const v = parseInt(env[name], 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Like positiveInt, but 0 is a valid value (used for "disabled").
function nonNegativeInt(name, fallback) {
    const v = parseInt(env[name], 10);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function bool(name, fallback) {
    const v = env[name];
    if (v === undefined || v.trim() === '') return fallback;
    return /^(1|true|yes|on)$/i.test(v.trim());
}

function list(name) {
    return (env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
}

const config = {
    port: positiveInt('PORT', 3000),

    // Response limits (unchanged defaults)
    maxFindResponseBytes: positiveInt('MAX_FIND_RESPONSE_BYTES', 32 * 1024 * 1024),
    maxPaginateLength: positiveInt('MAX_PAGINATE_LENGTH', 500),
    maxDistinctValues: positiveInt('MAX_DISTINCT_VALUES', 10000),

    // Request / query limits
    bodyLimit: env.BODY_LIMIT || '1mb',
    maxTimeMS: nonNegativeInt('MAX_TIME_MS', 60000), // 0 = no server-side cap
    serverSelectionTimeoutMS: positiveInt('SERVER_SELECTION_TIMEOUT_MS', 10000),

    // Connection cache
    maxCachedClients: positiveInt('MAX_CACHED_CLIENTS', 50),
    clientIdleTimeoutMS: positiveInt('CLIENT_IDLE_TIMEOUT_MS', 10 * 60 * 1000),

    // Access control (all opt-in so existing deployments keep working)
    // ALLOW_PUBLIC_USE=false: only tokens listed in ALLOWED_KEYPAIRS (and not
    // expired) may call POST endpoints. Unset or true: public. An unrecognised
    // value (e.g. a typo) counts as false, so a mistake never opens the server.
    allowPublicUse: (() => {
        const v = (env.ALLOW_PUBLIC_USE || '').trim();
        return v === '' || /^(true|1|yes|on)$/i.test(v);
    })(),
    allowPublicUseRaw: (env.ALLOW_PUBLIC_USE || '').trim(),
    keypairs: parseKeypairs(env.ALLOWED_KEYPAIRS),
    allowedOrigins: list('ALLOWED_ORIGINS'),
    rateLimitPerMinute: nonNegativeInt('RATE_LIMIT_PER_MINUTE', 0),
    trustProxy: env.TRUST_PROXY,
    readOnly: bool('READ_ONLY', false),

    // Where requests may connect
    // DEFAULT_MONGO_URI (not MONGO_URI) on purpose: older README told people to
    // set MONGO_URI, and silently turning that into an open fallback would
    // expose their database.
    defaultMongoURI: env.DEFAULT_MONGO_URI || '',
    allowClientMongoURI: bool('ALLOW_CLIENT_MONGO_URI', true),
    allowedMongoHosts: list('ALLOWED_MONGO_HOSTS').map(h => h.toLowerCase()),
    blockPrivateHosts: bool('BLOCK_PRIVATE_HOSTS', false),
    allowUnsafeUriOptions: bool('ALLOW_UNSAFE_URI_OPTIONS', false),

    // Query features
    parseEjson: bool('EJSON_INPUT', true),
    allowServerSideJs: bool('ALLOW_SERVER_SIDE_JS', false),
    allowAggregateWrites: bool('ALLOW_AGGREGATE_WRITES', false)
};

module.exports = config;
module.exports.loadDotEnv = loadDotEnv;
