import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const valid = { titre: 'Bibliothèque', information: 'Ouverte le samedi', commentaire: 'Un accès clavier', turnstileToken: 'jeton-fictif' };
function req(data = valid, origin = 'https://cours.example') {
  return new Request('https://worker.example/api/soumissions', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
}
function config() {
  const objects = [];
  return { objects, env: { ALLOWED_ORIGIN: 'https://cours.example', TURNSTILE_HOSTNAME: 'cours.example',
    TURNSTILE_ACTION: 'soumission', TURNSTILE_SECRET_KEY: 'cle-fictive',
    DATA: { put: async (key, body) => { objects.push({ key, body }); return { key }; } } } };
}
function allowTurnstile(t, outcome = {}) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, hostname: 'cours.example', action: 'soumission', ...outcome }));
}
test('envoi valide : un objet privé et aucun jeton conservé', async t => {
  allowTurnstile(t);
  const { env, objects } = config();
  const response = await worker.fetch(req(), env);
  assert.equal(response.status, 201); assert.equal(objects.length, 1);
  assert.match(objects[0].key, /^soumissions\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.json$/);
  assert.equal(JSON.parse(objects[0].body).turnstileToken, undefined);
});
test('titre vide : refus serveur avant Turnstile et sans écriture', async t => {
  const f = t.mock.method(globalThis, 'fetch', () => { throw new Error('Ne doit pas être appelé'); });
  const { env, objects } = config();
  assert.equal((await worker.fetch(req({ ...valid, titre: ' ' }), env)).status, 400);
  assert.equal(objects.length, 0); assert.equal(f.mock.callCount(), 0);
});
test('jeton absent ou refusé : aucune écriture', async t => {
  allowTurnstile(t, { success: false }); const { env, objects } = config();
  assert.equal((await worker.fetch(req({ ...valid, turnstileToken: '' }), env)).status, 403);
  assert.equal((await worker.fetch(req(), env)).status, 403); assert.equal(objects.length, 0);
});
test('hostname ou action différent : refus', async t => {
  allowTurnstile(t, { hostname: 'autre.example' }); const { env, objects } = config();
  assert.equal((await worker.fetch(req(), env)).status, 403);
  globalThis.fetch.mock.restore(); allowTurnstile(t, { action: 'autre' });
  assert.equal((await worker.fetch(req(), env)).status, 403); assert.equal(objects.length, 0);
});
test('origine étrangère : refus et pas de permission CORS', async () => {
  const { env, objects } = config(); const r = await worker.fetch(req(valid, 'https://autre.example'), env);
  assert.equal(r.status, 403); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null); assert.equal(objects.length, 0);
});
test('corps de plus de 16 Kio : refus avant écriture', async () => {
  const { env, objects } = config(); assert.equal((await worker.fetch(req({ ...valid, information: 'x'.repeat(20000) }), env)).status, 413);
  assert.equal(objects.length, 0);
});
test('panne stockage : aucune fausse confirmation', async t => {
  allowTurnstile(t); const { env } = config(); env.DATA.put = async () => { throw new Error('Détail privé'); };
  const r = await worker.fetch(req(), env); assert.equal(r.status, 502); assert.equal((await r.text()).includes('Détail privé'), false);
});
test('deux envois : clés distinctes', async t => {
  allowTurnstile(t); const { env, objects } = config(); await worker.fetch(req(), env); await worker.fetch(req(), env);
  assert.equal(objects.length, 2); assert.notEqual(objects[0].key, objects[1].key);
});
