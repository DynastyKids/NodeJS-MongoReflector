/**
 * Tests for new endpoints, Extended JSON support and security settings.
 * Needs MONGO_TEST_URI (skipped otherwise).
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const MONGO_TEST_URI = process.env.MONGO_TEST_URI;
const DB = `reflector_features_${process.pid}`;
const skip = !MONGO_TEST_URI && 'MONGO_TEST_URI not set';

describe('features', { skip }, () => {
    let srv;
    const t = (collectionName, extra) => ({ mongoURI: MONGO_TEST_URI, dbName: DB, collectionName, ...extra });

    before(async () => {
        srv = await startServer();
        await srv.post('/insert', t('items', {
            documents: [
                { _id: { $oid: '650000000000000000000001' }, name: 'pen', price: { $numberDecimal: '1.50' }, qty: 10, cat: 'office', at: { $date: '2026-01-01T00:00:00Z' } },
                { _id: { $oid: '650000000000000000000002' }, name: 'paper', price: { $numberDecimal: '5.00' }, qty: 0, cat: 'office', at: { $date: '2026-02-01T00:00:00Z' } },
                { _id: { $oid: '650000000000000000000003' }, name: 'apple', price: { $numberDecimal: '0.80' }, qty: 50, cat: 'food', at: { $date: '2026-03-01T00:00:00Z' } }
            ]
        }));
        await srv.post('/insert', t('orders', {
            documents: [
                { item: 'pen', n: 2 }, { item: 'pen', n: 3 }, { item: 'apple', n: 7 }
            ]
        }));
    });

    after(async () => {
        if (!srv) return;
        const { MongoClient } = require('mongodb');
        const c = new MongoClient(MONGO_TEST_URI);
        await c.connect();
        await c.db(DB).dropDatabase();
        await c.close();
        await srv.stop();
    });

    test('query by ObjectId and date with Extended JSON', async () => {
        let r = await srv.post('/find', t('items', { query: { _id: { $oid: '650000000000000000000002' } } }));
        assert.equal(r.status, 200);
        assert.equal(r.body.results.length, 1);
        assert.equal(r.body.results[0].name, 'paper');

        r = await srv.post('/find', t('items', { query: { at: { $gte: { $date: '2026-02-01T00:00:00Z' } } }, options: { sort: { at: 1 } } }));
        assert.deepEqual(r.body.results.map(d => d.name), ['paper', 'apple']);
        // Default response format is unchanged: ObjectId -> hex string, Date -> ISO string
        assert.equal(r.body.results[0]._id, '650000000000000000000002');
        assert.equal(r.body.results[0].at, '2026-02-01T00:00:00.000Z');
    });

    test('responseFormat "ejson" keeps BSON types', async () => {
        const r = await srv.post('/find', t('items', { query: { name: 'pen' }, responseFormat: 'ejson' }));
        const doc = r.body.results[0];
        assert.deepEqual(doc._id, { $oid: '650000000000000000000001' });
        assert.deepEqual(doc.price, { $numberDecimal: '1.50' });
        assert.ok(doc.at.$date);
    });

    test('/findOne', async () => {
        let r = await srv.post('/findOne', t('items', { query: { name: 'apple' }, options: { projection: { _id: 0, qty: 1 } } }));
        assert.deepEqual(r.body, { acknowledged: true, result: { qty: 50 } });
        r = await srv.post('/findOne', t('items', { query: { name: 'none' } }));
        assert.equal(r.body.result, null);
    });

    test('/count', async () => {
        let r = await srv.post('/count', t('items', { query: { cat: 'office' } }));
        assert.equal(r.body.count, 2);
        r = await srv.post('/count', t('items', { estimated: true }));
        assert.equal(r.body.count, 3);
    });

    test('/aggregate with $lookup and $group', async () => {
        const r = await srv.post('/aggregate', t('orders', {
            pipeline: [
                { $group: { _id: '$item', total: { $sum: '$n' } } },
                { $lookup: { from: 'items', localField: '_id', foreignField: 'name', as: 'item' } },
                { $project: { _id: 0, name: '$_id', total: 1, cat: { $first: '$item.cat' } } },
                { $sort: { name: 1 } }
            ]
        }));
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.results, [
            { total: 7, name: 'apple', cat: 'food' },
            { total: 5, name: 'pen', cat: 'office' }
        ]);
        assert.equal(r.body.truncated, false);
    });

    test('/aggregate blocks $out and $merge by default', async () => {
        for (const stage of [{ $out: 'copy' }, { $merge: { into: 'copy' } }]) {
            const r = await srv.post('/aggregate', t('items', { pipeline: [{ $match: {} }, stage] }));
            assert.equal(r.status, 403);
        }
        const r = await srv.post('/aggregate', t('items', { pipeline: {} }));
        assert.equal(r.status, 400);
    });

    test('server-side JavaScript is blocked', async () => {
        let r = await srv.post('/find', t('items', { query: { $where: 'this.qty > 1' } }));
        assert.equal(r.status, 403);
        assert.equal(r.body.acknowledged, false);
        r = await srv.post('/aggregate', t('items', { pipeline: [{ $match: { $expr: { $function: { body: 'function(){return true}', args: [], lang: 'js' } } } }] }));
        assert.equal(r.status, 403);
    });

    test('/updateOne (no default upsert) and pipeline update on /update', async () => {
        let r = await srv.post('/updateOne', t('items', { query: { cat: 'office' }, update: { $inc: { qty: 1 } } }));
        assert.equal(r.body.matchedCount, 1);
        r = await srv.post('/updateOne', t('items', { query: { name: 'ghost' }, update: { $set: { qty: 1 } } }));
        assert.equal(r.body.upsertedCount, 0);

        r = await srv.post('/update', t('items', {
            query: { cat: 'food' },
            update: [{ $set: { label: { $concat: ['$cat', ':', '$name'] } } }],
            options: { upsert: false }
        }));
        assert.equal(r.status, 200);
        assert.equal(r.body.modifiedCount, 1);
        r = await srv.post('/findOne', t('items', { query: { name: 'apple' } }));
        assert.equal(r.body.result.label, 'food:apple');
    });

    test('/update with arrayFilters', async () => {
        await srv.post('/insert', t('carts', { documents: { _id: 'c1', lines: [{ sku: 'a', q: 1 }, { sku: 'b', q: 1 }] } }));
        const r = await srv.post('/update', t('carts', {
            query: { _id: 'c1' },
            update: { $inc: { 'lines.$[l].q': 5 } },
            options: { arrayFilters: [{ 'l.sku': 'b' }], upsert: false }
        }));
        assert.equal(r.body.modifiedCount, 1);
        const doc = (await srv.post('/findOne', t('carts', { query: { _id: 'c1' } }))).body.result;
        assert.deepEqual(doc.lines.map(l => l.q), [1, 6]);
    });

    test('/replaceOne, /findOneAndUpdate, /findOneAndReplace, /findOneAndDelete', async () => {
        await srv.post('/insert', t('kv', { documents: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'c', v: 3 }] }));

        let r = await srv.post('/replaceOne', t('kv', { query: { k: 'a' }, replacement: { k: 'a', v: 10 } }));
        assert.equal(r.body.modifiedCount, 1);

        r = await srv.post('/findOneAndUpdate', t('kv', { query: { k: 'b' }, update: { $inc: { v: 1 } }, options: { returnDocument: 'after', projection: { _id: 0 } } }));
        assert.deepEqual(r.body.result, { k: 'b', v: 3 });

        r = await srv.post('/findOneAndReplace', t('kv', { query: { k: 'c' }, replacement: { k: 'c', v: 30 }, options: { projection: { _id: 0 } } }));
        assert.deepEqual(r.body.result, { k: 'c', v: 3 }); // returns the document before replacement

        r = await srv.post('/findOneAndDelete', t('kv', { query: { k: 'a' }, options: { projection: { _id: 0 } } }));
        assert.deepEqual(r.body.result, { k: 'a', v: 10 });

        r = await srv.post('/count', t('kv', {}));
        assert.equal(r.body.count, 2);
    });

    test('/bulkWrite', async () => {
        const r = await srv.post('/bulkWrite', t('bulk', {
            operations: [
                { insertOne: { document: { _id: 1, v: 'a' } } },
                { insertOne: { document: { _id: 2, v: 'b' } } },
                { updateOne: { filter: { _id: 1 }, update: { $set: { v: 'A' } } } },
                { updateOne: { filter: { _id: 3 }, update: { $set: { v: 'c' } }, upsert: true } },
                { deleteOne: { filter: { _id: 2 } } }
            ]
        }));
        assert.equal(r.status, 200);
        assert.equal(r.body.insertedCount, 2);
        assert.equal(r.body.modifiedCount, 1);
        assert.equal(r.body.upsertedCount, 1);
        assert.equal(r.body.deletedCount, 1);

        let bad = await srv.post('/bulkWrite', t('bulk', { operations: [{ dropDatabase: {} }] }));
        assert.equal(bad.status, 400);
        bad = await srv.post('/bulkWrite', t('bulk', { operations: [{ deleteMany: { filter: { $where: '1' } } }] }));
        assert.equal(bad.status, 403);
    });

    test('database errors are JSON with code, no stack trace', async () => {
        const r = await srv.post('/insert', t('bulk', { documents: { _id: 1 } }));
        assert.equal(r.status, 500);
        assert.equal(r.body.acknowledged, false);
        assert.equal(r.body.code, 11000);
        assert.equal(typeof r.body.message, 'string');
        assert.doesNotMatch(JSON.stringify(r.body), /node_modules/);
    });

    describe('paginatefind fixes', () => {
        const cols = [{ data: 'name' }, { data: 'cat' }, { data: 'qty' }];

        test('existing $or in query is kept when searching', async () => {
            const r = await srv.post('/paginatefind', t('items', {
                query: { $or: [{ cat: 'food' }, { qty: { $gt: 100 } }] },
                columns: cols, search: { value: 'p' }, order: [{ column: 0, dir: 'asc' }]
            }));
            // Only "apple" is food; old code dropped the $or and also returned pen/paper.
            assert.deepEqual(r.body.data.map(d => d.name), ['apple']);
            assert.equal(r.body.recordsFiltered, 1);
        });

        test('invalid regex in search falls back to literal text', async () => {
            const r = await srv.post('/paginatefind', t('items', { columns: cols, search: { value: '(' } }));
            assert.equal(r.status, 200);
            assert.equal(r.body.recordsFiltered, 0);
        });

        test('length -1 means all (capped) and multi-column sort works', async () => {
            const r = await srv.post('/paginatefind', t('items', {
                columns: cols, length: -1, order: [{ column: 1, dir: 'desc' }, { column: 0, dir: 'asc' }]
            }));
            assert.equal(r.body.effectiveLength, 500);
            assert.deepEqual(r.body.data.map(d => d.name), ['paper', 'pen', 'apple']);
        });

        test('columns starting with $ are ignored', async () => {
            const r = await srv.post('/paginatefind', t('items', { columns: [{ data: '$where' }], search: { value: 'x' } }));
            assert.equal(r.status, 200);
            assert.equal(r.body.recordsFiltered, 3);
        });
    });

    test('/delete: multi "false" string now deletes only one', async () => {
        await srv.post('/insert', t('del', { documents: [{ g: 1 }, { g: 1 }, { g: 1 }] }));
        let r = await srv.post('/delete', t('del', { query: { g: 1 }, multi: 'false' }));
        assert.equal(r.body.deletedCount, 1);
        assert.equal(r.body.acknowledged, true);
        r = await srv.post('/delete', t('del', { query: 'not-an-object' }));
        assert.equal(r.status, 400);
    });

    describe('time series fixes', () => {
        const coll = 'ts_features';
        before(async () => {
            const { MongoClient } = require('mongodb');
            const c = new MongoClient(MONGO_TEST_URI);
            await c.connect();
            await c.db(DB).createCollection(coll, { timeseries: { timeField: 'ts', metaField: 'meta' } });
            await c.close();
        });

        test('insert many with a custom time field name; insert with $date and no timeField', async () => {
            let r = await srv.post('/insertTimeSeries', t(coll, {
                timeField: { name: 'ts', val: '2026-05-01T00:00:00Z' },
                documents: [{ meta: { s: 'a' }, v: 1 }, { meta: { s: 'b' }, v: 2 }]
            }));
            assert.equal(r.status, 200);
            assert.equal(r.body.result.insertedCount, 2);

            r = await srv.post('/insertTimeSeries', t(coll, { documents: { meta: { s: 'a' }, v: 3, ts: { $date: '2026-06-01T00:00:00Z' } } }));
            assert.equal(r.status, 200);

            r = await srv.post('/insertTimeSeries', t(coll, { timeField: { name: 'ts', val: 'garbage' }, documents: { v: 1 } }));
            assert.equal(r.status, 400);
        });

        test('/deleteTimeseries uses timeField.name (was hard-coded to "timestamp")', async () => {
            const r = await srv.post('/deleteTimeseries', t(coll, {
                query: { 'meta.s': 'a' },
                timeField: { name: 'ts', start: '2026-05-01T00:00:00Z', end: '2026-05-31T00:00:00Z' },
                multi: true
            }));
            assert.equal(r.body.deletedCount, 1);
        });

        test('legacy delete honours the documented time range', async () => {
            const r = await srv.post('/delete_timeseries_legacy', t(coll, {
                query: {},
                timeField: { name: 'ts', start: '2026-06-01T00:00:00Z' }
            }));
            assert.equal(r.body.deletedCount, 1); // only the June document, not the May one
            const left = await srv.post('/count', t(coll, {}));
            assert.equal(left.body.count, 1);
        });
    });
});

describe('security settings', { skip }, () => {
    const t = extra => ({ dbName: DB, collectionName: 'sec', ...extra });

    test('READ_ONLY blocks writes and $out', async () => {
        const s = await startServer({ READ_ONLY: 'true', ALLOW_AGGREGATE_WRITES: 'true' });
        try {
            let r = await s.post('/insert', t({ mongoURI: MONGO_TEST_URI, documents: { a: 1 } }));
            assert.equal(r.status, 403);
            r = await s.post('/bulkWrite', t({ mongoURI: MONGO_TEST_URI, operations: [] }));
            assert.equal(r.status, 403);
            r = await s.post('/aggregate', t({ mongoURI: MONGO_TEST_URI, pipeline: [{ $out: 'x' }] }));
            assert.equal(r.status, 403);
            r = await s.post('/find', t({ mongoURI: MONGO_TEST_URI }));
            assert.equal(r.status, 200);
        } finally {
            await s.stop();
        }
    });

    test('ALLOW_PUBLIC_USE=false: listed key reaches the database, others do not', async () => {
        const s = await startServer({
            ALLOW_PUBLIC_USE: 'false',
            ALLOWED_KEYPAIRS: `[{user:"a", token:"tok-key-aaaa", expiry:${Date.now() + 60000}}]`
        });
        try {
            let r = await s.post('/find', t({ mongoURI: MONGO_TEST_URI }));
            assert.equal(r.status, 401);
            r = await s.post('/find', t({ mongoURI: MONGO_TEST_URI }), { 'x-api-key': 'wrong' });
            assert.equal(r.status, 401);
            r = await s.post('/find', t({ mongoURI: MONGO_TEST_URI }), { 'x-api-key': 'tok-key-aaaa' });
            assert.equal(r.status, 200);
            assert.equal(r.body.acknowledged, true);
            r = await s.post('/find', t({ mongoURI: MONGO_TEST_URI }), { authorization: 'Bearer tok-key-aaaa' });
            assert.equal(r.status, 200);
            r = await s.get('/test');
            assert.equal(r.status, 200);
        } finally {
            await s.stop();
        }
    });

    test('DEFAULT_MONGO_URI with ALLOW_CLIENT_MONGO_URI=false', async () => {
        const s = await startServer({ DEFAULT_MONGO_URI: MONGO_TEST_URI, ALLOW_CLIENT_MONGO_URI: 'false' });
        try {
            let r = await s.post('/find', t({}));
            assert.equal(r.status, 200);
            r = await s.post('/ping', t({}));
            assert.equal(r.status, 200);
            r = await s.post('/find', t({ mongoURI: MONGO_TEST_URI }));
            assert.equal(r.status, 403);
            assert.match(s.output(), /WARNING: DEFAULT_MONGO_URI is set while ALLOW_PUBLIC_USE is not false/);
        } finally {
            await s.stop();
        }
    });

    test('ALLOWED_MONGO_HOSTS and BLOCK_PRIVATE_HOSTS refuse other hosts', async () => {
        const s = await startServer({ ALLOWED_MONGO_HOSTS: '*.mongodb.net' });
        try {
            const r = await s.post('/ping', t({ mongoURI: MONGO_TEST_URI }));
            assert.equal(r.status, 403);
        } finally {
            await s.stop();
        }
        const s2 = await startServer({ BLOCK_PRIVATE_HOSTS: 'true' });
        try {
            const r = await s2.post('/ping', t({ mongoURI: 'mongodb://169.254.169.254:80' }));
            assert.equal(r.status, 403);
        } finally {
            await s2.stop();
        }
    });

    test('unsafe URI options are refused before connecting', async () => {
        const s = await startServer();
        try {
            const r = await s.post('/find', t({ mongoURI: `${MONGO_TEST_URI}/?tlsCAFile=/etc/passwd` }));
            assert.equal(r.status, 403);
        } finally {
            await s.stop();
        }
    });

    test('RATE_LIMIT_PER_MINUTE', async () => {
        const s = await startServer({ RATE_LIMIT_PER_MINUTE: '3' });
        try {
            const statuses = [];
            for (let i = 0; i < 5; i++) statuses.push((await s.post('/ping', {})).status);
            assert.deepEqual(statuses, [400, 400, 400, 429, 429]);
        } finally {
            await s.stop();
        }
    });

    test('MAX_CACHED_CLIENTS: idle clients are evicted, cache stays usable', async () => {
        const s = await startServer({ MAX_CACHED_CLIENTS: '1' });
        try {
            for (const suffix of ['', '/?appName=a', '/?appName=b', '']) {
                const r = await s.post('/ping', t({ mongoURI: MONGO_TEST_URI + suffix }));
                assert.equal(r.status, 200);
            }
        } finally {
            await s.stop();
        }
    });
});
