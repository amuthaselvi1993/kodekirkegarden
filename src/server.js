// Webklienten med startknapp: npm run web  ->  http://localhost:3000
// Serverer web/, starter agenten når noen trykker «Start scan», og leverer rapporten.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { kjørAgent } from './agent.js';
import { system, eksempelOppgave, verktøy, hentFunn, nullstillFunn } from './verktoy.js';
import { skrivRapport, RAPPORT } from './rapport.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

const PORT = Number(process.env.PORT ?? 3000);
const WEB = path.resolve(import.meta.dirname, '../web');
const TYPER = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };

let kjøring = { state: 'idle', message: '', runId: null };

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': TYPER['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendFil(res, fil) {
  if (!fs.existsSync(fil) || !fs.statSync(fil).isFile()) return sendJson(res, 404, { error: 'Ikke funnet' });
  res.writeHead(200, { 'Content-Type': TYPER[path.extname(fil)] ?? 'text/plain', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(fil));
}

async function lesBody(req) {
  const deler = [];
  for await (const d of req) deler.push(d);
  try {
    return JSON.parse(Buffer.concat(deler).toString() || '{}');
  } catch {
    return {};
  }
}

function lagOppgave({ scope }) {
  const verdi = String(scope?.value ?? '').replace(/\s+/g, ' ').slice(0, 100);
  if (scope?.type === 'module' && verdi) return `${eksempelOppgave} Avgrens til modulen «${verdi}».`;
  if (scope?.type === 'path' && verdi) return `${eksempelOppgave} Avgrens til stien «${verdi}».`;
  return 'Finn all død kode i hjemsokt-repo og meld inn alle funn.';
}

async function start(body) {
  const runId = `run-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  kjøring = { state: 'running', message: 'Agenten graver…', runId };
  nullstillFunn();
  try {
    await kjørAgent({ system, oppgave: lagOppgave(body), verktøy });
    const rapport = skrivRapport(hentFunn());
    kjøring = { state: 'done', message: `${rapport.safe.length + rapport.review.length} funn`, runId };
  } catch (e) {
    kjøring = { state: 'failed', message: e.message, runId };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/start') {
    // Krever JSON: da kan ikke andre nettsider sende kallet uten CORS-forespørsel (som vi ikke svarer på).
    if (!req.headers['content-type']?.startsWith('application/json')) return sendJson(res, 415, { error: 'Må være application/json' });
    if (!process.env.ANTHROPIC_API_KEY) return sendJson(res, 400, { error: 'Mangler ANTHROPIC_API_KEY i .env' });
    if (kjøring.state === 'running') return sendJson(res, 409, { error: 'Agenten kjører allerede' });
    start(await lesBody(req));
    return sendJson(res, 202, { runId: kjøring.runId, statusUrl: '/api/status' });
  }

  if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, kjøring);
  if (req.method === 'GET' && url.pathname === '/report.json') return sendFil(res, RAPPORT);

  if (req.method === 'GET') {
    const fil = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fil.startsWith(WEB + path.sep)) return sendJson(res, 403, { error: 'Forbudt' });
    return sendFil(res, fil);
  }

  sendJson(res, 405, { error: 'Metode ikke støttet' });
});

// Bare på denne maskinen: startknappen koster API-kreditter.
server.listen(PORT, '127.0.0.1', () => console.log(`\n🪦 Kodekirkegården: http://localhost:${PORT}\n`));
