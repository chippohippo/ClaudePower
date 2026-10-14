// UPnP port-mapping test against a mock Internet Gateway Device (no router needed):
//   node tools/desktop/upnptest.cjs
const http = require('http');
const calls = [];
const desc = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><deviceList><device><deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType>
<serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId><controlURL>/ctl/IPConn</controlURL></service></serviceList>
</device></deviceList></device></deviceList></device></root>`;
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (req.url === '/desc.xml') return res.end(desc);
    const action = (req.headers.soapaction || '').split('#')[1].replace('"', '');
    calls.push({ action, body });
    if (action === 'AddPortMapping' && /<NewLeaseDuration>0</.test(body)) { res.writeHead(500); return res.end('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>725</errorCode><errorDescription>OnlyPermanentLeasesSupported</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>'); }
    if (action === 'GetExternalIPAddress') return res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>198.51.100.23</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>');
    res.end('<s:Envelope><s:Body/></s:Envelope>');
  });
});
srv.listen(0, '127.0.0.1', async () => {
  process.env.SKYFALL_UPNP_LOCATION = `http://127.0.0.1:${srv.address().port}/desc.xml`;
  const upnp = require('../../desktop/upnp.cjs');
  const r = await upnp.mapPort(3000);
  console.log('map result', r);
  await upnp.unmapPort(3000);
  const ok = r.ok && r.externalIp === '198.51.100.23' && calls.some((c) => c.action === 'DeletePortMapping') && calls.filter((c) => c.action === 'AddPortMapping').length === 2;
  console.log(calls.map((c) => c.action + (c.action === 'AddPortMapping' ? ` lease=${/<NewLeaseDuration>(\d+)/.exec(c.body)[1]} client=${/<NewInternalClient>([^<]+)/.exec(c.body)[1]} port=${/<NewExternalPort>(\d+)/.exec(c.body)[1]}` : '')).join('\n'));
  console.log(ok ? 'PASS upnp port mapping (permanent-lease fallback, external IP, unmap)' : 'FAIL upnp');
  srv.close();
  process.exitCode = ok ? 0 : 1;
});
