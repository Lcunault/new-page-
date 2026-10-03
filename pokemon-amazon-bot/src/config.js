import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  marketplace: 'https://www.amazon.fr',
  locale: 'fr-FR',
  timezone: 'Europe/Paris',
  browser: {
    profileDir: './browser-profile',
    channel: 'chrome',
    headless: false,
    slowMoMs: 120,
  },
  sources: [],
  pacing: {
    minDelayMs: 7000,
    maxDelayMs: 20000,
    maxPagesPerRun: 20,
    minHoursBetweenChecks: 20,
    pauseAfterPages: 8,
    longPauseMs: 60000,
  },
  notify: {
    desktop: true,
    webhookUrl: '',
  },
};

function mergeDeep(base, override) {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base !== 'object' || typeof override !== 'object') return override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = mergeDeep(base[key], value);
  }
  return out;
}

/** Chemin absolu a partir d'un chemin relatif a la racine du projet. */
export function fromRoot(p) {
  return isAbsolute(p) ? p : resolve(ROOT, p);
}

export function loadConfig() {
  const userPath = resolve(ROOT, 'config.json');
  const examplePath = resolve(ROOT, 'config.example.json');
  const path = existsSync(userPath) ? userPath : examplePath;

  let raw = {};
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Config illisible (${path}) : ${err.message}`);
  }

  const config = mergeDeep(DEFAULTS, raw);
  config.usingExampleConfig = path === examplePath;
  config.configPath = path;

  // Les secrets passent par l'environnement en priorite.
  if (process.env.POKEBOT_WEBHOOK_URL) {
    config.notify.webhookUrl = process.env.POKEBOT_WEBHOOK_URL;
  }

  config.marketplace = config.marketplace.replace(/\/+$/, '');
  config.browser.profileDir = fromRoot(config.browser.profileDir);

  const { pacing } = config;
  if (pacing.minDelayMs > pacing.maxDelayMs) {
    throw new Error('pacing.minDelayMs doit etre <= pacing.maxDelayMs');
  }
  if (pacing.minDelayMs < 2000) {
    throw new Error('pacing.minDelayMs < 2000 : trop agressif, Amazon va te bloquer.');
  }

  return config;
}
