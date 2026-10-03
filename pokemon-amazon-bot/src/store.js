/**
 * Persistance du suivi dans data/state.json.
 *
 * C'est la source de verite pour "ai-je deja demande cette invitation ?".
 * Amazon reaffiche le bouton "Demander une invitation" apres chaque
 * rechargement de page, donc on ne peut pas se fier a la page : si un ASIN
 * porte requestedAt, on ne reclique jamais.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ROOT } from './config.js';

export const STATE_PATH = resolve(ROOT, 'data/state.json');
const SCHEMA_VERSION = 1;

/** Statuts de suivi (distincts des etats de page de detect.js). */
export const TRACK = {
  NEW: 'NEW',                   // decouvert, jamais visite
  REQUESTED: 'REQUESTED',       // demande d'invitation envoyee par le bot
  INVITED: 'INVITED',           // "Ajouter au panier" dispo -> achetable
  NOT_SELECTED: 'NOT_SELECTED', // refus ou invitation expiree
  NO_INVITE: 'NO_INVITE',       // achat direct, pas de systeme d'invitation
  UNAVAILABLE: 'UNAVAILABLE',   // indisponible pour le moment
  PURCHASED: 'PURCHASED',       // marque a la main apres achat
  IGNORED: 'IGNORED',           // ecarte a la main
};

/** Statuts que `check` doit continuer a surveiller jour apres jour. */
export const WATCHED = new Set([TRACK.REQUESTED, TRACK.UNAVAILABLE]);

/** Statuts qui ne bougeront plus : on ne les revisite pas. */
export const FINAL = new Set([TRACK.PURCHASED, TRACK.IGNORED, TRACK.NOT_SELECTED]);

function emptyState() {
  return { version: SCHEMA_VERSION, createdAt: new Date().toISOString(), runs: [], products: {} };
}

export function loadState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return { ...emptyState(), ...parsed, products: parsed.products ?? {} };
  } catch (err) {
    // Un state illisible ne doit jamais faire perdre l'historique.
    const broken = `${STATE_PATH}.broken-${Date.now()}`;
    renameSync(STATE_PATH, broken);
    console.error(`state.json illisible (${err.message}). Sauvegarde dans ${broken}, repart a vide.`);
    return emptyState();
  }
}

export function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  if (existsSync(STATE_PATH)) copyFileSync(STATE_PATH, `${STATE_PATH}.bak`);
  state.updatedAt = new Date().toISOString();
  // Ecriture atomique : evite un state tronque si le process est tue.
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, STATE_PATH);
}

export function productUrl(marketplace, asin) {
  return `${marketplace}/dp/${asin}`;
}

/** Extrait un ASIN depuis une URL produit ou un ASIN brut. */
export function parseAsin(input) {
  const value = String(input).trim();
  if (/^[A-Z0-9]{10}$/.test(value)) return value;
  const match = value.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

export function upsertProduct(state, { asin, title, url, source }) {
  const existing = state.products[asin];
  if (existing) {
    if (title && !existing.title) existing.title = title;
    if (url && !existing.url) existing.url = url;
    return { product: existing, created: false };
  }
  const product = {
    asin,
    title: title || '',
    url,
    source: source || '',
    status: TRACK.NEW,
    discoveredAt: new Date().toISOString(),
    requestedAt: null,
    invitedAt: null,
    notifiedAt: null,
    lastCheckedAt: null,
    lastPageState: null,
    checkCount: 0,
    history: [],
  };
  state.products[asin] = product;
  return { product, created: true };
}

/**
 * Change le statut de suivi et journalise la transition.
 * Renvoie true si le statut a change.
 */
export function setStatus(product, status, { pageState, note } = {}) {
  const changed = product.status !== status;
  if (changed) {
    product.history.push({
      at: new Date().toISOString(),
      from: product.status,
      to: status,
      pageState: pageState ?? null,
      note: note ?? null,
    });
    product.status = status;
  }
  if (pageState) product.lastPageState = pageState;
  return changed;
}

/** Vrai si le produit a deja ete verifie recemment (anti-rechecks rapproches). */
export function checkedRecently(product, minHours) {
  if (!product.lastCheckedAt) return false;
  const elapsedHours = (Date.now() - Date.parse(product.lastCheckedAt)) / 3_600_000;
  return Number.isFinite(elapsedHours) && elapsedHours < minHours;
}

/**
 * Peut-on demander une invitation pour ce produit ?
 *
 * C'est LA regle anti-spam du projet. Amazon reaffiche le bouton "Demander une
 * invitation" a chaque rechargement de page, meme quand la demande est deja
 * enregistree : la page ne peut donc pas servir de reference. Des qu'une
 * tentative a ete tracee ici, le produit n'est plus jamais reclique
 * automatiquement.
 *
 * @param {object} product
 * @returns {boolean}
 */
export function canRequestInvitation(product) {
  if (!product) return false;
  // Une tentative tracee suffit a bloquer, meme si elle n'a pas abouti :
  // mieux vaut une verification manuelle qu'un double clic.
  if (product.requestedAt || product.requestAttemptedAt) return false;
  return product.status === TRACK.NEW;
}

export function recordRun(state, run) {
  state.runs = [...(state.runs ?? []), { at: new Date().toISOString(), ...run }].slice(-60);
}
