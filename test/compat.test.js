/**
 * Backward-compatibility tests.
 *
 * Every request here uses the request format that existed before the
 * security/feature audit. They must keep passing unchanged.
 *
 * Needs a real MongoDB. Set MONGO_TEST_URI (e.g. mongodb://127.0.0.1:27017);
 * the suite is skipped when it is not set.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const MONGO_TEST_URI = process.env.MONGO_TEST_URI;
const DB = `reflector_compat_${process.pid}`;

describe('compat: existing request formats', { skip: !MONGO_TEST_URI && 'MONGO_TEST_URI not set' }, () => {
    let srv;
    const base = () => ({ mongoURI: MONGO_TEST_URI, dbName: DB });
    const post = (path, body) => srv.post(path, body);

    before(async () => {
        srv = await startServer();
    });

    after(async () => {
        if (srv) {
            await post('/delete', { ...base(), collectionName: 'users', query: {}, multi: true });
            await srv.stop();
        }
    });

    test('GET /test', async () => {
        const r = await srv.get('/test');
        assert.equal(r.status, 200);
        assert.equal(r.body.test, 'OK');
    });

    test('POST /ping', async () => {
        const r = await post('/ping', { ...base(), collectionName: 'users' });
        assert.equal(r.status, 200);
        assert.equal(r.body.acknowledged, true);
    });

    test('POST /insert (single + many)', async () => {
        let r = await post('/insert', {
            ...base(), collectionName: 'users',
            documents: { name: 'Alice', age: 30, status: 'active', tags: ['a', 'b'] }
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.acknowledged, true);
        assert.ok(r.body.result.insertedId);

        r = await post('/insert', {
            ...base(), collectionName: 'users',
            documents: [
                { name: 'Bob', age: 25, status: 'inactive', tags: ['b'] },
                { name: 'Carol', age: 35, status: 'active', tags: ['c'] },
                { name: 'alan', age: 40, status: 'pending', tags: [] }
            ]
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.result.insertedCount, 3);
    });

    test('POST /find with query + options', async () => {
        const r = await post('/find', {
            ...base(), collectionName: 'users',
            query: { status: 'active' },
            options: { projection: { _id: 0, name: 1 }, sort: { name: 1 } }
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.acknowledged, true);
        assert.deepEqual(r.body.results, [{ name: 'Alice' }, { name: 'Carol' }]);
        assert.equal(r.body.truncated, false);
        assert.equal(typeof r.body.payloadBytes, 'number');
        assert.equal(typeof r.body.maxPayloadBytes, 'number');
        assert.equal(r.body.scanned, 2);
    });

    test('POST /find with "RegExp(...)" string and operators', async () => {
        let r = await post('/find', {
            ...base(), collectionName: 'users',
            query: { name: 'RegExp(^al, i)' },
            options: { projection: { _id: 0, name: 1 }, sort: { name: 1 } }
        });
        assert.deepEqual(r.body.results.map(d => d.name), ['Alice', 'alan']);

        r = await post('/find', {
            ...base(), collectionName: 'users',
            query: { age: { $gte: 30 }, name: { $regex: '^a', $options: 'i' } },
            options: { projection: { _id: 0, name: 1 }, sort: { age: 1 } }
        });
        assert.deepEqual(r.body.results.map(d => d.name), ['Alice', 'alan']);
    });

    test('POST /find with no query returns everything', async () => {
        const r = await post('/find', { ...base(), collectionName: 'users' });
        assert.equal(r.body.results.length, 4);
        assert.equal(typeof r.body.results[0]._id, 'string');
    });

    test('POST /paginatefind (DataTables)', async () => {
        const body = {
            ...base(), collectionName: 'users',
            query: {},
            start: 0, length: 2, draw: 3,
            columns: [{ data: 'name' }, { data: 'status' }],
            order: [{ column: 0, dir: 'asc' }],
            search: { value: '' }
        };
        let r = await post('/paginatefind', body);
        assert.equal(r.status, 200);
        assert.equal(r.body.draw, 3);
        assert.equal(r.body.recordsTotal, 4);
        assert.equal(r.body.recordsFiltered, 4);
        assert.deepEqual(r.body.data.map(d => d.name), ['Alice', 'Bob']);
        assert.equal(r.body.effectiveLength, 2);

        r = await post('/paginatefind', { ...body, search: { value: 'act' }, start: '0', length: '10' });
        assert.equal(r.body.recordsFiltered, 3); // active, inactive, active
        assert.deepEqual(r.body.data.map(d => d.name), ['Alice', 'Bob', 'Carol']);

        r = await post('/paginatefind', { ...body, query: { status: 'active' }, order: [{ column: 0, dir: 'desc' }] });
        assert.equal(r.body.recordsFiltered, 2);
        assert.deepEqual(r.body.data.map(d => d.name), ['Carol', 'Alice']);
    });

    test('POST /datatables_paginatefind alias', async () => {
        const r = await post('/datatables_paginatefind', {
            ...base(), collectionName: 'users', start: 0, length: 10,
            columns: [{ data: 'name' }], order: [{ column: 0, dir: 'asc' }]
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.recordsTotal, 4);
    });

    test('POST /distinct_field', async () => {
        let r = await post('/distinct_field', { ...base(), collectionName: 'users', field_name: 'status' });
        assert.equal(r.status, 200);
        assert.deepEqual([...r.body.results].sort(), ['active', 'inactive', 'pending']);
        r = await post('/distinct_field', { ...base(), collectionName: 'users', field_name: 'status', query: { age: { $lt: 31 } } });
        assert.deepEqual([...r.body.results].sort(), ['active', 'inactive']);
        r = await post('/distinct_field', { ...base(), collectionName: 'users' });
        assert.equal(r.status, 400);
    });

    test('POST /update (default upsert, options.upsert, legacy top-level upsert)', async () => {
        let r = await post('/update', {
            ...base(), collectionName: 'users',
            query: { status: 'active' }, update: { $set: { verified: true } }
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.acknowledged, true);
        assert.equal(r.body.matchedCount, 2);
        assert.equal(r.body.modifiedCount, 2);

        // upsert is the default
        r = await post('/update', {
            ...base(), collectionName: 'users',
            query: { name: 'Dave' }, update: { $set: { age: 50 } }
        });
        assert.equal(r.body.upsertedCount, 1);
        assert.ok(r.body.upsertedId);

        r = await post('/update', {
            ...base(), collectionName: 'users',
            query: { name: 'Nobody' }, update: { $set: { age: 1 } }, options: { upsert: false }
        });
        assert.equal(r.body.upsertedCount, 0);

        r = await post('/update', {
            ...base(), collectionName: 'users',
            query: { name: 'Nobody' }, update: { $set: { age: 1 } }, upsert: 'false'
        });
        assert.equal(r.body.upsertedCount, 0);

        r = await post('/update', {
            ...base(), collectionName: 'users', query: {}, update: { $set: { x: 1 } }
        });
        assert.equal(r.status, 400);
    });

    test('POST /delete (single + multi)', async () => {
        let r = await post('/delete', { ...base(), collectionName: 'users', query: { name: 'Dave' } });
        assert.equal(r.status, 200);
        assert.equal(r.body.deletedCount, 1);

        r = await post('/delete', { ...base(), collectionName: 'users', query: { status: 'active' }, multi: true });
        assert.equal(r.body.deletedCount, 2);

        r = await post('/delete', { ...base(), collectionName: 'users' });
        assert.equal(r.status, 400);
    });

    describe('time series', () => {
        const coll = 'ts_compat';
        before(async () => {
            const { MongoClient } = require('mongodb');
            const c = new MongoClient(MONGO_TEST_URI);
            await c.connect();
            await c.db(DB).collection(coll).drop().catch(() => {});
            await c.db(DB).createCollection(coll, { timeseries: { timeField: 'timestamp', metaField: 'metadata' } });
            await c.close();
        });

        test('POST /insertTimeSeries and alias', async () => {
            let r = await post('/insertTimeSeries', {
                ...base(), collectionName: coll,
                timeField: { name: 'timestamp', val: '2026-01-10T10:00:00Z' },
                documents: { metadata: { sensor: 's1' }, value: 1 }
            });
            assert.equal(r.status, 200);
            assert.equal(r.body.acknowledged, true);

            r = await post('/timeseries_insert', {
                ...base(), collectionName: coll,
                timeField: { name: 'timestamp', val: '2026-02-10T10:00:00Z' },
                documents: { metadata: { sensor: 's1' }, value: 2 }
            });
            assert.equal(r.status, 200);

            r = await post('/insertTimeseries', {
                ...base(), collectionName: coll,
                timeField: { name: 'timestamp', val: '2026-03-10T10:00:00Z' },
                documents: { metadata: { sensor: 's2' }, value: 3 }
            });
            assert.equal(r.status, 200);

            r = await post('/find', { ...base(), collectionName: coll, options: { sort: { timestamp: 1 } } });
            assert.equal(r.body.results.length, 3);
            assert.equal(r.body.results[0].timestamp, '2026-01-10T10:00:00.000Z');
        });

        test('POST /deleteTimeseries with time range', async () => {
            const r = await post('/deleteTimeseries', {
                ...base(), collectionName: coll,
                query: { 'metadata.sensor': 's1' },
                timeField: { start: '2026-01-01T00:00:00Z', end: '2026-01-31T23:59:59Z' },
                multi: true
            });
            assert.equal(r.status, 200);
            assert.equal(r.body.deletedCount, 1);
        });

        test('POST /deleteTimeseries_legacy and /timeseries_delete alias', async () => {
            let r = await post('/deleteTimeseries_legacy', {
                ...base(), collectionName: coll, query: { 'metadata.sensor': 's2' }
            });
            assert.equal(r.status, 200);
            assert.equal(r.body.deletedCount, 1);
            assert.equal(r.body.totalMatched, 1);

            r = await post('/timeseries_delete', {
                ...base(), collectionName: coll, query: { 'metadata.sensor': 's1' }
            });
            assert.equal(r.status, 200);
            assert.equal(r.body.deletedCount, 1);
        });
    });
});
