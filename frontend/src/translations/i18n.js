import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import translationEN from './en.json';
import translationHI from './hi.json';
import translationMR from './mr.json';
import translationBN from './bn.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', short: 'ENG' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', short: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', short: 'मराठी' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', short: 'বাংলা' }
];

/**
 * The three offered on first run.
 *
 * A shorter list than LANGUAGES on purpose: the gate blocks the whole app, and
 * a wall of scripts is a worse first screen than three legible choices.
 * Bengali stays supported and reachable from the switcher — the gate only
 * decides what is offered on first run, it does not remove a language.
 */
export const GATE_CODES = ['en', 'hi', 'mr'];
export const GATE_LANGUAGES = LANGUAGES.filter(l => GATE_CODES.includes(l.code));

const STORAGE_KEY = 'gramsathi:lang';
/**
 * Separate from STORAGE_KEY, because "we guessed from the browser" and "the
 * user told us" are different facts. Only the second one should stop the gate
 * from appearing.
 */
const CHOSEN_KEY = 'gramsathi:lang:chosen';

function detectLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && LANGUAGES.some(l => l.code === stored)) return stored;
  const browser = (navigator.language || 'en').slice(0, 2);
  return LANGUAGES.some(l => l.code === browser) ? browser : 'en';
}

/** Private browsing and disabled storage both throw on access, not on write. */
export function hasChosenLanguage() {
  try { return localStorage.getItem(CHOSEN_KEY) === '1'; } catch { return false; }
}

export function markLanguageChosen() {
  try { localStorage.setItem(CHOSEN_KEY, '1'); } catch { /* storage unavailable */ }
}

/** Screen readers need this to pronounce Devanagari and Bengali correctly. */
function syncDocumentLang(lng) {
  document.documentElement.setAttribute('lang', lng);
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: translationEN },
      hi: { translation: translationHI },
      mr: { translation: translationMR },
      bn: { translation: translationBN }
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false }
  });

syncDocumentLang(i18n.language);

// The choice is a setting, not a per-session accident.
i18n.on('languageChanged', (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
  syncDocumentLang(lng);
});

export default i18n;
