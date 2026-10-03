/**
 * Notifications : console toujours, notification systeme si disponible,
 * webhook optionnel (Discord, Slack ou ntfy.sh).
 * Aucune dependance externe : on utilise les outils de l'OS et fetch.
 */
import { execFile } from 'node:child_process';
import { logger } from './log.js';

function runQuiet(command, args) {
  return new Promise((done) => {
    execFile(command, args, { timeout: 5000 }, (err) => done(!err));
  });
}

async function desktopNotify(title, body) {
  const text = `${title}\n${body}`;
  if (process.platform === 'darwin') {
    const escaped = (s) => s.replace(/["\\]/g, '\\$&');
    return runQuiet('osascript', [
      '-e',
      `display notification "${escaped(body)}" with title "${escaped(title)}" sound name "Glass"`,
    ]);
  }
  if (process.platform === 'linux') {
    return runQuiet('notify-send', ['--urgency=critical', title, body]);
  }
  if (process.platform === 'win32') {
    const escaped = (s) => s.replace(/'/g, "''");
    return runQuiet('powershell', [
      '-NoProfile',
      '-Command',
      `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');` +
        `[System.Windows.Forms.MessageBox]::Show('${escaped(text)}','${escaped(title)}')`,
    ]);
  }
  return false;
}

async function webhookNotify(url, title, body) {
  const text = `${title}\n${body}`;
  try {
    const isNtfy = /ntfy\.sh/.test(url);
    const response = await fetch(url, {
      method: 'POST',
      headers: isNtfy
        ? { 'Content-Type': 'text/plain', Title: title, Priority: 'high' }
        : { 'Content-Type': 'application/json' },
      // Discord lit "content", Slack lit "text" : on envoie les deux.
      body: isNtfy ? text : JSON.stringify({ content: text, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.warn(`webhook: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(`webhook: ${err.message}`);
    return false;
  }
}

export async function notify(config, title, body) {
  logger.ok(`\n*** ${title}\n${body}\n`);
  const results = [];
  if (config.notify.desktop) results.push(await desktopNotify(title, body));
  if (config.notify.webhookUrl) results.push(await webhookNotify(config.notify.webhookUrl, title, body));
  return results.some(Boolean);
}
