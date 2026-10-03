import { STATES } from '../detect.js';
import { visitProduct } from '../browser.js';
import { createPacer, shuffle } from '../human.js';
import { logger } from '../log.js';
import { notify } from '../notify.js';
import { TRACK, WATCHED, checkedRecently, loadState, saveState, setStatus } from '../store.js';

/**
 * Verification quotidienne : pour chaque invitation demandee, est-ce que la
 * page affiche maintenant "Ajouter au panier" ?
 *
 * Cette commande ne clique sur RIEN. Elle lit, met a jour le suivi et
 * previent. L'achat reste entierement manuel.
 */
export async function check(config, page, { only, limit, ignoreCooldown = false } = {}) {
  const state = loadState();
  const pacing = { ...config.pacing };
  if (limit) pacing.maxPagesPerRun = Math.min(pacing.maxPagesPerRun, limit);
  const pacer = createPacer(pacing, logger);

  const candidates = Object.values(state.products).filter((product) => {
    if (only) return product.asin === only;
    if (!WATCHED.has(product.status)) return false;
    // Un seul passage par produit et par jour : inutile et plus risque de
    // recharger la meme fiche plusieurs fois.
    if (!ignoreCooldown && checkedRecently(product, pacing.minHoursBetweenChecks)) return false;
    return true;
  });

  if (!candidates.length) {
    const watched = Object.values(state.products).filter((p) => WATCHED.has(p.status)).length;
    logger.info(
      watched
        ? `Rien a verifier : les ${watched} produit(s) suivis l'ont deja ete il y a moins de ${pacing.minHoursBetweenChecks}h.`
        : 'Aucun produit suivi. Lance `npm run scan` puis `npm run request`.',
    );
    return { checked: 0, newlyBuyable: 0 };
  }

  logger.info(`${candidates.length} produit(s) a verifier`);

  const newlyBuyable = [];
  const rejected = [];

  for (const product of shuffle(candidates)) {
    if (!pacer.hasBudget()) {
      logger.info(`plafond de ${pacing.maxPagesPerRun} pages atteint : suite au prochain run`);
      break;
    }
    await pacer.beforePage();

    logger.info(`-> ${product.asin} ${(product.title || '').slice(0, 55)}`);

    let result;
    try {
      result = await visitProduct(page, product.url);
    } catch (err) {
      if (err.name === 'BlockedError') {
        saveState(state);
        throw err;
      }
      logger.warn(`   erreur de chargement : ${err.message.split('\n')[0]}`);
      continue;
    }

    product.lastCheckedAt = new Date().toISOString();
    product.checkCount += 1;
    product.lastPageState = result.state;

    if (result.state === STATES.CAN_BUY) {
      const wasAlreadyInvited = product.status === TRACK.INVITED;
      setStatus(product, TRACK.INVITED, { pageState: result.state, note: 'bouton Ajouter au panier present' });
      product.invitedAt = product.invitedAt ?? new Date().toISOString();
      if (!wasAlreadyInvited) newlyBuyable.push(product);
      logger.ok('   ACHETABLE : "Ajouter au panier" est disponible');
    } else if (result.state === STATES.NOT_SELECTED) {
      setStatus(product, TRACK.NOT_SELECTED, { pageState: result.state });
      rejected.push(product);
      logger.info('   non retenu / invitation expiree');
    } else if (result.state === STATES.REQUEST_AVAILABLE) {
      // Le bouton est la, mais la demande est deja faite : on ne clique pas.
      logger.info('   toujours en attente (bouton reaffiche par Amazon, ignore)');
    } else if (result.state === STATES.REQUEST_PENDING) {
      logger.info('   toujours en attente');
    } else if (result.state === STATES.UNAVAILABLE) {
      logger.info('   indisponible');
    } else {
      logger.warn(`   etat non reconnu -> \`node src/cli.js diagnose ${product.asin}\``);
    }

    saveState(state);
  }

  saveState(state);
  logger.ok(`${pacer.visited} page(s) verifiee(s), ${newlyBuyable.length} nouveau(x) produit(s) achetable(s)`);

  if (newlyBuyable.length) {
    await notify(
      config,
      `Invitation acceptee : ${newlyBuyable.length} produit(s) Pokemon a acheter`,
      newlyBuyable.map((p) => `- ${p.title || p.asin}\n  ${p.url}`).join('\n'),
    );
    for (const product of newlyBuyable) product.notifiedAt = new Date().toISOString();
    saveState(state);
  }

  if (rejected.length) {
    logger.info(`${rejected.length} produit(s) non retenu(s) : ${rejected.map((p) => p.asin).join(', ')}`);
  }

  return { checked: pacer.visited, newlyBuyable: newlyBuyable.length };
}
