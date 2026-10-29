// Verktøyene agenten kan bruke. Et verktøy er en definisjon (det modellen ser)
// og en kjør-funksjon (det som faktisk skjer). kjør: null betyr stub: den
// sendes ikke til modellen før dere har implementert den.
import fs from 'node:fs';
import path from 'node:path';

export const REPO = path.resolve(import.meta.dirname, '../hjemsokt-repo');
export const GIT_LOGG = path.resolve(import.meta.dirname, '../data/git-logg.json');

export const system = `Du er graver på kodekirkegården. Du leter etter død kode i repoet hjemsokt-repo:
funksjoner ingen kaller, pakker ingen importerer, utkommentert kode, gamle TODO-er,
tester som alltid skippes og feature-flagg som aldri endres.
Undersøk før du konkluderer: finn noe mistenkelig, sjekk om noe bruker det, og gå videre.
For hvert funn skriver du en kort nekrolog: hva det var, når det sist ble rørt, og hvorfor
det trygt kan begraves. Si tydelig fra når du er usikker, og si hva som IKKE bør fjernes.
Når du er ferdig med å undersøke, kaller du rapporter_funn én gang med alle funn, også de du
ikke vil anbefale å fjerne (trygt_a_begrave: false), slik at webklienten kan vise dem.
Du sletter aldri noe selv. Svar på norsk.`;

export const eksempelOppgave = 'Finn død kode i hjemsokt-repo og skriv en nekrolog for det tryggeste funnet.';

const MAKS_TREFF = 50;

// Funnene agenten melder inn via rapporter_funn. Nøkkel = fil + symbol, så
// samme funn to ganger overskriver i stedet for å dobles.
const innmeldt = new Map();
export const hentFunn = () => [...innmeldt.values()];
export const nullstillFunn = () => innmeldt.clear();

function alleFiler(mappe) {
  return fs.readdirSync(mappe, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'node_modules' || d.name === '.git') return [];
    const full = path.join(mappe, d.name);
    return d.isDirectory() ? alleFiler(full) : [full];
  });
}

function sokIRepo({ monster, regex = false, maks_treff = MAKS_TREFF } = {}) {
  if (typeof monster !== 'string' || !monster.trim()) {
    throw new Error('Mangler «monster». Send f.eks. {"monster": "TODO"} eller {"monster": "require\\\\(", "regex": true}.');
  }
  let test;
  if (regex) {
    let re;
    try {
      re = new RegExp(monster, 'i');
    } catch (e) {
      throw new Error(`Ugyldig regex «${monster}»: ${e.message}`);
    }
    test = (linje) => re.test(linje);
  } else {
    const nål = monster.toLowerCase();
    test = (linje) => linje.toLowerCase().includes(nål);
  }

  const grense = Math.min(Math.max(1, Number(maks_treff) || MAKS_TREFF), 200);
  const treff = [];
  let totalt = 0;
  for (const fil of alleFiler(REPO)) {
    const linjer = fs.readFileSync(fil, 'utf8').split('\n');
    linjer.forEach((linje, i) => {
      if (!test(linje)) return;
      totalt++;
      if (treff.length < grense) treff.push(`${path.relative(REPO, fil)}:${i + 1}: ${linje.trim()}`);
    });
  }

  if (totalt === 0) return `Ingen treff på «${monster}».`;
  const hale = totalt > treff.length ? `\n… ${totalt - treff.length} treff til. Snevre inn søket.` : '';
  return treff.join('\n') + hale;
}

