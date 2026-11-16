import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker from '../index.js';

function bucket() {
  const data = new Map();
  return {
    data,
    async get(key) { const value=data.get(key); return value===undefined?null:{text:async()=>value}; },
    async put(key,value) { data.set(key,value); },
    async list({prefix=''}) { return {objects:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}; }
  };
}
const origin='https://newgeekhere.github.io';
const env=()=>({DATA:bucket(),ALLOWED_ORIGIN:origin});

test('public read works while writes remain disabled until Access is configured', async()=>{
 const e=env(); const read=await worker.fetch(new Request('https://worker.test/api/outils'),e); assert.equal(read.status,200); assert.deepEqual((await read.json()).records,[]);
 const write=await worker.fetch(new Request('https://worker.test/api/outils/outil-0123456789abcdef',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json','If-Match':'1'},body:'{}'}),e); assert.equal(write.status,403);
 const comment=await worker.fetch(new Request('https://worker.test/api/outils/outil-0123456789abcdef/commentaires',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),e); assert.equal(comment.status,403);
});

test('catalogue and per-tool comments use the same R2 data', async()=>{
 const e=env(), id='outil-0123456789abcdef';
 await e.DATA.put(`fiches/${id}.json`,JSON.stringify({outilId:id,name:'A',version:1}));
 await e.DATA.put(`commentaires/${id}/one.json`,JSON.stringify({outilId:id,text:'Premier'}));
 await e.DATA.put('commentaires/outil-ffffffffffffffff/two.json',JSON.stringify({outilId:'outil-ffffffffffffffff',text:'Autre'}));
 const list=await worker.fetch(new Request('https://worker.test/api/outils'),e);
 assert.equal(list.status,200);
 assert.equal((await list.json()).records[0].outilId,id);
 const comments=await worker.fetch(new Request(`https://worker.test/api/outils/${id}/commentaires`),e);
 assert.equal(comments.status,200);
 assert.deepEqual((await comments.json()).comments.map(item=>item.text),['Premier']);
});

test('authentication gate runs before accepting initialization data', async()=>{
 const e=env(); const response=await worker.fetch(new Request('https://worker.test/api/initialize',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify([{outilId:'outil-0123456789abcdef',name:'A',url:'javascript:alert(1)',description:'d',type:'CLI',category:'cat',verifiedAt:'2026-11-09',customFields:{}}])}),e); assert.equal(response.status,403); // auth gate runs before any payload write
});

test('authorized update and comment persist, while stale edits conflict', async()=>{
 const e=env(), id='outil-0123456789abcdef';
 Object.assign(e,{ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'audience',ACCESS_ALLOWED_EMAILS:'editor@example.com',TURNSTILE_SECRET_KEY:'test-secret',TURNSTILE_HOSTNAME:'newgeekhere.github.io',TURNSTILE_ACTION:'soumission'});
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
 const encoded=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const header=encoded({alg:'RS256',kid:'test-key'});
 const payload=encoded({type:'app',aud:['audience'],iss:'https://example.cloudflareaccess.com',email:'editor@example.com',exp:Math.floor(Date.now()/1000)+300});
 const unsigned=`${header}.${payload}`;
 const token=`${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url')}`;
 const record={outilId:id,name:'Modifié',url:'https://example.com',description:'Description',type:'CLI',category:'Code',verifiedAt:'2026-11-09',customFields:{}};
 await e.DATA.put(`fiches/${id}.json`,JSON.stringify({...record,name:'Original',version:1}));
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>url.includes('/cdn-cgi/access/certs')?Response.json({keys:[jwk]}):Response.json({success:true,hostname:e.TURNSTILE_HOSTNAME,action:e.TURNSTILE_ACTION});
 try {
  const catalogue=await worker.fetch(new Request('https://worker.test/api/outils'),e);
  assert.equal((await catalogue.json()).writable,true);
  const headers={'Cf-Access-Jwt-Assertion':token,'Content-Type':'application/json','If-Match':'1'};
  const initial=Array.from({length:54},(_,i)=>({...record,outilId:`outil-${i.toString(16).padStart(16,'0')}`,description:'x'.repeat(400)}));
  const initialBody=JSON.stringify(initial);
  assert.ok(initialBody.length>16_000 && initialBody.length<64_000);
  const initialize=()=>worker.fetch(new Request('https://worker.test/api/initialize',{method:'POST',headers,body:initialBody}),e);
  const first=await initialize();
  assert.equal(first.status,200);
  assert.equal((await first.json()).created,54);
  const second=await initialize();
  assert.equal(second.status,200);
  assert.equal((await second.json()).created,0);
  const update=await worker.fetch(new Request(`https://worker.test/api/outils/${id}`,{method:'PUT',headers,body:JSON.stringify({...record,turnstileToken:'test-token'})}),e);
  assert.equal(update.status,200);
  assert.equal((await update.json()).version,2);
  const stale=await worker.fetch(new Request(`https://worker.test/api/outils/${id}`,{method:'PUT',headers,body:JSON.stringify({...record,turnstileToken:'test-token'})}),e);
  assert.equal(stale.status,409);
  const invalid=await worker.fetch(new Request(`https://worker.test/api/outils/${id}`,{method:'PUT',headers:{...headers,'If-Match':'2'},body:JSON.stringify({...record,url:'javascript:alert(1)',turnstileToken:'test-token'})}),e);
  assert.equal(invalid.status,400);
  const comment=await worker.fetch(new Request(`https://worker.test/api/outils/${id}/commentaires`,{method:'POST',headers,body:JSON.stringify({text:'Bonjour',turnstileToken:'test-token'})}),e);
  assert.equal(comment.status,201);
  const read=await worker.fetch(new Request(`https://worker.test/api/outils/${id}/commentaires`),e);
  assert.deepEqual((await read.json()).comments.map(item=>item.text),['Bonjour']);
 } finally { globalThis.fetch=originalFetch; }
});

test('HTML inventory has a fixed ID and both actions for each catalog item', async()=>{
 const {readFile}=await import('node:fs/promises'); const html=await readFile(new URL('../../outils.html',import.meta.url),'utf8');
 assert.equal((html.match(/<article class="tool-card"/g)||[]).length,54);
 assert.equal((html.match(/data-action="edit"/g)||[]).length,54);
 assert.equal((html.match(/data-action="comment"/g)||[]).length,54);
 assert.equal((html.match(/data-outil-id="outil-[a-f0-9]{16}"/g)||[]).length,162);
 assert.match(html,/turnstileSiteKey='0x4AAAAAAF6HheU0hxAIjwhO'/);
 assert.match(html,/action:'soumission'/);
 assert.match(html,/turnstileToken\}\)/);
 assert.match(html,/api\.js\?render=explicit&amp;onload=onTurnstileLoaded/);
 assert.match(html,/request\('\/outils'\)/);
 assert.match(html,/request\(`\/outils\/\$\{id\}\/commentaires`\)/);
 assert.match(html,/request\(`\/outils\/\$\{editingId\}\/commentaires`/);
 assert.match(html,/request\(`\/outils\/\$\{editingId\}`/);
 assert.match(html,/await ensureInitialized\(\)/);
});
