/**
 * Checks connection strings sent by clients before the server connects.
 *
 * Uses the same parser as the MongoDB driver so the check and the driver
 * always agree on which hosts a URI points at.
 */
const dns = require('dns').promises;
const net = require('net');
const { ConnectionString } = require('mongodb-connection-string-url');
const { badRequest, forbidden } = require('./errors');

// URI options that make the server read its own files or use its own
// identity (cloud metadata, Kerberos, AWS keys) on behalf of the caller,
// or route the connection through another host.
const UNSAFE_OPTIONS = new Set([
    'tlscafile',
    'tlscertificatekeyfile',
    'tlscertificatekeyfilepassword',
    'tlscertificatefile',
    'tlscrlfile',
    'sslca',
    'sslcert',
    'sslkey',
    'sslpass',
    'sslcrl',
    'proxyhost',
    'proxyport',
    'proxyusername',
    'proxypassword'
]);

const UNSAFE_AUTH_MECHANISMS = new Set(['MONGODB-AWS', 'MONGODB-OIDC', 'GSSAPI']);

const privateRanges = new net.BlockList();
for (const [addr, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) {
    privateRanges.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96],
    ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]) {
    privateRanges.addSubnet(addr, prefix, 'ipv6');
}

function isPrivateAddress(ip) {
    const family = net.isIP(ip);
    if (family === 4) return privateRanges.check(ip, 'ipv4');
    if (family === 6) return privateRanges.check(ip, 'ipv6');
    return true; // not an IP at all: treat as unsafe
}

function hostnameOf(hostWithPort) {
    if (hostWithPort.startsWith('[')) {
        return hostWithPort.slice(1, hostWithPort.indexOf(']'));
    }
    const i = hostWithPort.lastIndexOf(':');
    return (i === -1 ? hostWithPort : hostWithPort.slice(0, i)).toLowerCase();
}

function matchesAllowList(hostname, patterns) {
    return patterns.some(p => {
        if (p.startsWith('*.')) {
            return hostname.endsWith(p.slice(1)) && hostname.length > p.length - 1;
        }
        return hostname === p;
    });
}

async function resolveAddresses(hostname, isSrv) {
    if (net.isIP(hostname)) return [hostname];
    const targets = isSrv
        ? (await dns.resolveSrv(`_mongodb._tcp.${hostname}`)).map(r => r.name)
        : [hostname];
    const addresses = [];
    for (const target of targets) {
        if (net.isIP(target)) {
            addresses.push(target);
            continue;
        }
        const found = await dns.lookup(target, { all: true, verbatim: true });
        addresses.push(...found.map(a => a.address));
    }
    return addresses;
}

/**
 * Throws an HttpError if a client-supplied URI is not allowed.
 * @param {string} uri
 * @param {object} cfg  the config module
 */
async function assertClientUriAllowed(uri, cfg) {
    let cs;
    try {
        cs = new ConnectionString(uri);
    } catch (e) {
        throw badRequest(`Invalid mongoURI: ${e.message}`);
    }

    if (!cfg.allowUnsafeUriOptions) {
        for (const [key, value] of cs.searchParams.entries()) {
            const k = key.toLowerCase();
            if (UNSAFE_OPTIONS.has(k)) {
                throw forbidden(`mongoURI option "${key}" is not allowed on this server.`);
            }
            if (k === 'authmechanism' && UNSAFE_AUTH_MECHANISMS.has(String(value).toUpperCase())) {
                throw forbidden(`authMechanism "${value}" is not allowed on this server.`);
            }
        }
    }

    const hostnames = cs.hosts.map(hostnameOf);

    if (cfg.allowedMongoHosts.length > 0) {
        const denied = hostnames.find(h => !matchesAllowList(h, cfg.allowedMongoHosts));
        if (denied) {
            throw forbidden(`Host "${denied}" is not in ALLOWED_MONGO_HOSTS.`);
        }
    }

    if (cfg.blockPrivateHosts) {
        for (const hostname of hostnames) {
            let addresses;
            try {
                addresses = await resolveAddresses(hostname, cs.isSRV);
            } catch (e) {
                throw badRequest(`Could not resolve host "${hostname}": ${e.code || e.message}`);
            }
            if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
                throw forbidden(`Host "${hostname}" resolves to a private or reserved address.`);
            }
        }
    }
}

module.exports = { assertClientUriAllowed, isPrivateAddress, matchesAllowList, hostnameOf };
