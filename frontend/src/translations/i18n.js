import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import translationEN from './en.json';
import translationHI from './hi.json';
import translationPA from './pa.json';
import translationMR from './mr.json';
import translationBN from './bn.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', short: 'ENG' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', short: 'हिन्दी' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', short: 'ਪੰਜਾਬੀ' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', short: 'मराठी' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', short: 'বাংলা' }
];

const STORAGE_KEY = 'gramsathi:lang';

function detectLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && LANGUAGES.some(l => l.code === stored)) return stored;
  const browser = (navigator.language || 'en').slice(0, 2);
  return LANGUAGES.some(l => l.code === browser) ? browser : 'en';
}

/** Screen readers need this to pronounce Devanagari, Gurmukhi, and Bengali correctly. */
function syncDocumentLang(lng) {
  document.documentElement.setAttribute('lang', lng);
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: translationEN },
      hi: { translation: translationHI },
      pa: { translation: translationPA },
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
