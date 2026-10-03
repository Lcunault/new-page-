import { logger } from '../log.js';
import { TRACK, loadState, parseAsin, productUrl, saveState, setStatus, upsertProduct } from '../store.js';

/** Ajoute un ou plusieurs produits a la main (ASIN ou URL Amazon). */
export function add(config, inputs) {
  if (!inputs.length) {
    logger.error('Usage : node src/cli.js add <ASIN ou URL> [...]');
    return;
  }
  const state = loadState();
  let added = 0;
  for (const input of inputs) {
    const asin = parseAsin(input);
    if (!asin) {
      logger.warn(`ignore : "${input}" (ni ASIN ni URL produit Amazon)`);
      continue;
    }
    const { product, created } = upsertProduct(state, {
      asin,
      url: productUrl(config.marketplace, asin),
      source: 'manuel',
    });
    if (created) {
      added += 1;
      logger.ok(`+ ${asin}`);
    } else {
      logger.info(`= ${asin} deja suivi (${product.status})`);
    }
  }
  saveState(state);
  logger.info(`${added} produit(s) ajoute(s)`);
}

/** Change le statut a la main : achete, ecarte, ou remis a traiter. */
export function mark(config, [rawAsin, rawStatus]) {
  const asin = parseAsin(rawAsin ?? '');
  const target = (rawStatus ?? '').toUpperCase();
  if (!asin || !TRACK[target]) {
    logger.error(`Usage : node src/cli.js mark <ASIN> <${Object.keys(TRACK).join('|')}>`);
    return;
  }
  const state = loadState();
  const product = state.products[asin];
  if (!product) {
    logger.error(`ASIN ${asin} inconnu`);
    return;
  }
  setStatus(product, TRACK[target], { note: 'change a la main' });
  saveState(state);
  logger.ok(`${asin} -> ${TRACK[target]}`);
}

/** Retire completement un produit du suivi. */
export function remove(config, inputs) {
  const state = loadState();
  let removed = 0;
  for (const input of inputs) {
    const asin = parseAsin(input);
    if (asin && state.products[asin]) {
      delete state.products[asin];
      removed += 1;
      logger.ok(`- ${asin}`);
    }
  }
  saveState(state);
  logger.info(`${removed} produit(s) retire(s) du suivi`);
}
