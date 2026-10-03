import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Pose une question dans le terminal et attend la reponse. */
export async function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question) {
  const answer = (await ask(`${question} [o/N] `)).toLowerCase();
  return answer === 'o' || answer === 'oui' || answer === 'y' || answer === 'yes';
}
