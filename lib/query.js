/**
 * Turns JSON from the request body into values for the MongoDB driver.
 *
 * Extended JSON: only single-key type wrappers are converted, e.g.
 *   {"$oid": "..."}  {"$date": "..."}  {"$numberDecimal": "..."}
 * Query operators are never touched. (bson's own EJSON.deserialize is not used
 * on whole queries because it rewrites {$regex, $options, ...} and drops the
 * other operators next to it, which would change existing queries.)
 */
const { BSON } = require('mongodb');
const { badRequest, forbidden } = require('./errors');

const TYPE_WRAPPERS = new Set([
    '$oid', '$date', '$numberDecimal', '$numberLong', '$numberInt', '$numberDouble',
    '$binary', '$uuid', '$timestamp', '$regularExpression', '$minKey', '$maxKey'
]);

// Operators that run JavaScript on the database server.
const SERVER_JS_OPERATORS = new Set(['$where', '$function', '$accumulator']);

const MAX_DEPTH = 100; // BSON's own nesting limit

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/**
 * Legacy string form "RegExp(pattern, flags)".
 * Old behaviour split on every comma, so patterns containing commas threw.
 * Now only a trailing ", <flags>" is treated as flags.
 */
function parseRegExpString(value) {
    if (!value.startsWith('RegExp(')) return undefined;
    const match = value.match(/^RegExp\((.*)\)$/);
    if (!match) return undefined;
    const inner = match[1];
    let pattern = inner.trim();
    let flags = '';
    const comma = inner.lastIndexOf(',');
    if (comma !== -1) {
        const maybeFlags = inner.slice(comma + 1).trim();
        if (/^[dgimsuy]*$/.test(maybeFlags)) {
            pattern = inner.slice(0, comma).trim();
            flags = maybeFlags;
        }
    }
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        throw badRequest(`Invalid RegExp string "${value}": ${e.message}`);
    }
}

function setOwn(target, key, value) {
    // Keeps a JSON key named "__proto__" as plain data instead of changing
    // the object's prototype.
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function convert(value, ctx, depth) {
    if (depth > MAX_DEPTH) throw badRequest('Request is nested too deeply.');

    if (Array.isArray(value)) {
        return value.map(v => convert(v, ctx, depth + 1));
    }

    if (isPlainObject(value)) {
        const keys = Object.keys(value);

        if (ctx.ejson && keys.length === 1 && TYPE_WRAPPERS.has(keys[0])) {
            let parsed;
            try {
                parsed = BSON.EJSON.deserialize(value, { relaxed: false });
            } catch (e) {
                throw badRequest(`Invalid Extended JSON value for ${keys[0]}: ${e.message}`);
            }
            if (parsed instanceof Date && Number.isNaN(parsed.getTime())) {
                throw badRequest(`Invalid date in ${JSON.stringify(value)}`);
            }
            return parsed;
        }

        const out = {};
        for (const key of keys) {
            if (ctx.blockServerJs && SERVER_JS_OPERATORS.has(key)) {
                throw forbidden(`Operator ${key} runs JavaScript on the database server and is disabled. Set ALLOW_SERVER_SIDE_JS=true to enable it.`);
            }
            setOwn(out, key, convert(value[key], ctx, depth + 1));
        }
        return out;
    }

    if (typeof value === 'string' && ctx.regexStrings) {
        const re = parseRegExpString(value);
        return re === undefined ? value : re;
    }

    return value;
}

function createParsers(cfg) {
    const blockServerJs = !cfg.allowServerSideJs;
    const filterCtx = { ejson: cfg.parseEjson, regexStrings: true, blockServerJs };
    const exprCtx = { ejson: cfg.parseEjson, regexStrings: false, blockServerJs };
    const docCtx = { ejson: cfg.parseEjson, regexStrings: false, blockServerJs: false };

    return {
        /** Query filter. Non-objects become {} (old behaviour). */
        filter(value) {
            if (!isPlainObject(value)) return {};
            return convert(value, filterCtx, 0);
        },
        /** Update document or pipeline-style update. */
        update(value) {
            return convert(value, exprCtx, 0);
        },
        /** Documents to insert / replacement documents. */
        document(value) {
            return convert(value, docCtx, 0);
        },
        /** Aggregation pipeline. */
        pipeline(value) {
            return convert(value, exprCtx, 0);
        },
        /**
         * Driver options object (projection, sort, collation, let, hint...).
         * Projections and `let` can hold expressions, so they get the same
         * operator checks. `session` cannot come from JSON and is dropped.
         */
        options(value) {
            if (!isPlainObject(value)) return {};
            const out = convert(value, exprCtx, 0);
            delete out.session;
            if (Array.isArray(out.arrayFilters)) {
                out.arrayFilters = value.arrayFilters.map(f => (isPlainObject(f) ? convert(f, filterCtx, 0) : f));
            }
            return out;
        }
    };
}

module.exports = { createParsers, isPlainObject, parseRegExpString, SERVER_JS_OPERATORS };
