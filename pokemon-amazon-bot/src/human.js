/**
 * Rythme des actions. Le but n'est pas d'etre rapide mais de rester dans des
 * cadences plausibles pour un humain : une page a la fois, pauses variables,
 * plafond de pages par run.
 */
export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Melange une liste (Fisher-Yates) pour eviter un ordre de visite identique chaque jour. */
export function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Cadenceur de pages : pause entre chaque page, plus une pause longue
 * toutes les N pages, et refus de depasser maxPagesPerRun.
 */
export function createPacer(pacing, logger) {
  let visited = 0;
  return {
    get visited() {
      return visited;
    },
    hasBudget() {
      return visited < pacing.maxPagesPerRun;
    },
    /** A appeler AVANT chaque page (sauf la premiere, qui part sans attendre). */
    async beforePage() {
      if (visited > 0) {
        if (pacing.pauseAfterPages > 0 && visited % pacing.pauseAfterPages === 0) {
          logger.info(`pause longue ${Math.round(pacing.longPauseMs / 1000)}s apres ${visited} pages`);
          await sleep(pacing.longPauseMs);
        } else {
          const delay = randomBetween(pacing.minDelayMs, pacing.maxDelayMs);
          logger.debug(`pause ${Math.round(delay / 1000)}s`);
          await sleep(delay);
        }
      }
      visited += 1;
    },
  };
}
