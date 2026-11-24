/**
 * ALLOWED_KEYPAIRS: the list of users allowed to call the server when
 * ALLOW_PUBLIC_USE=false.
 *
 * Accepts strict JSON or the relaxed form used in .env:
 *   [
 *     {user:"warehouse_syd", token:"...", expiry:2524651200000},
 *   ]
 * (unquoted keys, single or double quotes, trailing commas, # or // comments).
 *
 * expiry is a Unix epoch time. Milliseconds are expected; values below 1e11
 * are treated as seconds (1e11 ms is 1973, 1e11 s is year 5138).
 */
const crypto = require('crypto');

function parseRelaxedJson(text) {
    let i = 0;

    const fail = msg => {
        throw new Error(`${msg} at position ${i}`);
    };

    function skip() {
        for (;;) {
            while (i < text.length && /\s/.test(text[i])) i++;
            if (text[i] === '#' || (text[i] === '/' && text[i + 1] === '/')) {
                while (i < text.length && text[i] !== '\n') i++;
                continue;
            }
            return;
        }
    }

    function string() {
        const quote = text[i++];
        let out = '';
        while (i < text.length && text[i] !== quote) {
            if (text[i] === '\\') {
                const next = text[i + 1];
                const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '\\': '\\', '/': '/', '"': '"', "'": "'" };
                if (next === 'u') {
                    out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
                    i += 6;
                    continue;
                }
                if (!(next in map)) fail('bad escape');
                out += map[next];
                i += 2;
                continue;
            }
            out += text[i++];
        }
        if (text[i] !== quote) fail('unterminated string');
        i++;
        return out;
    }

    function value() {
        skip();
        const c = text[i];
        if (c === '{') return object();
        if (c === '[') return array();
        if (c === '"' || c === "'") return string();
        const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
        if (m) {
            i += m[0].length;
            return Number(m[0]);
        }
        for (const [word, v] of [['true', true], ['false', false], ['null', null]]) {
            if (text.startsWith(word, i)) {
                i += word.length;
                return v;
            }
        }
        return fail('unexpected character');
    }

    function key() {
        skip();
        if (text[i] === '"' || text[i] === "'") return string();
        const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
        if (!m) fail('expected a key');
        i += m[0].length;
        return m[0];
    }

    function object() {
        i++; // {
        const out = {};
        for (;;) {
            skip();
            if (text[i] === '}') { i++; return out; }
            const k = key();
            skip();
            if (text[i] !== ':') fail('expected ":"');
            i++;
            Object.defineProperty(out, k, { value: value(), enumerable: true, writable: true, configurable: true });
            skip();
            if (text[i] === ',') { i++; continue; }
            if (text[i] === '}') { i++; return out; }
            fail('expected "," or "}"');
        }
    }

    function array() {
        i++; // [
        const out = [];
        for (;;) {
            skip();
            if (text[i] === ']') { i++; return out; }
            out.push(value());
            skip();
            if (text[i] === ',') { i++; continue; }
            if (text[i] === ']') { i++; return out; }
            fail('expected "," or "]"');
        }
    }

    const result = value();
    skip();
    if (i !== text.length) fail('unexpected trailing text');
    return result;
}

function toEpochMs(expiry) {
    const n = typeof expiry === 'string' && expiry.trim() !== '' ? Number(expiry) : expiry;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
    return n < 1e11 ? n * 1000 : n;
}

const hash = token => crypto.createHash('sha256').update(String(token)).digest();

/**
 * @returns {{ entries: {user: string, tokenHash: Buffer, expiresAt: number}[], warnings: string[] }}
 */
function parseKeypairs(raw) {
    const warnings = [];
    if (!raw || !raw.trim()) return { entries: [], warnings };

    let list;
    try {
        list = parseRelaxedJson(raw.trim());
    } catch (e) {
        return { entries: [], warnings: [`ALLOWED_KEYPAIRS could not be parsed (${e.message}); no keys are accepted.`] };
    }
    if (!Array.isArray(list)) list = [list];

    const entries = [];
    list.forEach((item, index) => {
        const label = `ALLOWED_KEYPAIRS[${index}]`;
        if (!item || typeof item !== 'object') {
            warnings.push(`${label} is not an object; skipped.`);
            return;
        }
        if (typeof item.token !== 'string' || item.token.length < 8) {
            warnings.push(`${label} has no token (at least 8 characters); skipped.`);
            return;
        }
        const expiresAt = toEpochMs(item.expiry);
        if (expiresAt === null) {
            warnings.push(`${label} has no valid expiry (epoch time); skipped.`);
            return;
        }
        entries.push({
            user: item.user === undefined || item.user === null ? `#${index}` : String(item.user),
            tokenHash: hash(item.token),
            expiresAt
        });
    });
    return { entries, warnings };
}

/**
 * Checks a token. Compares against every entry in constant time per entry.
 * @returns {{ ok: true, user: string } | { ok: false, reason: 'missing' | 'invalid' | 'expired' }}
 */
function checkToken(entries, token, now = Date.now()) {
    if (!token) return { ok: false, reason: 'missing' };
    const h = hash(token);
    let valid = null;
    let expired = false;
    for (const e of entries) {
        if (crypto.timingSafeEqual(e.tokenHash, h)) {
            if (e.expiresAt > now) valid = valid || e;
            else expired = true;
        }
    }
    if (valid) return { ok: true, user: valid.user };
    return { ok: false, reason: expired ? 'expired' : 'invalid' };
}

module.exports = { parseRelaxedJson, parseKeypairs, checkToken, toEpochMs };
