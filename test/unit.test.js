/**
 * Unit tests for input parsing and URI checks. No database or server needed.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId, Decimal128, Long } = require('mongodb');
const { createParsers, parseRegExpString } = require('../lib/query');
const { assertClientUriAllowed, isPrivateAddress, matchesAllowList } = require('../lib/uri-guard');

const parse = createParsers({ parseEjson: true, allowServerSideJs: false });

describe('RegExp strings', () => {
    test('keeps old "RegExp(pattern, flags)" behaviour', () => {
        assert.deepEqual(parseRegExpString('RegExp(^al, i)'), /^al/i);
        assert.deepEqual(parseRegExpString('RegExp(abc)'), /abc/);
        assert.deepEqual(parseRegExpString('RegExp(abc,)'), /abc/);
        assert.equal(parseRegExpString('hello'), undefined);
    });

    test('patterns with commas no longer throw', () => {
        assert.deepEqual(parseRegExpString('RegExp(x{1,2})'), /x{1,2}/);
        assert.deepEqual(parseRegExpString('RegExp(a,b, i)'), /a,b/i);
    });

    test('invalid patterns give a 400 error', () => {
        assert.throws(() => parseRegExpString('RegExp(()'), e => e.status === 400);
    });

    test('converted inside $or / $in at any depth', () => {
        const f = parse.filter({ $or: [{ name: 'RegExp(^a, i)' }, { tags: { $in: ['RegExp(x)'] } }] });
        assert.deepEqual(f.$or[0].name, /^a/i);
        assert.deepEqual(f.$or[1].tags.$in[0], /x/);
    });

    test('not converted in documents or updates', () => {
        assert.equal(parse.document({ a: 'RegExp(x)' }).a, 'RegExp(x)');
        assert.equal(parse.update({ $set: { a: 'RegExp(x)' } }).$set.a, 'RegExp(x)');
    });
});

describe('Extended JSON', () => {
    test('type wrappers are converted', () => {
        const f = parse.filter({
            _id: { $oid: '507f1f77bcf86cd799439011' },
            at: { $gte: { $date: '2026-01-01T00:00:00Z' } },
            price: { $numberDecimal: '9.99' },
            big: { $numberLong: '9007199254740993' }
        });
        assert.ok(f._id instanceof ObjectId);
        assert.ok(f.at.$gte instanceof Date);
        assert.ok(f.price instanceof Decimal128);
        assert.ok(f.big instanceof Long);
    });

    test('query operators are left alone (unlike bson EJSON.deserialize)', () => {
        const q = { a: { $regex: 'abc', $options: 'i', $nin: ['x'] }, b: { $elemMatch: { $regex: 'y' } }, c: { $type: 'string' } };
        assert.deepEqual(parse.filter(q), q);
    });

    test('plain JSON is unchanged', () => {
        const q = { a: 1, b: 'two', c: [1, { d: null }], e: { $gt: 1.5 } };
        assert.deepEqual(parse.filter(q), q);
    });

    test('bad wrapper values give 400', () => {
        assert.throws(() => parse.filter({ _id: { $oid: 'nope' } }), e => e.status === 400);
        assert.throws(() => parse.filter({ at: { $date: 'not a date' } }), e => e.status === 400);
    });

    test('can be turned off', () => {
        const off = createParsers({ parseEjson: false, allowServerSideJs: false });
        assert.deepEqual(off.filter({ _id: { $oid: 'x' } }), { _id: { $oid: 'x' } });
    });

    test('__proto__ keys stay plain data', () => {
        const input = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
        const out = parse.document(input);
        assert.equal(({}).polluted, undefined);
        assert.equal(Object.getPrototypeOf(out), Object.prototype);
        assert.deepEqual(Object.keys(out), ['__proto__', 'a']);
    });

    test('very deep nesting is rejected', () => {
        let deep = {};
        const root = deep;
        for (let i = 0; i < 150; i++) { deep.a = {}; deep = deep.a; }
        assert.throws(() => parse.filter(root), e => e.status === 400);
    });
});

describe('server-side JavaScript', () => {
    test('$where / $function / $accumulator blocked by default', () => {
        assert.throws(() => parse.filter({ $where: 'true' }), e => e.status === 403);
        assert.throws(() => parse.filter({ $expr: { $function: { body: 'x', args: [], lang: 'js' } } }), e => e.status === 403);
        assert.throws(() => parse.pipeline([{ $group: { _id: 1, x: { $accumulator: {} } } }]), e => e.status === 403);
        assert.throws(() => parse.options({ projection: { x: { $function: {} } } }), e => e.status === 403);
        assert.throws(() => parse.update([{ $set: { x: { $function: {} } } }]), e => e.status === 403);
    });

    test('allowed when ALLOW_SERVER_SIDE_JS=true', () => {
        const p = createParsers({ parseEjson: true, allowServerSideJs: true });
        assert.deepEqual(p.filter({ $where: 'true' }), { $where: 'true' });
    });
});

describe('options', () => {
    test('session is dropped, arrayFilters parsed', () => {
        const o = parse.options({ session: { x: 1 }, sort: { a: 1 }, arrayFilters: [{ 'e._id': { $oid: '507f1f77bcf86cd799439011' } }] });
        assert.equal(o.session, undefined);
        assert.deepEqual(o.sort, { a: 1 });
        assert.ok(o.arrayFilters[0]['e._id'] instanceof ObjectId);
    });
});

describe('URI guard', () => {
    const base = { allowUnsafeUriOptions: false, allowedMongoHosts: [], blockPrivateHosts: false };

    test('normal URIs pass', async () => {
        await assertClientUriAllowed('mongodb://user:pw@db.example.com:27017/app?retryWrites=true', base);
        await assertClientUriAllowed('mongodb+srv://user:pw@cluster0.abc.mongodb.net/?retryWrites=true&w=majority', base);
    });

    test('options that use server files or server identity are blocked', async () => {
        for (const uri of [
            'mongodb://h/?tlsCAFile=/etc/passwd',
            'mongodb://h/?TLSCERTIFICATEKEYFILE=/etc/ssl/key.pem',
            'mongodb://h/?authMechanism=MONGODB-AWS',
            'mongodb://h/?authMechanism=mongodb-oidc&authMechanismProperties=ENVIRONMENT:azure',
            'mongodb://h/?authMechanism=GSSAPI',
            'mongodb://h/?proxyHost=10.0.0.1'
        ]) {
            await assert.rejects(assertClientUriAllowed(uri, base), e => e.status === 403, uri);
        }
        await assertClientUriAllowed('mongodb://h/?tlsCAFile=/x', { ...base, allowUnsafeUriOptions: true });
    });

    test('ALLOWED_MONGO_HOSTS', async () => {
        const cfg = { ...base, allowedMongoHosts: ['*.mongodb.net', 'db.example.com'] };
        await assertClientUriAllowed('mongodb+srv://u:p@cluster0.abc.mongodb.net/', cfg);
        await assertClientUriAllowed('mongodb://u:p@DB.example.com:27017/', cfg);
        await assert.rejects(assertClientUriAllowed('mongodb://u:p@evil.com/', cfg), e => e.status === 403);
        await assert.rejects(assertClientUriAllowed('mongodb://db.example.com,10.0.0.5/', cfg), e => e.status === 403);
        await assert.rejects(assertClientUriAllowed('mongodb://mongodb.net.evil.com/', cfg), e => e.status === 403);
        assert.equal(matchesAllowList('mongodb.net', ['*.mongodb.net']), false);
    });

    test('BLOCK_PRIVATE_HOSTS', async () => {
        const cfg = { ...base, blockPrivateHosts: true };
        for (const uri of ['mongodb://127.0.0.1/', 'mongodb://localhost/', 'mongodb://[::1]:27017/', 'mongodb://169.254.169.254/', 'mongodb://10.1.2.3,8.8.8.8/']) {
            await assert.rejects(assertClientUriAllowed(uri, cfg), e => e.status === 403, uri);
        }
        await assertClientUriAllowed('mongodb://8.8.8.8/', cfg);
        assert.equal(isPrivateAddress('192.168.1.1'), true);
        assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
        assert.equal(isPrivateAddress('1.1.1.1'), false);
    });

    test('invalid URIs give 400', async () => {
        await assert.rejects(assertClientUriAllowed('mongodb://', base), e => e.status === 400);
    });
});
