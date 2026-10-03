import { STATES } from '../detect.js';
import { visitProduct } from '../browser.js';
import { createPacer, randomBetween, shuffle, sleep } from '../human.js';
import { logger } from '../log.js';
import { notify } from '../notify.js';
import { TRACK, canRequestInvitation, loadState, saveState, setStatus } from '../store.js';

/**
 * Produits qui peuvent encore recevoir une demande d'invitation.
 * La regle elle-meme vit dans store.js (canRequestInvitation) : seul
 * `request --only <ASIN> --force` peut passer outre, a la main.
 */
function selectCandidates(state, { only } = {}) {
  return Object.values(state.products).filter(
    (product) => (!only || product.asin === only) && canRequestInvitation(product),
  );
}

/** Clique le bouton d'invitation et essaie de confirmer l'enregistrement. */
async function clickInvitationButton(page, selector) {
  const button = page.locator(selector).first();
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(randomBetween(700, 1800));
  await button.click({ timeout: 10_000 });

  // Soit la page navigue, soit un panneau de confirmation s'affiche.
  await page
    .waitForLoadState('domcontentloaded', { timeout: 15_000 })
    .catch(() => {});
  await sleep(randomBetween(2500, 5000));
}

export async function request(config, page, { only, force = false, limit } = {}) {
  const state = loadState();
  const pacing = { ...config.pacing };
  if (limit) pacing.maxPagesPerRun = Math.min(pacing.maxPagesPerRun, limit);
  const pacer = createPacer(pacing, logger);

  let candidates = selectCandidates(state, { only });

  if (force && only) {
    const product = state.products[only];
    if (!product) {
      logger.error(`ASIN ${only} inconnu. Ajoute-le d'abord : node src/cli.js add ${only}`);
      return { requested: 0 };
    }
    logger.warn(`--force : nouvelle demande pour ${only} alors qu'une demande est deja enregistree.`);
    candidates = [product];
  }

  if (!candidates.length) {
    logger.info('Aucune nouvelle demande d\'invitation a faire.');
    return { requested: 0 };
  }

  logger.info(`${candidates.length} produit(s) a traiter, plafond du run : ${pacing.maxPagesPerRun} pages`);

  let requested = 0;
  const buyable = [];

  for (const product of shuffle(candidates)) {
    if (!pacer.hasBudget()) {
      logger.info(`plafond de ${pacing.maxPagesPerRun} pages atteint : le reste sera traite au prochain run`);
      break;
    }
    await pacer.beforePage();

    const label = `${product.asin} ${(product.title || '').slice(0, 55)}`;
    logger.info(`-> ${label}`);

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
    if (result.signals.title && !product.title) product.title = result.signals.title;

    switch (result.state) {
      case STATES.CAN_BUY:
        // Achetable tout de suite : pas d'invitation a demander.
        setStatus(product, TRACK.NO_INVITE, { pageState: result.state, note: 'achat direct possible' });
        buyable.push(product);
        logger.ok('   achetable directement (pas d\'invitation necessaire)');
        break;

      case STATES.REQUEST_AVAILABLE: {
        // Trace l'intention AVANT le clic : si le process meurt juste apres
        // le clic, le produit ne sera pas reclique au run suivant.
        product.requestAttemptedAt = new Date().toISOString();
        saveState(state);

        try {
          await clickInvitationButton(page, result.signals.invitationRequestSelector ?? '#invitationRequestButton');
          const after = await visitProduct(page, product.url).catch(() => null);
          const confirmed = after?.state === STATES.REQUEST_PENDING;

          product.requestedAt = new Date().toISOString();
          product.requestConfirmed = Boolean(confirmed);
          setStatus(product, TRACK.REQUESTED, {
            pageState: after?.state ?? result.state,
            note: confirmed ? 'confirmation affichee par Amazon' : 'clic effectue, confirmation non lue',
          });
          requested += 1;
          if (confirmed) {
            logger.ok('   invitation demandee (confirmee)');
          } else {
            // On garde REQUESTED malgre l'absence de confirmation : recliquer
            // demain serait plus risque que de verifier soi-meme une fois.
            logger.warn('   clic effectue mais confirmation non lue -> marque demande, verifie une fois a la main');
          }
        } catch (err) {
          logger.error(`   echec du clic : ${err.message.split('\n')[0]}`);
          product.requestError = err.message.slice(0, 200);
          // requestAttemptedAt reste pose : pas de nouvelle tentative
          // automatique. Utilise --force apres verification manuelle.
        }
        saveState(state);
        break;
      }

      case STATES.REQUEST_PENDING:
        // Demande deja enregistree cote Amazon (faite a la main, ou run
        // precedent interrompu) : on s'aligne sans rien cliquer.
        product.requestedAt = product.requestedAt ?? new Date().toISOString();
        setStatus(product, TRACK.REQUESTED, { pageState: result.state, note: 'demande deja enregistree cote Amazon' });
        logger.info('   demande deja enregistree, rien a faire');
        break;

      case STATES.NOT_SELECTED:
        setStatus(product, TRACK.NOT_SELECTED, { pageState: result.state });
        logger.info('   non retenu');
        break;

      case STATES.UNAVAILABLE:
        setStatus(product, TRACK.UNAVAILABLE, { pageState: result.state });
        logger.info('   indisponible');
        break;

      case STATES.PAGE_MISSING:
        setStatus(product, TRACK.IGNORED, { pageState: result.state, note: 'page introuvable' });
        logger.info('   page introuvable, ecarte');
        break;

      default:
        product.lastPageState = result.state;
        logger.warn(`   etat non reconnu (${result.reasons.join(', ')}) -> \`node src/cli.js diagnose ${product.asin}\``);
    }

    saveState(state);
  }

  saveState(state);
  logger.ok(`${requested} invitation(s) demandee(s) sur ${pacer.visited} page(s) visitee(s)`);

  if (buyable.length) {
    await notify(
      config,
      `${buyable.length} produit(s) Pokemon achetable(s) sans invitation`,
      buyable.map((p) => `- ${p.title || p.asin}\n  ${p.url}`).join('\n'),
    );
  }

  return { requested, buyable: buyable.length };
}
