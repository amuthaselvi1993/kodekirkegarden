// Gjør funnene agenten melder inn om til rapporten webklienten (web/index.html) viser.
import fs from 'node:fs';
import path from 'node:path';

export const RAPPORT = path.resolve(import.meta.dirname, '../data/rapport.json');

const RISIKO = { Lav: 'Low', Middels: 'Medium', Høy: 'High' };

const modulAv = (sti) => sti.match(/^src\/([^/]+)\//)?.[1] ?? 'root';

// Trygt = agenten sier det, den er svært sikker og risikoen er lav. Alt annet
// havner i «trenger menneske». Ingenting slettes: agenten finner og vurderer bare.
const erTrygt = (f) => f.trygt_a_begrave === true && f.sikkerhet >= 90 && f.risiko === 'Lav';

export function lagRapport(funn) {
  const post = (f) => ({
    path: f.fil,
    symbol: f.symbol ?? '(file)',
    type: f.type,
    module: modulAv(f.fil),
    loc: f.linjer ?? 0,
    conf: f.sikkerhet,
    risk: RISIKO[f.risiko] ?? 'Medium',
    why: f.begrunnelse,
    lastTouched: f.sist_rort ?? '',
    obituary: f.nekrolog ?? '',
  });
  return {
    scannedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    repo: 'hjemsokt-repo',
    dryRun: true,
    safe: funn.filter(erTrygt).map(post),
    review: funn.filter((f) => !erTrygt(f)).map(post),
    history: [],
    tests: [],
  };
}

export function skrivRapport(funn) {
  const rapport = lagRapport(funn);
  fs.mkdirSync(path.dirname(RAPPORT), { recursive: true });
  fs.writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2));
  return rapport;
}