export const verktøy = [
  {
    definisjon: {
      name: 'sok_i_repo',
      description:
        'Søker gjennom alle filene i hjemsokt-repo (kode, tester, config, package.json) og returnerer ' +
        'treff som «fil:linje: tekst». Bruk det for å finne hvor noe er definert eller brukt, f.eks. et ' +
        'funksjonsnavn, et pakkenavn, "TODO", "it.skip" eller "featureFlags". Vanlig tekstsøk uten ' +
        'hensyn til store og små bokstaver. Sett regex: true for regulære uttrykk. Gir maks 50 treff ' +
        'som standard, så søk smalt hvis du får for mange.',
      input_schema: {
        type: 'object',
        properties: {
          monster: { type: 'string', description: 'Teksten eller regexen du søker etter.' },
          regex: { type: 'boolean', description: 'Tolk monster som regulært uttrykk. Standard false.' },
          maks_treff: { type: 'number', description: 'Maks antall treff (1–200). Standard 50.' },
        },
        required: ['monster'],
      },
    },
    kjør: async (input) => sokIRepo(input),
  },
  {
    definisjon: {
      name: 'les_fil',
      description:
        'Leser innholdet i én fil i hjemsokt-repo, med linjenumre. Oppgi stien relativt til roten av ' +
        'repoet, f.eks. "src/services/bookingService.js". Bruk det når et søketreff ser mistenkelig ut ' +
        'og du trenger å se sammenhengen rundt.',
      input_schema: {
        type: 'object',
        properties: {
          fil: { type: 'string', description: 'Sti relativt til hjemsokt-repo.' },
        },
        required: ['fil'],
      },
    },
    kjør: async ({ fil }) => {
      const full = path.resolve(REPO, fil);
      if (full !== REPO && !full.startsWith(REPO + path.sep)) throw new Error('Fila må ligge i hjemsokt-repo');
      return fs.readFileSync(full, 'utf8')
        .split('\n')
        .map((linje, i) => `${i + 1}: ${linje}`)
        .join('\n');
    },
  },
  {
    definisjon: {
      name: 'finn_referanser',
      description:
        'Finner alle steder et navn (funksjon, variabel, pakke eller fil) brukes i hjemsokt-repo, ' +
        'utenom der det er definert. Svarer med en liste over filer og linjer, og sier tydelig fra hvis ' +
        'det ikke finnes noen. Husk at kode kan brukes indirekte: via strenger i config, dynamisk ' +
        'import, npm-scripts eller fra andre repoer. Null treff betyr ikke alltid at noe er dødt.',
      input_schema: {
        type: 'object',
        properties: {
          navn: { type: 'string', description: 'Navnet du vil finne bruk av, f.eks. "beregnRabatt" eller "moment".' },
        },
        required: ['navn'],
      },
    },
    kjør: async ({ navn }) => {
      if (typeof navn !== 'string' || !navn.trim()) throw new Error('Mangler «navn». Send f.eks. {"navn": "beregnRabatt"}.');
      const esc = navn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const svar = sokIRepo({ monster: `\\b${esc}\\b`, regex: true, maks_treff: 200 });
      if (svar.startsWith('Ingen treff')) return `Ingen referanser til «${navn}». Husk at det kan brukes indirekte.`;
      // Dropp linjene som definerer navnet: function navn, const navn =, "navn": i package.json.
      const definisjon = new RegExp(`(function|class|const|let|var)\\s+${esc}\\b|^\\S+:\\d+:\\s*"${esc}"\\s*:`);
      const rader = svar.split('\n').filter((rad) => !definisjon.test(rad));
      return rader.length ? rader.join('\n') : `Fant bare definisjonen av «${navn}». Ingen andre bruker det.`;
    },
  },
  {
    definisjon: {
      name: 'hent_git_historikk',
      description:
        'Henter commit-historikken for én fil i hjemsokt-repo: dato, forfatter og melding, nyeste først. ' +
        'Bruk det for å si når noe sist ble rørt og av hvem, f.eks. «sist endret av Mona i 2021».',
      input_schema: {
        type: 'object',
        properties: {
          fil: { type: 'string', description: 'Sti relativt til hjemsokt-repo, f.eks. "src/utils/legacyCsv.js".' },
        },
        required: ['fil'],
      },
    },
    kjør: async ({ fil }) => {
      const filer = JSON.parse(fs.readFileSync(GIT_LOGG, 'utf8')).filer ?? {};
      if (!filer[fil]) {
        throw new Error(`Fant ikke «${fil}» i git-loggen. Eksempler på filer som finnes: ${Object.keys(filer).slice(0, 5).join(', ')}`);
      }
      return filer[fil];
    },
  },
  {
    definisjon: {
      name: 'rapporter_funn',
      description:
        'Melder inn funnene dine til webklienten. Kall dette verktøyet én gang når du er ferdig med å undersøke, ' +
        'med ALLE funn: også de du er usikre på eller ikke vil anbefale å fjerne (trygt_a_begrave: false). ' +
        'Sett trygt_a_begrave: true bare hvis du har sjekket referanser (også strenger i config og dynamisk import) ' +
        'og ikke fant noen bruk. Verktøyet sletter ingenting.',
      input_schema: {
        type: 'object',
        properties: {
          funn: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fil: { type: 'string', description: 'Sti relativt til hjemsokt-repo, f.eks. "src/utils/legacyCsv.js". For en pakke: "package.json".' },
                symbol: { type: 'string', description: 'Navnet på funksjonen, pakken eller flagget. Utelat hvis hele fila er død.' },
                type: { type: 'string', enum: ['Function', 'File', 'Dependency', 'Test', 'Comment', 'Flag', 'Other'] },
                linjer: { type: 'number', description: 'Omtrent hvor mange linjer som kan fjernes.' },
                sikkerhet: { type: 'number', description: 'Hvor sikker du er på at det er dødt, 0–100.' },
                risiko: { type: 'string', enum: ['Lav', 'Middels', 'Høy'], description: 'Hvor ille det er om du tar feil.' },
                trygt_a_begrave: { type: 'boolean', description: 'Kan det fjernes uten menneskelig vurdering?' },
                begrunnelse: { type: 'string', description: 'Kort: hvilke søk du gjorde og hva de viste.' },
                sist_rort: { type: 'string', description: 'F.eks. "2021-03-12 av Mona", fra git-historikken.' },
                nekrolog: { type: 'string', description: 'Den korte nekrologen: hva det var og hvorfor det kan begraves (eller ikke).' },
              },
              required: ['fil', 'type', 'sikkerhet', 'risiko', 'trygt_a_begrave', 'begrunnelse'],
            },
          },
        },
        required: ['funn'],
      },
    },
    kjør: async ({ funn }) => {
      if (!Array.isArray(funn)) throw new Error('«funn» må være en liste.');
      for (const f of funn) {
        if (typeof f?.fil !== 'string') throw new Error('Hvert funn trenger «fil».');
        innmeldt.set(`${f.fil}#${f.symbol ?? ''}`, f);
      }
      return `Mottok ${funn.length} funn. Totalt ${innmeldt.size} i rapporten.`;
    },
  },
];
