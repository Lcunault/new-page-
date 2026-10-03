/**
 * Detection de l'etat d'une page produit Amazon.
 *
 * Deux parties volontairement separees :
 *  - extractSignals(page) : lit le DOM (necessite un navigateur)
 *  - classify(signals)    : logique pure, testable sans navigateur
 *
 * Les selecteurs Amazon changent regulierement : chaque signal a donc
 * plusieurs candidats (id, name, data-*) PUIS un repli sur le texte visible,
 * en francais et en anglais.
 */

export const STATES = {
  CAPTCHA: 'CAPTCHA',
  LOGGED_OUT: 'LOGGED_OUT',
  PAGE_MISSING: 'PAGE_MISSING',
  CAN_BUY: 'CAN_BUY',
  NOT_SELECTED: 'NOT_SELECTED',
  REQUEST_AVAILABLE: 'REQUEST_AVAILABLE',
  REQUEST_PENDING: 'REQUEST_PENDING',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
};

/** Etats qui empechent toute suite du run : il faut une intervention humaine. */
export const BLOCKING_STATES = new Set([STATES.CAPTCHA, STATES.LOGGED_OUT]);

export const SELECTORS = {
  addToCart: [
    '#add-to-cart-button',
    'input[name="submit.add-to-cart"]',
    '#addToCart input[type="submit"]',
    '#buy-now-button',
  ],
  invitationRequest: [
    '#invitationRequestButton',
    '#invitation-request-button',
    'input[name="submit.invitation-request"]',
    'input[name="submit.request-invite"]',
    '[data-action="dp-invitation-request"] input',
    '[data-action="dp-invitation-request"] button',
    'span[data-csa-c-content-id*="invitation"] input',
    'a[href*="invitation-request"]',
  ],
  cookieBanner: ['#sp-cc-accept', 'input[data-cel-widget="sp-cc-accept"]'],
};

