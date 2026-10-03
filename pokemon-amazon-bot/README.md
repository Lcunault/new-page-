# Assistant Pokémon / Amazon — achats sur invitation

Outil local qui t'aide à suivre les produits Pokémon vendus **sur invitation** sur Amazon :
il repère les produits, demande l'invitation **une seule fois par produit**, tient un suivi,
et quand tu le lances, vérifie si une invitation est passée à « Ajouter au panier ».

**L'achat reste à toi.** Le bot ne met rien au panier, ne paie rien, ne saisit jamais ton mot
de passe. Il regarde, note, et te prévient.

---

## À lire avant de l'utiliser

Trois choses, honnêtement :

1. **Les conditions d'utilisation d'Amazon interdisent l'accès automatisé** à leur site. Cet
   outil fait, à ta place et à ton rythme, des actions que tu ferais à la main sur ton propre
   compte — mais le risque de blocage ou de suspension de compte existe et il est pour toi.
   Les réglages par défaut sont volontairement lents pour cette raison : ne les accélère pas.
2. **Le système d'invitation est justement là pour limiter les bots.** L'outil est conçu pour
   ne pas ressembler à un bot de scalping : une seule demande par produit, jamais de clic
   répété, pas de parallélisme, pas de résolution de captcha, pas d'achat automatique.
   Si un captcha apparaît, le run s'arrête et c'est à toi de jouer.
3. **Ça tourne sur ta machine, pas dans le cloud.** Il faut un vrai navigateur visible et ta
   session Amazon. Une session Claude Code distante ne peut pas faire ça.

Si ces trois points te vont, la suite est pour toi.

## Pourquoi c'est gratuit

Rien ici n'appelle d'API payante : le bot est du Node + Playwright qui pilote un vrai
navigateur, avec des sélecteurs CSS et des motifs de texte. Aucun appel à un modèle, donc
aucun coût au run, et c'est aussi **plus fiable** qu'un agent LLM pour une tâche répétitive.

