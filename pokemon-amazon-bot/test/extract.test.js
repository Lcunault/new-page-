/**
 * Verifie extractSignals + classify sur de vraies pages dans un navigateur :
 * c'est ce qui attrape les erreurs de selecteur que les tests purs ne voient pas.
 *
 * Ignore proprement si aucun Chromium n'est installe (lance `npm run setup`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { STATES, classify, extractSignals } from '../src/detect.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    // Repli : binaire fourni par l'environnement plutot que telecharge.
    if (process.env.POKEBOT_TEST_CHROMIUM) {
      return chromium.launch({ executablePath: process.env.POKEBOT_TEST_CHROMIUM });
    }
    throw err;
  }
}

let browser;
try {
  browser = await launch();
} catch {
  browser = null;
}

describe('extractSignals sur fixtures', { skip: browser ? false : 'aucun Chromium disponible' }, () => {
  let page;

  before(async () => {
    page = await browser.newPage();
  });

  after(async () => {
    await browser.close();
  });

  async function stateOf(fixture) {
    const html = readFileSync(resolve(FIXTURES, fixture), 'utf8');
    await page.setContent(html);
    const signals = await extractSignals(page);
    return { ...classify(signals), signals };
  }

  test('page avec bouton "Demander une invitation"', async () => {
    const { state, signals } = await stateOf('invite-available.html');
    assert.equal(state, STATES.REQUEST_AVAILABLE);
    assert.equal(signals.invitationRequestSelector, '#invitationRequestButton');
    assert.equal(signals.addToCartSelector, null);
    assert.match(signals.title, /Coffret Dresseur/);
  });

  test('page avec bouton "Ajouter au panier"', async () => {
    const { state, signals } = await stateOf('add-to-cart.html');
    assert.equal(state, STATES.CAN_BUY);
    assert.equal(signals.addToCartSelector, '#add-to-cart-button');
  });

  test('page "invitation demandee" : avis clients ignores', async () => {
    const { state } = await stateOf('request-pending.html');
    assert.equal(state, STATES.REQUEST_PENDING);
  });

  test('page de refus', async () => {
    const { state } = await stateOf('not-selected.html');
    assert.equal(state, STATES.NOT_SELECTED);
  });

  test('page captcha', async () => {
    const { state } = await stateOf('captcha.html');
    assert.equal(state, STATES.CAPTCHA);
  });

  test('page deconnectee', async () => {
    const { state } = await stateOf('logged-out.html');
    assert.equal(state, STATES.LOGGED_OUT);
  });

  test('page indisponible', async () => {
    const { state } = await stateOf('unavailable.html');
    assert.equal(state, STATES.UNAVAILABLE);
  });

  test('un bouton invisible n est jamais retenu comme cliquable', async () => {
    await page.setContent(`
      <div id="nav-link-accountList"><span>Bonjour Lucas</span></div>
      <div id="rightCol"><div id="desktop_buybox">
        <input id="add-to-cart-button" type="submit" value="Ajouter au panier" style="display:none">
        <input id="invitationRequestButton" type="submit" value="Demander une invitation" disabled
               style="width:200px;height:40px">
      </div></div>`);
    const signals = await extractSignals(page);
    assert.equal(signals.addToCartSelector, null, 'bouton panier cache');
    assert.equal(signals.invitationRequestSelector, null, 'bouton invitation desactive');
  });
});
