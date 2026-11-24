/**
 * Bounded cache of MongoClient instances, one per connection string.
 *
 * - Concurrent requests for the same URI share one connect() call.
 * - Failed connections are closed and never cached.
 * - Idle clients are closed after a timeout; the least recently used idle
 *   client is closed when the cache is full.
 * - Clients that are in use are never closed by eviction. If the cache is
 *   full and every client is busy, new URIs are refused (503) instead of
 *   letting the number of open clients grow without limit.
 */
const { MongoClient, ServerApiVersion } = require('mongodb');
const { ConnectionString } = require('mongodb-connection-string-url');
const { HttpError } = require('./errors');

class MongoPool {
    constructor({ maxClients, idleTimeoutMS, clientOptions }) {
        this.maxClients = maxClients;
        this.idleTimeoutMS = idleTimeoutMS;
        this.clientOptions = clientOptions;
        this.entries = new Map();
        this.sweeper = setInterval(() => this.sweepIdle(), Math.min(idleTimeoutMS, 60000));
        this.sweeper.unref();
    }

    /**
     * @param {string} uri
     * @param {() => Promise<void>} [validate] runs once, before the first connect
     * @returns {Promise<{client: MongoClient, release: () => void}>}
     */
    async acquire(uri, validate) {
        let entry = this.entries.get(uri);
        if (!entry) {
            this.makeRoom();
            entry = { refs: 0, lastUsed: Date.now(), client: null, ready: null };
            entry.ready = this.open(uri, entry, validate);
            this.entries.set(uri, entry);
        }
        entry.refs += 1;
        entry.lastUsed = Date.now();
        try {
            await entry.ready;
        } catch (err) {
            entry.refs -= 1;
            throw err;
        }
        let released = false;
        return {
            client: entry.client,
            release: () => {
                if (released) return;
                released = true;
                entry.refs -= 1;
                entry.lastUsed = Date.now();
            }
        };
    }

    async open(uri, entry, validate) {
        try {
            if (validate) await validate();
            const client = new MongoClient(uri, this.optionsFor(uri));
            entry.client = client;
            await client.connect();
        } catch (err) {
            if (this.entries.get(uri) === entry) this.entries.delete(uri);
            if (entry.client) entry.client.close().catch(() => {});
            throw err;
        }
    }

    /**
     * Options given here override the same options in the URI, so the
     * server's serverSelectionTimeoutMS acts as a cap: a smaller value set
     * in the URI is still honoured.
     */
    optionsFor(uri) {
        const options = { ...this.clientOptions };
        const cap = options.serverSelectionTimeoutMS;
        try {
            const cs = new ConnectionString(uri);
            for (const [key, value] of cs.searchParams.entries()) {
                if (key.toLowerCase() === 'serverselectiontimeoutms') {
                    const v = parseInt(value, 10);
                    if (Number.isFinite(v) && v > 0 && v < cap) options.serverSelectionTimeoutMS = v;
                }
            }
        } catch {
            // Invalid URI: MongoClient will report it.
        }
        return options;
    }

    makeRoom() {
        if (this.entries.size < this.maxClients) return;
        let lruUri = null;
        let lruTime = Infinity;
        for (const [uri, e] of this.entries) {
            if (e.refs === 0 && e.lastUsed < lruTime) {
                lruUri = uri;
                lruTime = e.lastUsed;
            }
        }
        if (lruUri === null) {
            throw new HttpError(503, 'Server is busy: too many concurrent database connections. Try again shortly.');
        }
        this.evict(lruUri);
    }

    evict(uri) {
        const e = this.entries.get(uri);
        if (!e) return;
        this.entries.delete(uri);
        e.ready.then(() => e.client.close(), () => {}).catch(() => {});
    }

    sweepIdle() {
        const cutoff = Date.now() - this.idleTimeoutMS;
        for (const [uri, e] of this.entries) {
            if (e.refs === 0 && e.lastUsed < cutoff) this.evict(uri);
        }
    }

    async closeAll() {
        clearInterval(this.sweeper);
        const closing = [...this.entries.keys()].map(uri => {
            const e = this.entries.get(uri);
            this.entries.delete(uri);
            return e.ready.then(() => e.client.close(), () => {});
        });
        await Promise.allSettled(closing);
    }
}

function createPool(cfg) {
    return new MongoPool({
        maxClients: cfg.maxCachedClients,
        idleTimeoutMS: cfg.clientIdleTimeoutMS,
        clientOptions: {
            // Not "strict": strict mode rejects commands and operators outside
            // Stable API v1 (e.g. $text, some aggregation stages). Write
            // endpoints already ran without strict; this only removes errors.
            serverApi: { version: ServerApiVersion.v1 },
            maxPoolSize: 10,
            serverSelectionTimeoutMS: cfg.serverSelectionTimeoutMS,
            appName: 'MongoReflector'
        }
    });
}

module.exports = { MongoPool, createPool };