Claude Code sert pour la **maintenance** : quand Amazon change ses sélecteurs, tu lances
`diagnose` et tu donnes la capture à Claude pour corriger `src/detect.js`. Voir
[Quand Amazon change sa page](#quand-amazon-change-sa-page).

---

## Installation

Il te faut [Node.js](https://nodejs.org) 18.17 ou plus.

```bash
git clone <url-de-ce-depot>
cd pokemon-amazon-bot

npm install
npm run setup                  # télécharge Chromium pour Playwright

cp config.example.json config.json
```

Ouvre `config.json` et règle au moins :

| Réglage | À quoi ça sert |
| --- | --- |
| `marketplace` | `https://www.amazon.fr`, ou ton pays |
| `sources` | les pages où chercher les produits — **remplace le placeholder** par l'URL exacte de la boutique Pokémon telle qu'elle apparaît dans ta barre d'adresse |
| `browser.channel` | `chrome` si Chrome est installé, sinon `""` pour le Chromium de Playwright |
| `notify.webhookUrl` | optionnel : URL Discord, Slack ou [ntfy.sh](https://ntfy.sh) pour être prévenu sur ton téléphone |

Puis connecte-toi, une fois pour toutes :

```bash
npm run login
```

Une fenêtre s'ouvre sur Amazon. **Tu** te connectes — mot de passe, 2FA, captcha : le bot ne
touche à rien. Les cookies restent dans `browser-profile/`, tu n'auras pas à recommencer
avant plusieurs semaines.

## Usage quotidien

Une seule commande, quand tu le décides :

```bash
npm run daily
```

Elle enchaîne trois étapes :

1. **scan** — lit tes pages sources, ajoute les produits nouvellement apparus au suivi
2. **request** — demande une invitation pour chaque nouveau produit qui en propose une
3. **check** — pour chaque invitation déjà demandée, regarde si la page affiche maintenant
   « Ajouter au panier »

Si un produit devient achetable, tu reçois une notification avec le lien direct. À toi de
cliquer.

Pour voir où tu en es, sans ouvrir de navigateur :

```bash
npm run status
```

```
Suivi Pokémon Amazon - 14 produit(s)

ACHETABLE (invitation acceptée) (1)
  B0CJQZ8KQ1  Pokémon - Coffret Dresseur d'Élite Écarlate et Violet    dispo aujourd'hui
             https://www.amazon.fr/dp/B0CJQZ8KQ1

invitation demandée, en attente (9)
  B0D1234567  Pokémon - Coffret Collection Premium                     demandé il y a 12j, vérifié aujourd'hui
  ...
```

### La règle qui compte

Tu l'as dit toi-même : Amazon **réaffiche le bouton « Demander une invitation » après chaque
rechargement de page**, même quand la demande est déjà enregistrée. Si le bot se fiait à la
page, il recliquerait tous les jours — exactement le comportement de spam à éviter.

Donc la source de vérité est locale, pas sur la page : dès qu'une demande est tracée dans
`data/state.json`, le produit n'est **plus jamais** recliqué automatiquement. En phase de
vérification, le bot voit le bouton, le reconnaît, et l'ignore :

```
-> B0D1234567 Pokémon - Coffret Collection Premium
   toujours en attente (bouton réaffiché par Amazon, ignoré)
```

Cette règle est dans `canRequestInvitation()` (`src/store.js`) et elle est couverte par des
tests, y compris le cas tordu : un process tué juste après le clic ne provoque pas de second
clic au run suivant — le produit est signalé « à vérifier à la main » à la place.

Le seul moyen de refaire une demande est explicite et manuel :

```bash
node src/cli.js request --only B0D1234567 --force
```

## Toutes les commandes

```
node src/cli.js login                 connexion manuelle à Amazon (une fois)
node src/cli.js scan                  lit les pages sources, ajoute les nouveaux produits
node src/cli.js request               demande une invitation pour les nouveaux produits
node src/cli.js check                 regarde si une invitation est passée achetable
node src/cli.js daily                 scan + request + check
node src/cli.js status [--all]        tableau de suivi (sans navigateur)
node src/cli.js add <ASIN|URL> ...    ajoute des produits à la main
node src/cli.js remove <ASIN> ...     retire des produits du suivi
node src/cli.js mark <ASIN> PURCHASED note un achat
node src/cli.js open <ASIN>           ouvre la fiche dans le navigateur
node src/cli.js diagnose <ASIN>       capture la page pour corriger la détection
```

Options : `--only <ASIN>` (un seul produit), `--limit <n>` (plafonne les pages du run),
`--now` (ignore le délai minimum entre deux vérifications), `--force` (voir plus haut),
`--verbose` (affiche les pauses).

## Statuts de suivi

| Statut | Sens |
| --- | --- |
| `NEW` | découvert, pas encore visité |
| `REQUESTED` | invitation demandée, en attente — **c'est ce que `check` surveille** |
| `INVITED` | « Ajouter au panier » disponible → **à acheter** |
| `NO_INVITE` | achat direct, aucune invitation nécessaire |
| `UNAVAILABLE` | indisponible pour le moment, resurveillé |
| `NOT_SELECTED` | non retenu, ou invitation expirée |
| `PURCHASED` / `IGNORED` | posés à la main, plus jamais visités |

## Ce qui te protège d'un blocage

Tout est dans `pacing` (`config.json`) :

| Réglage | Défaut | Effet |
| --- | --- | --- |
| `minDelayMs` / `maxDelayMs` | 7–20 s | pause aléatoire entre deux pages |
| `maxPagesPerRun` | 20 | plafond dur de pages par run ; le reste attend le lendemain |
| `minHoursBetweenChecks` | 20 | un produit n'est vérifié qu'une fois par jour |
| `pauseAfterPages` / `longPauseMs` | 8 / 60 s | pause longue régulière |

À quoi s'ajoute : une seule page à la fois (aucun parallélisme), ordre de visite mélangé à
chaque run, profil navigateur stable d'un jour sur l'autre, et arrêt immédiat du run si un
captcha ou une déconnexion apparaît. `minDelayMs` sous 2 s est refusé par la config.

Si tu vois un captcha : arrête, résous-le à la main dans le navigateur, attends quelques
heures, et augmente les délais avant de relancer.

## Automatiser le lancement quotidien

Tu as dit « tous les jours quand je le demanderai » — le défaut est donc **manuel**, et c'est
le bon choix : un run à heure fixe et pile est plus repérable qu'un run quand tu t'y mets.

Si tu veux quand même une planification, mets une heure non ronde et pense que la machine
doit être allumée et déverrouillée :

```bash
# macOS / Linux — crontab -e — tous les jours à 9h17
17 9 * * * cd ~/pokemon-amazon-bot && /usr/local/bin/node src/cli.js daily >> data/logs/cron.log 2>&1
```

Sous Windows, Planificateur de tâches → action `node`, argument `src/cli.js daily`,
dossier de départ = le dossier du projet.

## Quand Amazon change sa page

Ça arrivera : Amazon renomme ses identifiants de boutons régulièrement. Le symptôme est un
produit en état non reconnu :

```
-> B0D1234567 Pokémon - Coffret
   état non reconnu (aucun signal reconnu) -> `node src/cli.js diagnose B0D1234567`
```

Lance la commande proposée. Elle écrit dans `data/diagnostics/` le HTML, une capture d'écran
et les signaux lus, et affiche ce qu'elle a trouvé. Donne ça à Claude Code :

> Voici la capture de `data/diagnostics/B0D1234567-....json`. Le bouton d'invitation n'est
> plus détecté — corrige `SELECTORS` et `PATTERNS` dans `src/detect.js`, et ajoute une
> fixture de test.

La détection est volontairement découpée pour que ce soit facile : `extractSignals()` lit le
DOM, `classify()` décide, et `classify()` est testable sans navigateur. Chaque signal a
plusieurs sélecteurs candidats **puis** un repli sur le texte visible, en français et en
anglais, pour survivre à un changement d'identifiant.

## Tests

```bash
npm test
```

30 tests : la logique de classification (priorités, faux positifs venant des avis clients,
captcha), la règle anti-spam et ses cas limites, le parsing d'ASIN, et une passe réelle dans
Chromium sur sept fixtures HTML — la seule qui attrape une erreur de sélecteur.

## Structure

```
src/
  cli.js              point d'entrée, parsing des options
  config.js           chargement et validation de config.json
  detect.js           extractSignals() + classify() — le cœur
  store.js            data/state.json, statuts, règle anti-spam
  browser.js          Playwright, profil persistant, erreurs bloquantes
  human.js            délais, mélange, plafond de pages
  notify.js           console, notification système, webhook
  commands/           login, scan, request, check, daily, status, manage, diagnose
test/
  classify.test.js    logique pure
  store.test.js       suivi et règle anti-spam
  extract.test.js     DOM réel dans Chromium
  fixtures/           sept pages Amazon représentatives
```

## Vie privée

Rien ne sort de ta machine, sauf si tu configures un webhook (et alors seuls un titre de
produit et une URL partent). Pas de mot de passe stocké : la session vit dans le profil
Chromium local, comme dans ton navigateur habituel. `config.json`, `data/state.json` et
`browser-profile/` sont dans `.gitignore` — **ne commite jamais `browser-profile/`**, il
contient tes cookies de session Amazon.
