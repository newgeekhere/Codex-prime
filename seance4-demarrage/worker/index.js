const MAX_BYTES = 16 * 1024;

async function readJson(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new RangeError('Body too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = Boolean(env.ALLOWED_ORIGIN) && request.headers.get('Origin') === env.ALLOWED_ORIGIN;
    function reply(status, message, extra = {}) {
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
      if (allowed) headers['Access-Control-Allow-Origin'] = env.ALLOWED_ORIGIN;
      return new Response(JSON.stringify({ message, ...extra }), { status, headers });
    }
    if (url.pathname !== '/api/soumissions') return reply(404, 'Adresse inconnue.');
    if (!allowed) return reply(403, 'Origine non autorisée.');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin'
      } });
    }
    if (request.method !== 'POST') return reply(405, 'Méthode non autorisée.');
    if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415, 'Un contenu JSON est attendu.');
    }
    let data;
    try { data = await readJson(request); }
    catch (error) { return reply(error instanceof RangeError ? 413 : 400, 'Contenu trop volumineux ou JSON invalide.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, 'Une fiche est attendue.');
    const fields = {};
    for (const [name, max] of [['titre', 120], ['information', 2000], ['commentaire', 1000]]) {
      if (typeof data[name] !== 'string' || !data[name].trim() || data[name].trim().length > max) {
        return reply(400, `Champ ${name} invalide.`);
      }
      fields[name] = data[name].trim();
    }
    if (typeof data.turnstileToken !== 'string' || !data.turnstileToken || data.turnstileToken.length > 2048) {
      return reply(403, 'Validation anti-robot manquante.');
    }
    if (!env.DATA || !env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_HOSTNAME || !env.TURNSTILE_ACTION) {
      return reply(502, 'Configuration du service à vérifier.');
    }
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: data.turnstileToken }),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return reply(502, 'Vérification anti-robot indisponible.');
      const outcome = await response.json();
      if (!outcome.success || outcome.hostname !== env.TURNSTILE_HOSTNAME || outcome.action !== env.TURNSTILE_ACTION) {
        return reply(403, 'Validation anti-robot refusée.');
      }
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const key = `soumissions/${createdAt.slice(0, 10)}/${id}.json`;
      const stored = await env.DATA.put(key, JSON.stringify({ id, createdAt, ...fields }), {
        httpMetadata: { contentType: 'application/json' }
      });
      if (!stored) return reply(502, 'Enregistrement non confirmé.');
      return reply(201, 'Enregistré.', { id, createdAt });
    } catch {
      return reply(502, 'Service temporairement indisponible. Rien ne confirme l’enregistrement.');
    }
  }
};
