/* ------------------------------------------------------------------ *
 * i18n.js — localized strings for the web edition.
 * Locales are generated from the Android app's string resources
 * (values-<locale>/strings.xml) by scripts/build_web_locales.py into
 * i18n/<locale>.json.
 * ------------------------------------------------------------------ */
'use strict';

const I18n = {
  SUPPORTED: [
    { tag: 'en', label: 'English' },
    { tag: 'cs', label: 'Čeština' },
    { tag: 'de', label: 'Deutsch' },
    { tag: 'es', label: 'Español' },
    { tag: 'es-ES', label: 'Español (España)' },
    { tag: 'fr', label: 'Français' },
    { tag: 'ga', label: 'Gaeilge' },
    { tag: 'id', label: 'Bahasa Indonesia' },
    { tag: 'it', label: 'Italiano' },
    { tag: 'ja', label: '日本語' },
    { tag: 'lt', label: 'Lietuvių' },
    { tag: 'nl', label: 'Nederlands' },
    { tag: 'pl', label: 'Polski' },
    { tag: 'pt-BR', label: 'Português (Brasil)' },
    { tag: 'ru', label: 'Русский' },
    { tag: 'tr', label: 'Türkçe' },
    { tag: 'zh-CN', label: '简体中文' },
  ],

  locale: 'en',
  strings: {},
  fallback: {},

  /** Load a locale (falls back to English data). Returns the loaded tag. */
  async load(tag) {
    this.fallback = await this._fetch('en');
    this.locale = this.SUPPORTED.some(l => l.tag === tag) ? tag : 'en';
    this.strings = this.locale === 'en' ? this.fallback : { ...this.fallback, ...(await this._fetch(this.locale)) };
    return this.locale;
  },

  async _fetch(tag) {
    try {
      const r = await fetch('i18n/' + tag + '.json');
      if (r.ok) return await r.json();
    } catch (e) { /* fall through to empty */ }
    return {};
  },

  /** Pick the browser's locale if we support it. */
  autoDetect() {
    const nav = (typeof navigator !== 'undefined' && navigator.languages) ? navigator.languages : [];
    for (const cand of nav) {
      const exact = this.SUPPORTED.find(l => l.tag.toLowerCase() === cand.toLowerCase());
      if (exact) return exact.tag;
      const base = cand.split('-')[0].toLowerCase();
      const rough = this.SUPPORTED.find(l => l.tag.split('-')[0] === base);
      if (rough) return rough.tag;
    }
    return 'en';
  },

  has(key) { return this.strings[key] != null; },

  /** Translate `key`. `args` fills {1}-style placeholders. */
  t(key, args) {
    let s = this.strings[key];
    if (s == null) s = this.fallback[key];
    if (s == null) return null;
    if (args) {
      if (Array.isArray(args)) {
        args.forEach((v, i) => { s = s.split('{' + (i + 1) + '}').join(String(v)); });
      } else {
        for (const [k, v] of Object.entries(args)) s = s.split('{' + k + '}').join(String(v));
      }
    }
    return s;
  },

  /** Translate with an English fallback when the key is missing. */
  tf(key, args, fallback) {
    const v = this.t(key, args);
    return v != null ? v : (fallback != null ? fallback : key);
  },

  /** A generated string array (e.g. worker_names). */
  arr(name) { return this.strings['__array_' + name] || this.fallback['__array_' + name] || []; },
};

/* Export for Node-based tests (no-op in the browser) */
if (typeof module !== "undefined" && module.exports) module.exports = { I18n };
