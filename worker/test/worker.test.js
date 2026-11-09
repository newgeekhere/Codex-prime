import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

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
const env=()=>({FICHES:bucket(),COMMENTAIRES:bucket(),ALLOWED_ORIGIN:origin});

test('public read works while writes remain disabled until Access is configured', async()=>{
 const e=env(); const read=await worker.fetch(new Request('https://worker.test/api'),e); assert.equal(read.status,200); assert.deepEqual((await read.json()).records,[]);
 const write=await worker.fetch(new Request('https://worker.test/api/outil-0123456789abcdef',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json','If-Match':'1'},body:'{}'}),e); assert.equal(write.status,403);
});

test('rejects invalid URL and overlong values', async()=>{
 const e=env(); const response=await worker.fetch(new Request('https://worker.test/api/initialize',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify([{outilId:'outil-0123456789abcdef',name:'A',url:'javascript:alert(1)',description:'d',type:'CLI',category:'cat',verifiedAt:'2026-11-09',customFields:{}}])}),e); assert.equal(response.status,403); // auth gate runs before any payload write
});

test('HTML inventory has a fixed ID and both actions for each catalog item', async()=>{
 const {readFile}=await import('node:fs/promises'); const html=await readFile(new URL('../../outils.html',import.meta.url),'utf8');
 assert.equal((html.match(/<article class="tool-card"/g)||[]).length,54);
 assert.equal((html.match(/data-action="edit"/g)||[]).length,54);
 assert.equal((html.match(/data-action="comment"/g)||[]).length,54);
 assert.equal((html.match(/data-outil-id="outil-[a-f0-9]{16}"/g)||[]).length,162);
});
