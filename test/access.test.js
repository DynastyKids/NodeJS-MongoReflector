/**
 * ALLOW_PUBLIC_USE / ALLOWED_KEYPAIRS. No database needed: requests that pass
 * the key check reach /ping without params and get 400, refused ones get 401.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./helpers');
const { parseRelaxedJson, parseKeypairs, checkToken, toEpochMs } = require('../lib/keypairs');
const { loadDotEnv } = require('../lib/config');

const FUTURE = Date.now() + 365 * 24 * 3600 * 1000;
const PAST = Date.now() - 1000;

describe('ALLOWED_KEYPAIRS parsing', () => {
    test('relaxed .env format: unquoted keys, trailing commas, comments, single quotes', () => {
        const v = parseRelaxedJson(`[
            {user:"a",token:"tok-aaaaaaaa",expiry:2524651200000},
            # a comment
            {user:'b', token:'tok-bbbbbbbb', expiry:1700000000}, // another
        ]`);
        assert.deepEqual(v, [
            { user: 'a', token: 'tok-aaaaaaaa', expiry: 2524651200000 },
            { user: 'b', token: 'tok-bbbbbbbb', expiry: 1700000000 }
        ]);
    });

    test('strict JSON on one line also works (for hosting dashboards)', () => {
        const { entries, warnings } = parseKeypairs('[{"user":"a","token":"tok-aaaaaaaa","expiry":2524651200000}]');
        assert.equal(entries.length, 1);
        assert.deepEqual(warnings, []);
    });

    test('expiry in seconds or milliseconds', () => {
        assert.equal(toEpochMs(2524651200000), 2524651200000);
        assert.equal(toEpochMs(2524651200), 2524651200000);
        assert.equal(toEpochMs('2524651200000'), 2524651200000);
        assert.equal(toEpochMs(undefined), null);
        assert.equal(toEpochMs('soon'), null);
    });

    test('bad entries are skipped with a warning; bad syntax accepts nothing', () => {
        let r = parseKeypairs(`[
            {user:"ok", token:"tok-okokokok", expiry:${FUTURE}},
            {user:"noexp", token:"tok-noexpnoexp"},
            {user:"short", token:"abc", expiry:${FUTURE}},
            "junk",
        ]`);
        assert.deepEqual(r.entries.map(e => e.user), ['ok']);
        assert.equal(r.warnings.length, 3);

        r = parseKeypairs('[{user:"a", token:"tok-aaaaaaaa" expiry:1}]');
        assert.equal(r.entries.length, 0);
        assert.match(r.warnings[0], /could not be parsed/);
    });

    test('tokens are not kept in plain text', () => {
        const { entries } = parseKeypairs(`[{user:"a", token:"tok-secret-value", expiry:${FUTURE}}]`);
        assert.doesNotMatch(JSON.stringify(entries), /tok-secret-value/);
    });

    test('checkToken: valid, expired, invalid, missing', () => {
        const { entries } = parseKeypairs(`[
            {user:"live", token:"tok-live-0001", expiry:${FUTURE}},
            {user:"old", token:"tok-old-00001", expiry:${PAST}},
            {user:"old-dup", token:"tok-dup-00001", expiry:${PAST}},
            {user:"new-dup", token:"tok-dup-00001", expiry:${FUTURE}},
        ]`);
        assert.deepEqual(checkToken(entries, 'tok-live-0001'), { ok: true, user: 'live' });
        assert.deepEqual(checkToken(entries, 'tok-old-00001'), { ok: false, reason: 'expired' });
        assert.deepEqual(checkToken(entries, 'tok-nope-0001'), { ok: false, reason: 'invalid' });
        assert.deepEqual(checkToken(entries, ''), { ok: false, reason: 'missing' });
        // A renewed key with the same token works even if an old entry has expired.
        assert.deepEqual(checkToken(entries, 'tok-dup-00001'), { ok: true, user: 'new-dup' });
    });

    test('.env loader reads multi-line values and the lines after them', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflector-env-'));
        const file = path.join(dir, '.env');
        fs.writeFileSync(file, [
            '# comment',
            'TEST_KP_PUBLIC=false',
            'TEST_KP_PAIRS=[',
            '    {user:"a",token:"tok=with=equals",expiry:2524651200000},',
            '    {user:"b",token:"tok-bbbbbbbb",expiry:2524651200000},',
            ']',
            'TEST_KP_AFTER=still-read',
            ''
        ].join('\r\n'));
        try {
            loadDotEnv(file);
            assert.equal(process.env.TEST_KP_PUBLIC, 'false');
            assert.equal(process.env.TEST_KP_AFTER, 'still-read');
            const v = parseRelaxedJson(process.env.TEST_KP_PAIRS);
            assert.equal(v.length, 2);
            assert.equal(v[0].token, 'tok=with=equals');
        } finally {
            delete process.env.TEST_KP_PUBLIC;
            delete process.env.TEST_KP_PAIRS;
            delete process.env.TEST_KP_AFTER;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('ALLOW_PUBLIC_USE on the server', () => {
    const pairs = `[
        {user:"syd", token:"tok-syd-123456", expiry:${FUTURE}},
        {user:"mel", token:"tok-mel-123456", expiry:${Math.floor(FUTURE / 1000)}},
        {user:"gone", token:"tok-gone-12345", expiry:${PAST}},
    ]`;

    test('false: only listed, unexpired keys may POST', async () => {
        const s = await startServer({ ALLOW_PUBLIC_USE: 'false', ALLOWED_KEYPAIRS: pairs });
        try {
            let r = await s.post('/ping', {});
            assert.equal(r.status, 401);
            assert.match(r.body.message, /API key required/);

            r = await s.post('/ping', {}, { 'x-api-key': 'tok-wrong-1234' });
            assert.equal(r.status, 401);
            assert.equal(r.body.message, 'Invalid API key.');

            r = await s.post('/ping', {}, { 'x-api-key': 'tok-gone-12345' });
            assert.equal(r.status, 401);
            assert.equal(r.body.message, 'API key has expired.');

            r = await s.post('/ping', {}, { 'x-api-key': 'tok-syd-123456' });
            assert.equal(r.status, 400); // passed the key check

            r = await s.post('/ping', {}, { authorization: 'Bearer tok-mel-123456' });
            assert.equal(r.status, 400); // expiry given in seconds

            // Docs, health check and CORS preflight stay open.
            assert.equal((await s.get('/test')).status, 200);
            assert.equal((await s.get('/')).status, 200);
            const pre = await fetch(`${s.baseUrl}/find`, {
                method: 'OPTIONS',
                headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-api-key' }
            });
            assert.equal(pre.status, 204);
            assert.match(pre.headers.get('access-control-allow-headers') || '', /x-api-key/i);

            assert.match(s.output(), /restricted to ALLOWED_KEYPAIRS \(2 active, 1 expired\)/);
            assert.doesNotMatch(s.output(), /tok-/);
        } finally {
            await s.stop();
        }
    });

    test('expiry is checked on every request, not only at startup', async () => {
        const soon = Date.now() + 1500;
        const s = await startServer({ ALLOW_PUBLIC_USE: 'false', ALLOWED_KEYPAIRS: `[{user:"t", token:"tok-short-life", expiry:${soon}}]` });
        try {
            assert.equal((await s.post('/ping', {}, { 'x-api-key': 'tok-short-life' })).status, 400);
            await new Promise(r => setTimeout(r, Math.max(soon - Date.now(), 0) + 200));
            const r = await s.post('/ping', {}, { 'x-api-key': 'tok-short-life' });
            assert.equal(r.status, 401);
            assert.equal(r.body.message, 'API key has expired.');
            assert.match(s.output(), /key for user "t" expires/);
        } finally {
            await s.stop();
        }
    });

    test('true or unset: anyone may POST, keys are ignored', async () => {
        for (const value of ['true', '']) {
            const s = await startServer({ ALLOW_PUBLIC_USE: value, ALLOWED_KEYPAIRS: pairs });
            try {
                assert.equal((await s.post('/ping', {})).status, 400);
                assert.equal((await s.post('/ping', {}, { 'x-api-key': 'tok-wrong-1234' })).status, 400);
                assert.match(s.output(), /Access: public/);
            } finally {
                await s.stop();
            }
        }
    });

    test('a typo in ALLOW_PUBLIC_USE locks the server instead of opening it', async () => {
        const s = await startServer({ ALLOW_PUBLIC_USE: 'flase', ALLOWED_KEYPAIRS: pairs });
        try {
            assert.equal((await s.post('/ping', {})).status, 401);
            assert.match(s.output(), /ALLOW_PUBLIC_USE="flase" is not true\/false; treating it as false/);
        } finally {
            await s.stop();
        }
    });

    test('false with no usable keys refuses everything and warns', async () => {
        const s = await startServer({ ALLOW_PUBLIC_USE: 'false', ALLOWED_KEYPAIRS: '[{user:"x", token:"tok-xxxxxxxx"}]' });
        try {
            assert.equal((await s.post('/ping', {}, { 'x-api-key': 'tok-xxxxxxxx' })).status, 401);
            assert.match(s.output(), /has no valid expiry/);
            assert.match(s.output(), /All POST requests will be refused/);
        } finally {
            await s.stop();
        }
    });
});
