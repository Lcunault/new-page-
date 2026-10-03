import { acceptCookies } from '../browser.js';
import { logger } from '../log.js';
import { randomBetween, sleep } from '../human.js';
import { TRACK, loadState, parseAsin, productUrl, saveState, upsertProduct } from '../store.js';

/** Recupere les ASIN presents sur une page de liste (boutique, recherche, liste d'envies). */
async function collectAsins(page) {
  return page.evaluate(() => {
    const found = new Map();

    const remember = (asin, title) => {
      if (!/^[A-Z0-9]{10}$/.test(asin)) return;
      const previous = found.get(asin);
      if (!previous || (!previous && title) || (title && !previous.title)) {
        found.set(asin, { asin, title: title || previous?.title || '' });
      }
    };

    // Pages de recherche : l'ASIN est porte par le conteneur du resultat.
    for (const card of document.querySelectorAll('[data-asin]')) {
      const asin = card.getAttribute('data-asin');
      if (!asin) continue;
      const titleEl = card.querySelector('h2 span, h2 a span, .a-size-base-plus, .a-text-normal');
      remember(asin, titleEl?.innerText?.trim() ?? '');
    }

    // Boutiques de marque : pas de data-asin, mais des liens /dp/.
    for (const link of document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]')) {
      const match = link.getAttribute('href').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (match) remember(match[1].toUpperCase(), link.getAttribute('aria-label')?.trim() ?? link.innerText?.trim() ?? '');
    }

    return [...found.values()];
  });
}

/**
 * Parcourt les pages sources et ajoute les nouveaux produits au suivi.
 * Ne clique sur rien : lecture seule.
 */
export async function scan(config, page, { sources } = {}) {
  const urls = sources?.length ? sources : config.sources;
  if (!urls.length) {
    logger.warn('Aucune source dans config.json ("sources"). Ajoute des produits avec `node src/cli.js add <url>`.');
    return { discovered: 0, added: 0 };
  }

  const state = loadState();
  let discovered = 0;
  let added = 0;

  const valid = urls.filter((url) => {
    if (/^https?:\/\//.test(url)) return true;
    // Laisse passer un placeholder de config.example.json sans faire echouer le run.
    logger.warn(`source ignoree (pas une URL) : ${url}`);
    return false;
  });

  for (const [index, url] of valid.entries()) {
    if (index > 0) await sleep(randomBetween(config.pacing.minDelayMs, config.pacing.maxDelayMs));
    logger.info(`scan: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await acceptCookies(page);
      // Les boutiques de marque chargent les vignettes en differe.
      await sleep(randomBetween(2000, 4000));
      await page.mouse.wheel(0, randomBetween(1500, 3000)).catch(() => {});
      await sleep(randomBetween(1500, 3000));

      const items = await collectAsins(page);
      discovered += items.length;
      for (const item of items) {
        const asin = parseAsin(item.asin);
        if (!asin) continue;
        const { product, created } = upsertProduct(state, {
          asin,
          title: item.title,
          url: productUrl(config.marketplace, asin),
          source: url,
        });
        if (created) {
          added += 1;
          logger.info(`  + ${asin} ${product.title.slice(0, 70)}`);
        }
      }
      logger.info(`  ${items.length} produits lus sur la page`);
    } catch (err) {
      if (err.name === 'BlockedError') throw err;
      logger.warn(`  echec du scan (${err.message.split('\n')[0]})`);
    }
  }

  saveState(state);
  const pending = Object.values(state.products).filter((p) => p.status === TRACK.NEW).length;
  logger.ok(`scan termine : ${added} nouveaux produits (${pending} en attente de premiere visite)`);
  return { discovered, added };
}
