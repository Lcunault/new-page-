/**
 * Lancement du navigateur.
 *
 * On utilise un contexte persistant (un vrai profil sur le disque) : la
 * connexion Amazon se fait a la main une fois, les cookies restent, et le
 * navigateur garde la meme empreinte d'un jour sur l'autre. C'est a la fois
 * plus simple et moins suspect qu'un navigateur neuf a chaque run.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { SELECTORS, STATES, detectProductState } from './detect.js';
import { logger } from './log.js';
import { randomBetween, sleep } from './human.js';

export class BlockedError extends Error {
  constructor(state, message) {
    super(message);
    this.name = 'BlockedError';
    this.state = state;
  }
}

export async function openBrowser(config) {
  mkdirSync(config.browser.profileDir, { recursive: true });

  const launchOptions = {
    headless: config.browser.headless,
    slowMo: config.browser.slowMoMs,
    locale: config.locale,
    timezoneId: config.timezone,
    viewport: { width: 1380, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(config.browser.profileDir, {
      ...launchOptions,
      channel: config.browser.channel || undefined,
    });
  } catch (err) {
    // Chrome installe n'est pas garanti : repli sur le Chromium de Playwright.
    logger.warn(`canal "${config.browser.channel}" indisponible (${err.message.split('\n')[0]}), repli sur Chromium`);
    context = await chromium.launchPersistentContext(config.browser.profileDir, launchOptions);
  }

  context.setDefaultTimeout(30_000);
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

export async function acceptCookies(page) {
  for (const selector of SELECTORS.cookieBanner) {
    const button = page.locator(selector).first();
    try {
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click();
        logger.debug('banniere cookies acceptee');
        await sleep(randomBetween(500, 1200));
        return;
      }
    } catch {
      // Pas de banniere : cas normal apres la premiere visite.
    }
  }
}

/** Navigue vers une page produit et renvoie l'etat detecte. */
export async function visitProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await acceptCookies(page);
  // Le buybox Amazon est injecte apres le chargement initial.
  await sleep(randomBetween(1200, 2600));

  const result = await detectProductState(page);

  if (result.state === STATES.CAPTCHA) {
    throw new BlockedError(
      STATES.CAPTCHA,
      'Amazon affiche une verification anti-robot. Run interrompu. Ouvre le navigateur, resous-la a la main, ' +
        'puis attends plusieurs heures avant de relancer (et augmente pacing.minDelayMs).',
    );
  }
  if (result.state === STATES.LOGGED_OUT) {
    throw new BlockedError(
      STATES.LOGGED_OUT,
      'Session Amazon expiree. Relance `npm run login` pour te reconnecter a la main.',
    );
  }
  return result;
}

/** Verifie que le profil est bien connecte, sans passer par une page produit. */
export async function assertLoggedIn(page, config) {
  await page.goto(`${config.marketplace}/gp/css/homepage.html`, { waitUntil: 'domcontentloaded' });
  await acceptCookies(page);
  const url = page.url();
  if (/\/ap\/signin/.test(url)) {
    throw new BlockedError(STATES.LOGGED_OUT, 'Non connecte : lance `npm run login`.');
  }
  return true;
}
