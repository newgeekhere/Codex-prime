const MAX_BODY = 16_000;
const LIMITS = { name: 160, url: 2048, description: 2000, type: 64, category: 120 };
const cors = (request, env) => {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, If-Match, Cf-Access-Jwt-Assertion' } : {};
};
function response(data, status, headers = {}) { return new Response(data == null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
function validUrl(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && u.username === '' && u.password === ''; } catch { return false; } }
function validate(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'Fiche invalide.';
  for (const [key, max] of Object.entries(LIMITS)) if (typeof record[key] !== 'string' || record[key].length > max || !record[key].trim()) return `Champ invalide : ${key}.`;
  if (!validUrl(record.url)) return 'L’URL doit commencer par http:// ou https://.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.verifiedAt) || Number.isNaN(Date.parse(record.verifiedAt))) return 'Date invalide.';
  if (!record.customFields || typeof record.customFields !== 'object' || Array.isArray(record.customFields)) return 'Champs personnalisés invalides.';
  if (Object.keys(record.customFields).length > 100) return 'Trop de champs personnalisés.';
  for (const [key, value] of Object.entries(record.customFields)) {
    if (!key || key.length > 100 || !['string','number','boolean'].includes(typeof value) && value !== null && !Array.isArray(value)) return 'Champ personnalisé invalide.';
    if (JSON.stringify(value).length > 4000) return 'Champ personnalisé trop long.';
  }
  return null;
}
function configured(env) { return !!(env.DATA && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && env.ACCESS_ALLOWED_EMAILS); }
async function verifyTurnstile(token, env) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_HOSTNAME) return { status: 503, error: 'Turnstile n’est pas configuré côté serveur.' };
  if (typeof token !== 'string' || !token || token.length > 2048) return { status: 403, error: 'Validation anti-robot manquante.' };
  try {
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(10000)
    });
    if (!result.ok) return { status: 502, error: 'Vérification anti-robot indisponible.' };
    const data = await result.json();
    if (!data.success || data.hostname !== env.TURNSTILE_HOSTNAME || data.action !== (env.TURNSTILE_ACTION || 'soumission')) return { status: 403, error: 'Validation anti-robot refusée.' };
    return null;
  } catch { return { status: 502, error: 'Vérification anti-robot indisponible.' }; }
}
async function authorized(request, env) {
  if (!configured(env)) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    const [h,p,s] = token.split('.');
    const header = JSON.parse(atob(h.replace(/-/g,'+').replace(/_/g,'/')));
    const payload = JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));
    if (header.alg !== 'RS256' || payload.aud !== env.ACCESS_AUD || payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}` || payload.exp <= Date.now()/1000) return false;
    const keys = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`).then(r => r.json());
    const jwk = keys.keys.find(k => k.kid === header.kid); if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
    const bytes = x => Uint8Array.from(atob(x.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(s), new TextEncoder().encode(`${h}.${p}`));
    return ok && (env.ACCESS_ALLOWED_EMAILS.split(',').map(x=>x.trim().toLowerCase()).includes(String(payload.email||'').toLowerCase()));
  } catch { return false; }
}
export default {
 async fetch(request, env) {
  const headers = cors(request, env);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  const u = new URL(request.url), parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return response({error:'Not found'},404,headers);
  if (request.method === 'GET' && parts.length === 1) {
   if (!env.DATA) return response({records:[],comments:[],writable:false},200,headers);
   const [objects, commentObjects] = await Promise.all([env.DATA.list({prefix:'fiches/'}),env.DATA.list({prefix:'commentaires/'})]);
   const read = async (list) => Promise.all(list.objects.map(async o => { const v=await env.DATA.get(o.key); try{return JSON.parse(await v.text())}catch{return null} }));
   const [records,comments]=await Promise.all([read(objects),read(commentObjects)]);
   return response({records:records.filter(Boolean),comments:comments.filter(Boolean),writable:false},200,headers);
  }
  if (parts.length >= 2 && parts[1] === 'initialize' && request.method === 'POST') {
   if (!await authorized(request,env)) return response({error:'Non autorisé'},403,headers);
   const body=await request.text(); if(body.length>MAX_BODY)return response({error:'Requête trop volumineuse'},413,headers);
   let records;try{records=JSON.parse(body)}catch{return response({error:'JSON invalide'},400,headers)}
   if(!Array.isArray(records)||records.length>200)return response({error:'Liste invalide'},400,headers);
   let created=0; for(const r of records){const err=validate(r);if(err||!/^outil-[a-f0-9]{16}$/.test(r.outilId))return response({error:err||'Identifiant invalide'},400,headers);const key=`fiches/${r.outilId}.json`;if(await env.DATA.get(key))continue;await env.DATA.put(key,JSON.stringify({...r,version:1}),{onlyIf:{etagDoesNotMatch:'*'}});created++;}
   return response({created},200,headers);
  }
  const id=parts[1], key=`fiches/${id}.json`;
  if(!/^outil-[a-f0-9]{16}$/.test(id||''))return response({error:'Identifiant invalide'},400,headers);
  if(request.method==='PUT'&&parts.length===2){if(!await authorized(request,env))return response({error:'Non autorisé'},403,headers);const body=await request.text();if(body.length>MAX_BODY)return response({error:'Requête trop volumineuse'},413,headers);let next;try{next=JSON.parse(body)}catch{return response({error:'JSON invalide'},400,headers)}const turnstileError=await verifyTurnstile(next?.turnstileToken,env);if(turnstileError)return response({error:turnstileError.error},turnstileError.status,headers);const {turnstileToken,...record}=next;const err=validate(record);if(err)return response({error:err},400,headers);if(record.outilId!==id)return response({error:'Identifiant immuable'},400,headers);const current=await env.DATA.get(key);if(!current)return response({error:'Fiche introuvable'},404,headers);const old=JSON.parse(await current.text()), expected=Number(request.headers.get('If-Match'));if(!Number.isInteger(expected)||expected!==old.version)return response({error:'Conflit : une version plus récente existe.',current:old},409,headers);const saved={...record,version:old.version+1};await env.DATA.put(key,JSON.stringify(saved),{onlyIf:{etagMatches:current.etag}});return response(saved,200,headers);}
  if(request.method==='POST'&&parts.length===3&&parts[2]==='comments'){if(!await authorized(request,env))return response({error:'Non autorisé'},403,headers);if(!await env.DATA.get(key))return response({error:'Fiche introuvable'},404,headers);const body=await request.text();if(body.length>4000)return response({error:'Commentaire trop long'},413,headers);let data;try{data=JSON.parse(body)}catch{return response({error:'JSON invalide'},400,headers)}const turnstileError=await verifyTurnstile(data?.turnstileToken,env);if(turnstileError)return response({error:turnstileError.error},turnstileError.status,headers);if(typeof data.text!=='string'||!data.text.trim()||data.text.length>2000)return response({error:'Commentaire invalide'},400,headers);const comment={commentId:crypto.randomUUID(),outilId:id,text:data.text.trim(),createdAt:new Date().toISOString()};await env.DATA.put(`commentaires/${id}/${comment.commentId}.json`,JSON.stringify(comment));return response(comment,201,headers);}
  return response({error:'Not found'},404,headers);
 }
};
