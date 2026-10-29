import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { kjørAgent } from './agent.js';
import { system, eksempelOppgave, verktøy } from './verktoy.js';

const PORT = Number(process.env.PORT ?? 3000);
const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(PROJECT_DIR, 'public');
const SCAN_REPO = path.join(PROJECT_DIR, 'hjemsokt-repo');
const MAX_BODY = 1024 * 1024;
const execFileAsync = promisify(execFile);

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('Forespørselen er for stor.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function tekstFraSvar(svar) {
  return svar?.content
    ?.filter((blokk) => blokk.type === 'text' && blokk.text.trim())
    .map((blokk) => blokk.text)
    .join('\n\n') ?? '';
}

async function git(args) {
  return execFileAsync('git', args, { cwd: PROJECT_DIR, maxBuffer: 2 * 1024 * 1024 });
}

function approvedFiles(findings) {
  if (!Array.isArray(findings) || !findings.length) throw new Error('Godkjenn minst ett funn først.');
  const files = [];
  for (const finding of findings) {
    if (finding?.type !== 'File' || (finding.symbol && finding.symbol !== '(file)')) {
      throw new Error(`Kan bare legge hele filer i PR. «${finding?.path ?? 'ukjent'}» har ikke filnivå-funn.`);
    }
    const relative = typeof finding.path === 'string' ? finding.path : '';
    const full = path.resolve(SCAN_REPO, relative);
    if (!relative || !full.startsWith(`${SCAN_REPO}${path.sep}`)) {
      throw new Error(`Ugyldig filsti «${relative}».`);
    }
    files.push(relative.split(path.sep).join('/'));
  }
  return [...new Set(files)];
}

async function handlePrepareApproved(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { error: `Ugyldig forespørsel: ${error.message}` });
    return;
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

async function handleOpenPr(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { error: `Ugyldig forespørsel: ${error.message}` });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    sendJson(res, 400, { error: 'Mangler GITHUB_TOKEN. PR-forhåndsvisningen er fortsatt tilgjengelig lokalt.' });
    return;
  }

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
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (error) {
        sendJson(res, 400, { error: `Ugyldig forespørsel: ${error.message}` });
        return;
      }
      const oppgave = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (!oppgave) {
        sendJson(res, 400, { error: 'Skriv en melding først.' });
        return;
      }
      const svar = await kjørAgent({ system, oppgave, verktøy, logg: () => {} });
      sendJson(res, 200, { response: tekstFraSvar(svar) || 'Agenten ga ikke noe tekstsvar.' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pr/prepare-approved') {
      await handlePrepareApproved(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pr/open') {
      await handleOpenPr(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Fant ikke siden.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`\nKodekirkegården kjører på http://localhost:${PORT}`);
  console.log(`Eksempeloppgave: ${eksempelOppgave}`);
});
