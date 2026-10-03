#!/usr/bin/env node
/**
 * Point d'entree unique.
 *   node src/cli.js <commande> [options]
 */
import { loadConfig } from './config.js';
import { logger } from './log.js';
import { loadState, recordRun, saveState } from './store.js';
import { status } from './commands/status.js';
import { add, mark, remove } from './commands/manage.js';
import { ask } from './prompt.js';

// Les modules qui tirent Playwright sont charges a la demande : `status`,
// `add` ou `help` restent utilisables meme si le navigateur n'est pas installe.
const lazy = {
  browser: () => import('./browser.js'),
  login: () => import('./commands/login.js'),
  scan: () => import('./commands/scan.js'),
  request: () => import('./commands/request.js'),
  check: () => import('./commands/check.js'),
  daily: () => import('./commands/daily.js'),
  diagnose: () => import('./commands/diagnose.js'),
};

const USAGE = `
Assistant Pokemon / Amazon - achats sur invitation

  node src/cli.js login                 connexion manuelle a Amazon (a faire une fois)
  node src/cli.js scan                  lit les pages sources et ajoute les nouveaux produits
  node src/cli.js request               demande une invitation pour chaque nouveau produit eligible
  node src/cli.js check                 verifie si une invitation est passee en "Ajouter au panier"
  node src/cli.js daily                 scan + request + check, le run quotidien
  node src/cli.js status [--all]        tableau de suivi (sans navigateur)
  node src/cli.js add <ASIN|URL> ...    ajoute des produits a la main
  node src/cli.js remove <ASIN> ...     retire des produits du suivi
  node src/cli.js mark <ASIN> <STATUT>  change un statut (ex: PURCHASED)
  node src/cli.js open <ASIN>           ouvre la fiche produit dans le navigateur
  node src/cli.js diagnose <ASIN>       capture la page pour corriger la detection

Options
  --only <ASIN>       ne traite que ce produit
  --limit <n>         plafonne le nombre de pages de ce run
  --force             avec request --only : refait une demande deja enregistree
  --now               ignore le delai minimum entre deux verifications
  --verbose           affiche les pauses et details
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === 'only' || name === 'limit') {
      flags[name] = argv[i + 1];
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

/** Commandes qui ont besoin d'un navigateur. */
const BROWSER_COMMANDS = new Set(['login', 'scan', 'request', 'check', 'daily', 'diagnose', 'open']);

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  const args = positional.slice(1);

  if (!command || command === 'help' || flags.help) {
    console.log(USAGE);
    return 0;
  }

  const config = loadConfig();
  if (config.usingExampleConfig) {
    logger.warn('config.json absent : config.example.json est utilise.');
    logger.warn('Copie-le (cp config.example.json config.json) pour regler tes sources et tes notifications.');
  }

  const options = {
    only: flags.only ? String(flags.only).toUpperCase() : undefined,
    limit: flags.limit ? Number.parseInt(flags.limit, 10) : undefined,
    force: Boolean(flags.force),
    ignoreCooldown: Boolean(flags.now),
  };
  if (options.limit !== undefined && !Number.isInteger(options.limit)) {
    logger.error('--limit attend un nombre entier');
    return 1;
  }

  // Commandes sans navigateur : reponse immediate.
  switch (command) {
    case 'status':
      status(config, { all: Boolean(flags.all) });
      return 0;
    case 'add':
      add(config, args);
      return 0;
    case 'remove':
      remove(config, args);
      return 0;
    case 'mark':
      mark(config, args);
      return 0;
    default:
      break;
  }

  if (!BROWSER_COMMANDS.has(command)) {
    logger.error(`Commande inconnue : ${command}`);
    console.log(USAGE);
    return 1;
  }

  if (command === 'login') {
    await (await lazy.login()).login(config);
    return 0;
  }

  const { openBrowser } = await lazy.browser();
  const { context, page } = await openBrowser(config);
  let keepOpen = false;
  try {
    switch (command) {
      case 'scan':
        await (await lazy.scan()).scan(config, page, options);
        break;
      case 'request':
        await (await lazy.request()).request(config, page, options);
        break;
      case 'check':
        await (await lazy.check()).check(config, page, options);
        break;
      case 'daily':
        await (await lazy.daily()).daily(config, page, options);
        break;
      case 'diagnose':
        await (await lazy.diagnose()).diagnose(config, page, args);
        break;
      case 'open':
        ({ keepOpen } = await (await lazy.diagnose()).open(config, page, args));
        break;
      default:
        break;
    }

    const state = loadState();
    recordRun(state, { command });
    saveState(state);

    if (keepOpen) await ask('Appuie sur Entree pour fermer le navigateur... ');
    return 0;
  } catch (err) {
    if (err.name === 'BlockedError') {
      // Cas attendu : Amazon demande une intervention humaine. Pas une stack.
      logger.error(`\nRun interrompu : ${err.message}`);
      return 2;
    }
    throw err;
  } finally {
    await context.close().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error(err.stack ?? String(err));
    process.exit(1);
  });
