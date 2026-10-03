import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';
import { extractSignals, classify } from '../detect.js';
import { acceptCookies } from '../browser.js';
import { logger } from '../log.js';
import { randomBetween, sleep } from '../human.js';
import { loadState, parseAsin, productUrl } from '../store.js';

/**
 * Amazon change ses selecteurs sans prevenir. Quand un produit ressort en
 * etat non reconnu, cette commande capture la page pour qu'on puisse corriger
 * les motifs de detect.js (c'est aussi ce qu'il faut joindre a une question).
 */
export async function diagnose(config, page, [input]) {
  const asin = parseAsin(input ?? '');
  if (!asin) {
    logger.error('Usage : node src/cli.js diagnose <ASIN ou URL>');
    return;
  }

  const state = loadState();
  const url = state.products[asin]?.url ?? productUrl(config.marketplace, asin);

  logger.info(`diagnose ${asin} : ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await acceptCookies(page);
  await sleep(randomBetween(1500, 3000));

  const signals = await extractSignals(page);
  const { state: pageState, reasons } = classify(signals);

  const dir = resolve(ROOT, 'data/diagnostics');
  mkdirSync(dir, { recursive: true });
  const stamp = `${asin}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  writeFileSync(resolve(dir, `${stamp}.json`), `${JSON.stringify({ pageState, reasons, signals }, null, 2)}\n`);
  writeFileSync(resolve(dir, `${stamp}.html`), await page.content());
  await page.screenshot({ path: resolve(dir, `${stamp}.png`), fullPage: false });

  logger.ok(`etat detecte : ${pageState} (${reasons.join(', ')})`);
  logger.info(`bouton panier      : ${signals.addToCartSelector ?? 'absent'}`);
  logger.info(`bouton invitation  : ${signals.invitationRequestSelector ?? 'absent'}`);
  logger.info(`libelles cliquables: ${signals.clickableLabels.slice(0, 12).join(' | ')}`);
  logger.info(`capture : data/diagnostics/${stamp}.{json,html,png}`);
}

/** Ouvre une fiche produit dans le navigateur et laisse la fenetre ouverte. */
export async function open(config, page, [input]) {
  const asin = parseAsin(input ?? '');
  if (!asin) {
    logger.error('Usage : node src/cli.js open <ASIN ou URL>');
    return { keepOpen: false };
  }
  const state = loadState();
  const url = state.products[asin]?.url ?? productUrl(config.marketplace, asin);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await acceptCookies(page);
  logger.ok(`${url} ouvert. Ferme la fenetre quand tu as fini.`);
  return { keepOpen: true };
}