const PATTERNS = {
  captcha: [
    /saisissez les caract[eè]res/i,
    /type the characters you see/i,
    /enter the characters you see/i,
    /v[eé]rifiez que vous n'[eê]tes pas un robot/i,
    /pour continuer vos achats/i,
    /sorry, we just need to make sure you're not a robot/i,
  ],
  loggedOut: [/identifiez-vous/i, /^sign in$/im, /bonjour, identifiez-vous/i],
  pageMissing: [
    /page que vous recherchez est introuvable/i,
    /we couldn't find that page/i,
    /cette page n'est pas disponible/i,
  ],
  requestAvailable: [
    /demander une invitation/i,
    /request an? invitation/i,
    /demande d'invitation\s*$/i,
  ],
  requestPending: [
    /invitation demand[eé]e/i,
    /demande d'invitation (envoy[eé]e|enregistr[eé]e|re[cç]ue)/i,
    /votre demande d'invitation a bien [eé]t[eé]/i,
    /invitation requested/i,
    /invitation request (submitted|received|sent)/i,
    /nous vous informerons par e-?mail/i,
    /you(?:'ll| will) receive an e-?mail/i,
  ],
  invited: [
    /vous avez [eé]t[eé] s[eé]lectionn[eé]/i,
    /you(?:'ve| have) been selected/i,
    /votre invitation.{0,30}accept[eé]e/i,
    /invitation accept[eé]e/i,
  ],
  notSelected: [
    /vous n'avez pas [eé]t[eé] s[eé]lectionn[eé]/i,
    /you were not selected/i,
    /n'a pas [eé]t[eé] retenue/i,
    /demande d'invitation.{0,40}refus[eé]e/i,
    /votre invitation a expir[eé]/i,
    /your invitation (has )?expired/i,
  ],
  unavailable: [
    /actuellement indisponible/i,
    /currently unavailable/i,
    /non disponible pour le moment/i,
    /nous ne savons pas quand cet article sera de nouveau/i,
  ],
};

function matchesAny(patterns, text) {
  if (!text) return false;
  return patterns.some((re) => re.test(text));
}

/**
 * Lit la page et renvoie un objet de signaux serialisable.
 * @param {import('playwright').Page} page
 */
export async function extractSignals(page) {
  return page.evaluate(
    ({ selectors }) => {
      const isUsable = (el) => {
        if (!el) return false;
        if (el.disabled) return false;
        if (el.getAttribute?.('aria-disabled') === 'true') return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const firstUsable = (list) => {
        for (const selector of list) {
          for (const el of document.querySelectorAll(selector)) {
            if (isUsable(el)) return selector;
          }
        }
        return null;
      };

      const textOf = (selector) => {
        const parts = [];
        for (const el of document.querySelectorAll(selector)) {
          const value = el.innerText || el.value || el.getAttribute?.('aria-label') || '';
          if (value) parts.push(value);
        }
        return parts.join('\n');
      };

      // Texte restreint a la zone d'achat : evite les faux positifs venant
      // des avis clients ou des produits suggeres.
      const buyAreaText = textOf(
        '#centerCol, #rightCol, #buybox, #desktop_buybox, #availability, #availability_feature_div, #exports_desktop_qualifiedBuybox, [id*="invitation"]',
      );

      // Boutons cliquables et leur libelle : certains boutons Amazon n'ont
      // pas d'id stable mais gardent un libelle explicite.
      const clickableLabels = [];
      for (const el of document.querySelectorAll(
        'input[type="submit"], button, a.a-button-text, span.a-button-inner > input',
      )) {
        if (!isUsable(el)) continue;
        const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
        if (label) clickableLabels.push(label);
      }

      const titleEl = document.querySelector('#productTitle, #title, h1');

      return {
        url: window.location.href,
        title: titleEl ? titleEl.innerText.trim() : '',
        accountLine: textOf('#nav-link-accountList, #nav-link-accountList-nav-line-1'),
        addToCartSelector: firstUsable(selectors.addToCart),
        invitationRequestSelector: firstUsable(selectors.invitationRequest),
        buyAreaText,
        clickableLabels,
        // Repli large, tronque : sert aux captcha / pages d'erreur qui n'ont
        // aucune des zones ci-dessus.
        pageText: (document.body?.innerText || '').slice(0, 8000),
      };
    },
    { selectors: SELECTORS },
  );
}

/**
 * Transforme des signaux en etat. Fonction pure.
 * @param {object} signals
 * @returns {{state: string, reasons: string[]}}
 */
export function classify(signals) {
  const reasons = [];
  const buyText = signals.buyAreaText || '';
  const pageText = signals.pageText || '';
  const labels = (signals.clickableLabels || []).join('\n');
  const allText = `${buyText}\n${pageText}`;

  if (matchesAny(PATTERNS.captcha, pageText) || /validateCaptcha/i.test(signals.url || '')) {
    return { state: STATES.CAPTCHA, reasons: ['captcha detecte'] };
  }

  if (matchesAny(PATTERNS.loggedOut, signals.accountLine || '')) {
    return { state: STATES.LOGGED_OUT, reasons: ['barre de compte en mode deconnecte'] };
  }

  if (matchesAny(PATTERNS.pageMissing, pageText)) {
    return { state: STATES.PAGE_MISSING, reasons: ['page produit introuvable'] };
  }

  // Priorite absolue : si on peut mettre au panier, l'invitation est passee.
  if (signals.addToCartSelector) {
    reasons.push(`bouton panier (${signals.addToCartSelector})`);
    if (matchesAny(PATTERNS.invited, buyText)) reasons.push('texte "selectionne"');
    return { state: STATES.CAN_BUY, reasons };
  }

  if (matchesAny(PATTERNS.notSelected, allText)) {
    return { state: STATES.NOT_SELECTED, reasons: ['texte de refus / invitation expiree'] };
  }

  // Attention : sur Amazon le bouton "Demander une invitation" reapparait
  // apres un rechargement meme quand la demande est deja faite. Cet etat dit
  // seulement "un bouton est cliquable", pas "il faut cliquer" : c'est l'etat
  // local stocke dans data/state.json qui decide.
  if (signals.invitationRequestSelector) {
    return {
      state: STATES.REQUEST_AVAILABLE,
      reasons: [`bouton invitation (${signals.invitationRequestSelector})`],
    };
  }
  if (matchesAny(PATTERNS.requestAvailable, labels)) {
    return { state: STATES.REQUEST_AVAILABLE, reasons: ['libelle de bouton "demander une invitation"'] };
  }

  if (matchesAny(PATTERNS.requestPending, buyText)) {
    return { state: STATES.REQUEST_PENDING, reasons: ['texte "demande enregistree"'] };
  }

  if (matchesAny(PATTERNS.unavailable, buyText)) {
    return { state: STATES.UNAVAILABLE, reasons: ['texte "indisponible"'] };
  }

  return { state: STATES.UNKNOWN, reasons: ['aucun signal reconnu'] };
}

/** Extraction + classification. */
export async function detectProductState(page) {
  const signals = await extractSignals(page);
  const { state, reasons } = classify(signals);
  return { state, reasons, signals };
}
