// Webklienten med startknapp: npm run web  ->  http://localhost:3000
// Serverer web/, starter agenten når noen trykker «Start scan», og leverer rapporten.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

const [{ kjørAgent }, { system, eksempelOppgave, verktøy, hentFunn, nullstillFunn }, { skrivRapport, RAPPORT }] = await Promise.all([
  import('./agent.js'),
  import('./verktoy.js'),
  import('./rapport.js'),
]);

const PORT = Number(process.env.PORT ?? 3000);
const WEB = path.resolve(import.meta.dirname, '../web');
const REPO = path.resolve(import.meta.dirname, '../hjemsokt-repo');
const execFileAsync = promisify(execFile);
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
    if (!fs.existsSync(REPO) || !fs.statSync(REPO).isDirectory()) {
      throw new Error('Fant ikke hjemsokt-repo som skal skannes.');
    }

    async function git(args) {
      return execFileAsync('git', args, { cwd: path.resolve(import.meta.dirname, '..'), maxBuffer: 2 * 1024 * 1024 });
    }

    function approvedFiles(findings) {
      if (!Array.isArray(findings) || !findings.length) throw new Error('Godkjenn minst ett funn først.');
      const files = [];
      for (const finding of findings) {
        if (finding?.type !== 'File' || (finding.symbol && finding.symbol !== '(file)')) {
          throw new Error(`Kan bare legge hele filer i PR. «${finding?.path ?? 'ukjent'}» har ikke filnivå-funn.`);
        }
        const relative = typeof finding.path === 'string' ? finding.path : '';
        const full = path.resolve(REPO, relative);
        if (!relative || !full.startsWith(`${REPO}${path.sep}`)) throw new Error(`Ugyldig filsti «${relative}».`);
        files.push(relative.split(path.sep).join('/'));
      }
      return [...new Set(files)];
    }

    async function prepareApproved(req, res) {
      let payload;
      try {
        payload = JSON.parse(await lesBody(req));
      } catch (error) {
        return sendJson(res, 400, { error: `Ugyldig forespørsel: ${error.message}` });
      }

      try {
        const files = approvedFiles(payload.findings);
        const repoFiles = files.map((file) => path.posix.join('hjemsokt-repo', file));
        for (const file of repoFiles) await git(['ls-files', '--error-unmatch', '--', file]);
        const branch = `pr/approved-dead-code-${Date.now()}`;
        await git(['switch', '-c', branch]);
        for (const file of repoFiles) await git(['rm', '--', file]);
        const [stat, diff] = await Promise.all([
          git(['diff', '--cached', '--stat']),
          git(['diff', '--cached', '--no-ext-diff', '--']),
        ]);
        sendJson(res, 200, {
          status: 'prepared',
          branch,
          files,
          summary: stat.stdout.trim(),
          diff: diff.stdout,
          message: 'PR-forhåndsvisning klar. Ingen push eller GitHub-PR er opprettet.',
        });
      } catch (error) {
        sendJson(res, 400, { error: `Kunne ikke forberede godkjente endringer: ${error.message}` });
      }
    }

    async function openPr(req, res) {
      let payload;
      try {
        payload = JSON.parse(await lesBody(req));
      } catch (error) {
        return sendJson(res, 400, { error: `Ugyldig forespørsel: ${error.message}` });
      }

      const token = process.env.GITHUB_TOKEN;
      if (!token) return sendJson(res, 400, { error: 'Mangler GITHUB_TOKEN. Diff-en er fortsatt tilgjengelig lokalt.' });
      try {
        const branch = String(payload.branch || '');
        if (!/^pr\/approved-dead-code-\d+$/.test(branch)) throw new Error('Ugyldig PR-gren.');
        const title = String(payload.title || 'chore: remove approved dead code').slice(0, 120);
        const body = String(payload.body || 'Fjerner godkjent død kode etter gjennomgått rapport.').slice(0, 4000);
        await git(['commit', '-m', title]);
        await git(['push', '--set-upstream', 'origin', branch]);
        const remote = (await git(['remote', 'get-url', 'origin'])).stdout.trim();
        const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
        if (!match) throw new Error('Klarte ikke finne GitHub-repository fra origin.');
        const response = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}/pulls`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'user-agent': 'kodekirkegarden',
          },
          body: JSON.stringify({ title, body, head: branch, base: 'main' }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || `GitHub svarte HTTP ${response.status}.`);
        sendJson(res, 200, { status: 'opened', url: result.html_url, number: result.number });
      } catch (error) {
        sendJson(res, 500, { error: `Kunne ikke åpne GitHub-PR: ${error.message}` });
      }
    }
    await kjørAgent({ system, oppgave: lagOppgave(body), verktøy });
    const rapport = skrivRapport(hentFunn());
    const antall = rapport.safe.length + rapport.review.length;
    kjøring = {
      state: 'done',
      message: `${antall} funn rapportert fra hjemsokt-repo`,
      runId,
      reportUrl: '/report.json',
    };
  } catch (e) {
    kjøring = { state: 'failed', message: e.message, runId };
  }
}

async function git(args) {
  return execFileAsync('git', args, { cwd: path.resolve(import.meta.dirname, '..'), maxBuffer: 2 * 1024 * 1024 });
}

function approvedFiles(findings) {
  if (!Array.isArray(findings) || !findings.length) throw new Error('Godkjenn minst ett funn først.');
  const files = [];
  for (const finding of findings) {
    if (finding?.type !== 'File' || (finding.symbol && finding.symbol !== '(file)')) {
      throw new Error(`Kan bare legge hele filer i PR. «${finding?.path ?? 'ukjent'}» har ikke filnivå-funn.`);
    }
    const relative = typeof finding.path === 'string' ? finding.path : '';
    const full = path.resolve(REPO, relative);
    if (!relative || !full.startsWith(`${REPO}${path.sep}`)) throw new Error(`Ugyldig filsti «${relative}».`);
    files.push(relative.split(path.sep).join('/'));
  }
  return [...new Set(files)];
}

async function prepareApproved(req, res) {
  let payload;
  try {
    payload = JSON.parse(await lesBody(req));
  } catch (error) {
    return sendJson(res, 400, { error: `Ugyldig forespørsel: ${error.message}` });
  }

  try {
    const files = approvedFiles(payload.findings);
    const repoFiles = files.map((file) => path.posix.join('hjemsokt-repo', file));
    for (const file of repoFiles) await git(['ls-files', '--error-unmatch', '--', file]);
    const branch = `pr/approved-dead-code-${Date.now()}`;
    await git(['switch', '-c', branch]);
    for (const file of repoFiles) await git(['rm', '--', file]);
    const [stat, diff] = await Promise.all([
      git(['diff', '--cached', '--stat']),
      git(['diff', '--cached', '--no-ext-diff', '--']),
    ]);
    sendJson(res, 200, {
      status: 'prepared',
      branch,
      files,
      summary: stat.stdout.trim(),
      diff: diff.stdout,
      message: 'PR-forhåndsvisning klar. Ingen push eller GitHub-PR er opprettet.',
    });
  } catch (error) {
    sendJson(res, 400, { error: `Kunne ikke forberede godkjente endringer: ${error.message}` });
  }
}

async function openPr(req, res) {
  let payload;
  try {
    payload = JSON.parse(await lesBody(req));
  } catch (error) {
    return sendJson(res, 400, { error: `Ugyldig forespørsel: ${error.message}` });
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) return sendJson(res, 400, { error: 'Mangler GITHUB_TOKEN. Diff-en er fortsatt tilgjengelig lokalt.' });
  try {
    const branch = String(payload.branch || '');
    if (!/^pr\/approved-dead-code-\d+$/.test(branch)) throw new Error('Ugyldig PR-gren.');
    const title = String(payload.title || 'chore: remove approved dead code').slice(0, 120);
    const body = String(payload.body || 'Fjerner godkjent død kode etter gjennomgått rapport.').slice(0, 4000);
    await git(['commit', '-m', title]);
    await git(['push', '--set-upstream', 'origin', branch]);
    const remote = (await git(['remote', 'get-url', 'origin'])).stdout.trim();
    const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (!match) throw new Error('Klarte ikke finne GitHub-repository fra origin.');
    const response = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}/pulls`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'kodekirkegarden',
      },
      body: JSON.stringify({ title, body, head: branch, base: 'main' }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `GitHub svarte HTTP ${response.status}.`);
    sendJson(res, 200, { status: 'opened', url: result.html_url, number: result.number });
  } catch (error) {
    sendJson(res, 500, { error: `Kunne ikke åpne GitHub-PR: ${error.message}` });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/start') {
    // Krever JSON: da kan ikke andre nettsider sende kallet uten CORS-forespørsel (som vi ikke svarer på).
    if (!req.headers['content-type']?.startsWith('application/json')) return sendJson(res, 415, { error: 'Må være application/json' });
    if (!process.env.ANTHROPIC_API_KEY) return sendJson(res, 400, { error: 'Mangler ANTHROPIC_API_KEY i .env' });
    if (kjøring.state === 'running') {
      return sendJson(res, 409, {
        error: 'Agenten kjører allerede',
        runId: kjøring.runId,
        statusUrl: '/api/status',
      });
    }

    start(await lesBody(req));
    return sendJson(res, 202, { runId: kjøring.runId, statusUrl: '/api/status' });
  }

  if (req.method === 'POST' && url.pathname === '/api/pr/prepare-approved') {
    await prepareApproved(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/pr/open') {
    await openPr(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, kjøring);
  if (req.method === 'GET' && (url.pathname === '/report.json' || url.pathname === '/api/report')) {
    return sendFil(res, RAPPORT);
  }

  if (req.method === 'GET') {
    const fil = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fil.startsWith(WEB + path.sep)) return sendJson(res, 403, { error: 'Forbudt' });
    return sendFil(res, fil);
  }

  sendJson(res, 405, { error: 'Metode ikke støttet' });
});

// Bare på denne maskinen: startknappen koster API-kreditter.
server.listen(PORT, '127.0.0.1', () => console.log(`\n🪦 Kodekirkegården: http://localhost:${PORT}\n`));
