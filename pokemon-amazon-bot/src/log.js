import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

const LOG_DIR = resolve(ROOT, 'data/logs');
const COLORS = {
  debug: '\u001b[90m',
  info: '\u001b[0m',
  ok: '\u001b[32m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
  reset: '\u001b[0m',
};

const verbose = process.argv.includes('--verbose') || process.env.POKEBOT_VERBOSE === '1';

function write(level, message) {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  if (level !== 'debug' || verbose) {
    const color = COLORS[level] ?? COLORS.info;
    console.log(`${color}${message}${COLORS.reset}`);
  }
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(resolve(LOG_DIR, `${day}.log`), `${line}\n`);
  } catch {
    // Un probleme d'ecriture de log ne doit jamais interrompre un run.
  }
}

export const logger = {
  debug: (m) => write('debug', m),
  info: (m) => write('info', m),
  ok: (m) => write('ok', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m),
};
