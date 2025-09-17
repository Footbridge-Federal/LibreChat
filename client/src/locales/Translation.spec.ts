import i18n from './i18n';
import English from './en/translation.json';
import { TranslationKeys } from '~/hooks';

describe('i18next translation tests', () => {
  // Ensure i18next is initialized before any tests run
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it('should return the correct translation for a valid key in English', () => {
    expect(i18n.t('com_ui_examples')).toBe(English.com_ui_examples);
  });

  it('should return the key itself for an invalid key', () => {
    expect(i18n.t('invalid-key' as TranslationKeys)).toBe('invalid-key'); // Returns the key itself
  });

  it('should correctly format placeholders in the translation', () => {
    expect(i18n.t('com_endpoint_default_with_num', { 0: 'John' })).toBe('default: John');
  });
});
