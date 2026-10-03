import { assertLoggedIn, openBrowser } from '../browser.js';
import { logger } from '../log.js';
import { ask } from '../prompt.js';

/**
 * Connexion manuelle, une fois pour toutes.
 * Le bot ne saisit jamais d'identifiants et ne stocke aucun mot de passe :
 * tu te connectes toi-meme dans la fenetre, le profil garde les cookies.
 */
export async function login(config) {
  const { context, page } = await openBrowser(config);
  try {
    await page.goto(`${config.marketplace}/ap/signin`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    logger.info('');
    logger.info('Connecte-toi a Amazon dans la fenetre qui vient de s\'ouvrir');
    logger.info('(mot de passe, 2FA, captcha : tout se fait a la main, par toi).');
    logger.info('');
    await ask('Appuie sur Entree une fois connecte... ');

    await assertLoggedIn(page, config);
    logger.ok('Session enregistree dans le profil navigateur. Tu peux lancer `npm run daily`.');
  } finally {
    await context.close();
  }
}
