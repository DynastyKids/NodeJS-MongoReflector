/**
 * Smoke tests: no database needed. Starts server.js on a free port,
 * or uses API_URL if it is set (to check an already running server).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;

before(async () => {
    if (process.env.API_URL) {
        const baseUrl = process.env.API_URL.replace(/\/$/, '');
        const request = async (method, p, body) => {
            const res = await fetch(baseUrl + p, {
                method,
                headers: body ? { 'content-type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined
            });
            const text = await res.text();
            let parsed = text;
            try { parsed = JSON.parse(text); } catch { /* keep text */ }
            return { status: res.status, headers: res.headers, body: parsed };
        };
        srv = { get: p => request('GET', p), post: (p, b) => request('POST', p, b), stop: async () => {} };
    } else {
        srv = await startServer();
    }
});

after(() => srv && srv.stop());

test('server is running', async () => {
    const r = await srv.get('/');
    assert.equal(r.status, 200);
    assert.match(r.body, /Mongo Reflector/);
});

test('English API docs are accessible', async () => {
    const r = await srv.get('/api/en/');
    assert.equal(r.status, 200);
    assert.match(r.body, /swagger/i);
});

test('Chinese API docs are accessible', async () => {
    const r = await srv.get('/api/zh_cn/');
    assert.equal(r.status, 200);
    assert.match(r.body, /swagger/i);
});

test('/test reports OK', async () => {
    const r = await srv.get('/test');
    assert.equal(r.status, 200);
    assert.equal(r.body.test, 'OK');
});

test('ping without params returns 400 JSON', async () => {
    const r = await srv.post('/ping', {});
    assert.equal(r.status, 400);
    assert.equal(r.body.acknowledged, false);
});

test('find without mongoURI returns 400 JSON, not an HTML stack trace', async () => {
    const r = await srv.post('/find', { dbName: 'a', collectionName: 'b' });
    assert.equal(r.status, 400);
    assert.equal(r.body.acknowledged, false);
    assert.doesNotMatch(JSON.stringify(r.body), /node_modules|at /);
});

test('invalid JSON body returns 400 JSON', async () => {
    const res = await fetch(`${srv.baseUrl || process.env.API_URL}/find`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad'
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).acknowledged, false);
});

test('unknown routes return 404', async () => {
    const r = await srv.get('/invalid-route');
    assert.equal(r.status, 404);
});
