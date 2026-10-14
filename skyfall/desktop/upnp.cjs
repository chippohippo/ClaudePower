// Minimal UPnP Internet Gateway Device client: asks the home router to forward a TCP port to this PC
// so friends can join a hosted game over the internet without manual port forwarding.
//   discover()  SSDP search on the LAN → the gateway's control URL
//   mapPort()   AddPortMapping (+ GetExternalIPAddress)
//   unmapPort() DeletePortMapping
// Everything fails soft: routers with UPnP off simply report an error and the host is told which port
// to forward by hand. SKYFALL_UPNP_LOCATION=<description url> skips discovery (tests).

const dgram = require('node:dgram');
const http = require('node:http');
const net = require('node:net');

const SSDP_ADDR = '239.255.255.250', SSDP_PORT = 1900;
const TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

function discoverLocation(timeout = 2500) {
  if (process.env.SKYFALL_UPNP_LOCATION) return Promise.resolve(process.env.SKYFALL_UPNP_LOCATION);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = (err, loc) => { clearTimeout(timer); try { sock.close(); } catch { /* closed */ } err ? reject(err) : resolve(loc); };
    const timer = setTimeout(() => done(new Error('no UPnP router answered')), timeout);
    sock.on('error', (e) => done(e));
    sock.on('message', (buf) => {
      const m = /^location:\s*(.+)$/im.exec(buf.toString());
      if (m) done(null, m[1].trim());
    });
    sock.bind(() => {
      for (const st of TARGETS) {
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        sock.send(msg, SSDP_PORT, SSDP_ADDR);
      }
    });
  });
}

function request(url, { method = 'GET', headers = {}, body = null, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('router did not answer')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const tag = (xml, name) => { const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'i').exec(xml); return m ? m[1].trim() : null; };

// Description XML → { controlUrl, serviceType } of the WAN IP / PPP connection service.
function findService(xml, location) {
  const services = xml.split(/<service>/i).slice(1).map((s) => s.split(/<\/service>/i)[0]);
  for (const want of ['WANIPConnection', 'WANPPPConnection']) {
    const s = services.find((x) => (tag(x, 'serviceType') || '').includes(want));
    if (s) {
      const base = tag(xml, 'URLBase') || location;
      return { controlUrl: new URL(tag(s, 'controlURL'), base).toString(), serviceType: tag(s, 'serviceType') };
    }
  }
  return null;
}

async function soap(svc, action, args = {}) {
  const body = `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${svc.serviceType}">${Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const res = await request(svc.controlUrl, {
    method: 'POST', body,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${svc.serviceType}#${action}"`, 'Content-Length': Buffer.byteLength(body) },
  });
  if (res.status !== 200) {
    const code = tag(res.body, 'errorCode'), desc = tag(res.body, 'errorDescription');
    throw new Error(`${action} refused${code ? ` (${code}${desc ? ` ${desc}` : ''})` : ` (HTTP ${res.status})`}`);
  }
  return res.body;
}

// The LAN address the router sees for us: the local end of a TCP connection to it.
function localAddressTowards(url) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: u.hostname, port: +u.port || 80, timeout: 3000 }, () => { const a = s.localAddress; s.destroy(); resolve(a.replace(/^::ffff:/, '')); });
    s.on('error', reject);
    s.on('timeout', () => s.destroy(new Error('router unreachable')));
  });
}

let cached = null;
async function gateway() {
  if (cached) return cached;
  const location = await discoverLocation();
  const desc = await request(location);
  const svc = findService(desc.body, location);
  if (!svc) throw new Error('router has no WAN connection service');
  svc.localIp = await localAddressTowards(svc.controlUrl);
  cached = svc;
  return svc;
}

async function mapPort(port, description = 'SKYFALL server') {
  const svc = await gateway();
  const args = (lease) => ({ NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP', NewInternalPort: port, NewInternalClient: svc.localIp, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: lease });
  // some routers only take permanent leases (0), others refuse them: try both
  try { await soap(svc, 'AddPortMapping', args(0)); } catch (e) { await soap(svc, 'AddPortMapping', args(86400)); }
  let externalIp = null;
  try { externalIp = tag(await soap(svc, 'GetExternalIPAddress'), 'NewExternalIPAddress'); } catch { /* optional */ }
  return { ok: true, externalIp, localIp: svc.localIp };
}

async function unmapPort(port) {
  if (!cached) return;
  try { await soap(cached, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }); } catch { /* already gone */ }
}

module.exports = { mapPort, unmapPort, findService, _reset: () => { cached = null; } };
