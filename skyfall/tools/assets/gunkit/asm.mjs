import {chromium} from '/opt/node-tools/node_modules/playwright/index.mjs';import http from 'http';import fs from 'fs';import path from 'path';
const dir=process.argv[2],q=process.argv[3]||'',out=process.argv[4],expDir=process.argv[5];
const srv=http.createServer((rq,s)=>{const f=path.join(dir,decodeURIComponent(rq.url.split('?')[0]));try{const d=fs.readFileSync(f);s.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});s.end(d);}catch{s.writeHead(404);s.end();}}).listen(8932);
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:1800,height:1200}});p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>{if(m.type()==='error')console.log(m.text())});
await p.goto('http://localhost:8932/asm.html?'+q);await p.waitForFunction(()=>window.done,null,{timeout:120000});await p.screenshot({path:out});
if(expDir){const o=await p.evaluate(()=>window.out);for(const [k,v] of Object.entries(o)){fs.writeFileSync(path.join(expDir,k),Buffer.from(v,'base64'));console.log('wrote',k);}}
console.log('META',JSON.stringify(await p.evaluate(()=>window.meta)));await b.close();srv.close();
