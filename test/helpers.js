const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

/**
 * Start server.js as a child process (same way `npm start` does) so the
 * tests exercise the real entry point. Extra env vars configure the server.
 */
async function startServer(env = {}) {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        // Access settings are set explicitly so the local .env does not change
        // test results (.env never overrides variables that are already set).
        env: { ...process.env, ALLOW_PUBLIC_USE: 'true', ALLOWED_KEYPAIRS: '', PORT: String(port), ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });

    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 10000;
    for (;;) {
        try {
            await fetch(`${baseUrl}/test`);
            break;
        } catch {
            if (child.exitCode !== null || Date.now() > deadline) {
                child.kill();
                throw new Error(`server did not start:\n${output}`);
            }
            await new Promise(r => setTimeout(r, 100));
        }
    }

    async function request(method, p, body, headers = {}) {
        const res = await fetch(baseUrl + p, {
            method,
            headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
            body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
        });
        const text = await res.text();
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* keep text */ }
        return { status: res.status, headers: res.headers, body: parsed };
    }

    return {
        baseUrl,
        output: () => output,
        get: (p, headers) => request('GET', p, undefined, headers),
        post: (p, body, headers) => request('POST', p, body, headers),
        stop: () => new Promise(resolve => {
            child.once('exit', resolve);
            child.kill();
        })
    };
}

module.exports = { startServer, freePort };
