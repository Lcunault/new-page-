import { TRACK, loadState } from '../store.js';

const ORDER = [
  TRACK.INVITED,
  TRACK.NO_INVITE,
  TRACK.REQUESTED,
  TRACK.NEW,
  TRACK.UNAVAILABLE,
  TRACK.NOT_SELECTED,
  TRACK.PURCHASED,
  TRACK.IGNORED,
];

const LABELS = {
  [TRACK.INVITED]: 'ACHETABLE (invitation acceptee)',
  [TRACK.NO_INVITE]: 'achat direct',
  [TRACK.REQUESTED]: 'invitation demandee, en attente',
  [TRACK.NEW]: 'a traiter',
  [TRACK.UNAVAILABLE]: 'indisponible',
  [TRACK.NOT_SELECTED]: 'non retenu',
  [TRACK.PURCHASED]: 'achete',
  [TRACK.IGNORED]: 'ecarte',
};

function age(iso) {
  if (!iso) return '-';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return '-';
  if (days === 0) return "aujourd'hui";
  return `il y a ${days}j`;
}

export function status(config, { all = false } = {}) {
  const state = loadState();
  const products = Object.values(state.products);

  if (!products.length) {
    console.log('Suivi vide. Lance `npm run scan` ou `node src/cli.js add <url>`.');
    return;
  }

  console.log(`\nSuivi Pokemon Amazon - ${products.length} produit(s)\n`);

  for (const trackStatus of ORDER) {
    const group = products.filter((p) => p.status === trackStatus);
    if (!group.length) continue;
    if (!all && (trackStatus === TRACK.IGNORED || trackStatus === TRACK.NOT_SELECTED) && group.length > 5) {
      console.log(`${LABELS[trackStatus]} : ${group.length} (--all pour le detail)\n`);
      continue;
    }

    console.log(`${LABELS[trackStatus]} (${group.length})`);
    for (const product of group.sort((a, b) => (a.title || '').localeCompare(b.title || ''))) {
      const title = (product.title || '(titre inconnu)').replace(/\s+/g, ' ').slice(0, 62).padEnd(62);
      const detail =
        trackStatus === TRACK.REQUESTED
          ? `demande ${age(product.requestedAt)}, verifie ${age(product.lastCheckedAt)}`
          : trackStatus === TRACK.INVITED
            ? `dispo ${age(product.invitedAt)}`
            : `vu ${age(product.lastCheckedAt)}`;
      console.log(`  ${product.asin}  ${title}  ${detail}`);
      if (trackStatus === TRACK.INVITED || trackStatus === TRACK.NO_INVITE) {
        console.log(`             ${product.url}`);
      }
      if (product.requestConfirmed === false) {
        console.log('             /!\\ demande non confirmee par Amazon, a verifier une fois a la main');
      }
    }
    console.log('');
  }

  const lastRun = state.runs?.at(-1);
  if (lastRun) console.log(`Dernier run : ${lastRun.command} le ${lastRun.at}\n`);
}
