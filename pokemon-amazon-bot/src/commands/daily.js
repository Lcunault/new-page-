import { logger } from '../log.js';
import { check } from './check.js';
import { request } from './request.js';
import { scan } from './scan.js';
import { status } from './status.js';

/**
 * Le run quotidien, lance a la main quand tu le decides :
 *   1. scan    : nouveaux produits apparus sur les pages sources
 *   2. request : une demande d'invitation pour chaque nouveau produit eligible
 *   3. check   : les invitations deja demandees sont-elles passees achetables ?
 *
 * Le plafond de pages de config.json s'applique a chaque etape, donc un run
 * reste borne meme avec un gros catalogue.
 */
export async function daily(config, page, options = {}) {
  logger.info('=== etape 1/3 : scan des pages sources ===');
  await scan(config, page, options);

  logger.info('=== etape 2/3 : demandes d\'invitation ===');
  await request(config, page, options);

  logger.info('=== etape 3/3 : verification des invitations en attente ===');
  await check(config, page, options);

  logger.info('=== recapitulatif ===');
  status(config, {});
}
