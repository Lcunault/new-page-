import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STATES, classify } from '../src/detect.js';

const base = {
  url: 'https://www.amazon.fr/dp/B0TEST12345',
  title: 'Pokemon',
  accountLine: 'Bonjour Lucas',
  addToCartSelector: null,
  invitationRequestSelector: null,
  buyAreaText: '',
  clickableLabels: [],
  pageText: '',
};

test('un bouton panier utilisable gagne sur tout le reste', () => {
  const { state } = classify({
    ...base,
    addToCartSelector: '#add-to-cart-button',
    invitationRequestSelector: '#invitationRequestButton',
    buyAreaText: 'Invitation demandee',
  });
  assert.equal(state, STATES.CAN_BUY);
});

test('captcha detecte meme si la page porte un bouton panier', () => {
  const { state } = classify({
    ...base,
    addToCartSelector: '#add-to-cart-button',
    pageText: 'Saisissez les caracteres que vous voyez ci-dessous',
  });
  assert.equal(state, STATES.CAPTCHA);
});

test('captcha detecte par l URL de redirection', () => {
  const { state } = classify({ ...base, url: 'https://www.amazon.fr/errors/validateCaptcha?x=1' });
  assert.equal(state, STATES.CAPTCHA);
});

test('session expiree detectee sur la barre de compte', () => {
  const { state } = classify({ ...base, accountLine: 'Bonjour, identifiez-vous' });
  assert.equal(state, STATES.LOGGED_OUT);
});

test('refus detecte avant le bouton d invitation reaffiche', () => {
  const { state } = classify({
    ...base,
    invitationRequestSelector: '#invitationRequestButton',
    buyAreaText: "Vous n'avez pas ete selectionne pour acheter cet article.",
  });
  assert.equal(state, STATES.NOT_SELECTED);
});

test('bouton reconnu par son libelle quand aucun selecteur ne correspond', () => {
  const { state } = classify({ ...base, clickableLabels: ['Demander une invitation'] });
  assert.equal(state, STATES.REQUEST_AVAILABLE);
});

test('libelle anglais reconnu aussi', () => {
  const { state } = classify({ ...base, clickableLabels: ['Request an invitation'] });
  assert.equal(state, STATES.REQUEST_AVAILABLE);
});

test('demande en attente reconnue par le texte du buybox', () => {
  const { state } = classify({
    ...base,
    buyAreaText: 'Invitation demandee. Nous vous informerons par e-mail.',
  });
  assert.equal(state, STATES.REQUEST_PENDING);
});

test('un avis client parlant de selection ne vaut pas une invitation acceptee', () => {
  const { state } = classify({
    ...base,
    buyAreaText: 'Invitation demandee.',
    // Le texte large contient un faux positif venant des avis clients.
    pageText: "J'ai eu la chance d'etre selectionne l'an dernier, super coffret !",
  });
  assert.equal(state, STATES.REQUEST_PENDING);
});

test('indisponible reconnu', () => {
  const { state } = classify({ ...base, buyAreaText: 'Actuellement indisponible.' });
  assert.equal(state, STATES.UNAVAILABLE);
});

test('page produit supprimee reconnue', () => {
  const { state } = classify({
    ...base,
    pageText: "Desole, la page que vous recherchez est introuvable.",
  });
  assert.equal(state, STATES.PAGE_MISSING);
});

test('aucun signal connu renvoie UNKNOWN, jamais une action', () => {
  const { state, reasons } = classify(base);
  assert.equal(state, STATES.UNKNOWN);
  assert.ok(reasons.length > 0);
});
