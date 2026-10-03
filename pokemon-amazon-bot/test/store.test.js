import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACK, canRequestInvitation, checkedRecently, parseAsin, setStatus } from '../src/store.js';

function product(overrides = {}) {
  return {
    asin: 'B0TEST1234',
    status: TRACK.NEW,
    requestedAt: null,
    requestAttemptedAt: null,
    lastCheckedAt: null,
    history: [],
    ...overrides,
  };
}

test('parseAsin accepte un ASIN brut', () => {
  assert.equal(parseAsin('B0CJQZ8KQ1'), 'B0CJQZ8KQ1');
});

test('parseAsin extrait l ASIN de plusieurs formes d URL', () => {
  const urls = [
    'https://www.amazon.fr/dp/B0CJQZ8KQ1',
    'https://www.amazon.fr/Pokemon-Coffret/dp/B0CJQZ8KQ1/ref=sr_1_3?keywords=pokemon',
    'https://www.amazon.fr/gp/product/B0CJQZ8KQ1',
    'https://www.amazon.fr/gp/aw/d/B0CJQZ8KQ1',
  ];
  for (const url of urls) assert.equal(parseAsin(url), 'B0CJQZ8KQ1', url);
});

test('parseAsin refuse ce qui n est pas un produit', () => {
  assert.equal(parseAsin('https://www.amazon.fr/s?k=pokemon'), null);
  assert.equal(parseAsin('pokemon'), null);
});

test('un produit neuf est eligible a une demande', () => {
  assert.equal(canRequestInvitation(product()), true);
});

test('une demande deja envoyee bloque definitivement un nouveau clic', () => {
  const p = product({ status: TRACK.REQUESTED, requestedAt: '2026-10-01T10:00:00.000Z' });
  assert.equal(canRequestInvitation(p), false);
});

test('une tentative tracee mais non confirmee bloque aussi', () => {
  // Cas du process interrompu juste apres le clic : on ne reclique pas.
  const p = product({ requestAttemptedAt: '2026-10-01T10:00:00.000Z' });
  assert.equal(canRequestInvitation(p), false);
});

test('le statut remis a NEW ne suffit pas a debloquer un reclic', () => {
  // Protection contre un `mark <ASIN> NEW` fait par erreur.
  const p = product({ status: TRACK.NEW, requestedAt: '2026-10-01T10:00:00.000Z' });
  assert.equal(canRequestInvitation(p), false);
});

test('un produit achetable directement ou refuse n est pas candidat', () => {
  assert.equal(canRequestInvitation(product({ status: TRACK.NO_INVITE })), false);
  assert.equal(canRequestInvitation(product({ status: TRACK.NOT_SELECTED })), false);
  assert.equal(canRequestInvitation(product({ status: TRACK.INVITED })), false);
});

test('setStatus journalise la transition une seule fois', () => {
  const p = product();
  assert.equal(setStatus(p, TRACK.REQUESTED, { pageState: 'REQUEST_AVAILABLE' }), true);
  assert.equal(setStatus(p, TRACK.REQUESTED), false, 'statut identique = pas de nouvelle entree');
  assert.equal(p.history.length, 1);
  assert.equal(p.history[0].from, TRACK.NEW);
  assert.equal(p.history[0].to, TRACK.REQUESTED);
});

test('checkedRecently respecte la fenetre de cooldown', () => {
  const now = Date.now();
  assert.equal(checkedRecently(product({ lastCheckedAt: null }), 20), false);
  assert.equal(
    checkedRecently(product({ lastCheckedAt: new Date(now - 2 * 3_600_000).toISOString() }), 20),
    true,
    '2h -> trop recent',
  );
  assert.equal(
    checkedRecently(product({ lastCheckedAt: new Date(now - 25 * 3_600_000).toISOString() }), 20),
    false,
    '25h -> a reverifier',
  );
});
