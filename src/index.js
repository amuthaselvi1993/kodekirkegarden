// Startpunktet: npm start -- "spørsmålet ditt"
import { kjørAgent } from './agent.js';
import { system, eksempelOppgave, verktøy, hentFunn } from './verktoy.js';
import { skrivRapport } from './rapport.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Mangler ANTHROPIC_API_KEY. Kopier .env.example til .env og lim inn nøkkelen.');
  process.exit(1);
}

const oppgave = process.argv.slice(2).join(' ') || eksempelOppgave;
console.log(`\n🎃 ${oppgave}\n`);

await kjørAgent({ system, oppgave, verktøy });

// Funnene agenten meldte inn vises i webklienten: npm run web
const funn = hentFunn();
if (funn.length) {
  skrivRapport(funn);
  console.log(`\n📋 ${funn.length} funn skrevet til data/rapport.json. Se dem med: npm run web`);
}
