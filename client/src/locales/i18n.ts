import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import English translations only
import translationEn from './en/translation.json';

export const defaultNS = 'translation';

export const resources = {
  en: { translation: translationEn },
} as const;

i18n
  .use(initReactI18next)
  .init({
    lng: 'en',
    fallbackLng: 'en',
    fallbackNS: 'translation',
    ns: ['translation'],
    debug: false,
    defaultNS,
    resources,
    interpolation: { escapeValue: false },
  });

export default i18n;
