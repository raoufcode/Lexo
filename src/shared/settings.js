/*
 * Lexo — réglages : valeurs par défaut, lecture/écriture, compatibilité
 * Chrome (chrome.*) et Firefox (browser.*).
 */
(function (root) {
  "use strict";

  const ext = root.browser && root.browser.runtime ? root.browser : root.chrome;

  const DEFAULTS = Object.freeze({
    enabled: true,
    /** Langue de l'interface de Lexo. */
    uiLanguage: "fr",
    /** "auto" : détection automatique ; sinon code de langue forcé. */
    language: "auto",
    /** Langue utilisée quand la détection est incertaine. */
    defaultLanguage: "fr",
    /** Variantes préférées par langue de base. */
    variants: { en: "en-US", pt: "pt-PT", de: "de-DE", fr: "fr" },
    /** "default" ou "picky" (style, typographie plus stricts). */
    level: "default",
    /** Délai après la dernière frappe avant vérification (ms). */
    debounceMs: 450,
    /** Soulignement + badge. */
    showBadge: true,
    underlineStyle: "wavy", // wavy | solid | dotted
    /** Serveur LanguageTool (public, premium ou auto-hébergé). */
    ltServer: "https://api.languagetool.org",
    ltUsername: "",
    ltApiKey: "",
    /** Reformulations : "auto" | "chrome" | "gemini" | "ollama" | "claude". */
    rephraseProvider: "auto",
    /** Google Gemini (palier gratuit). */
    geminiApiKey: "",
    geminiModel: "gemini-flash-latest",
    /** Ollama (local, gratuit). */
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "mistral",
    /** Claude (payant). */
    claudeApiKey: "",
    claudeModel: "claude-opus-5-5",
    claudeEffort: "low",
    /** Domaines où Lexo est désactivé. */
    disabledSites: [],
    /** Règles désactivées par l'utilisateur (ids LanguageTool). */
    disabledRules: [],
    /** Dictionnaire personnel. */
    dictionary: [],
  });

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  async function load() {
    try {
      const stored = await ext.storage.local.get(null);
      return Object.assign(clone(DEFAULTS), stored || {});
    } catch (e) {
      return clone(DEFAULTS);
    }
  }

  async function save(patch) {
    await ext.storage.local.set(patch);
  }

  function onChange(cb) {
    try {
      ext.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        const patch = {};
        for (const k of Object.keys(changes)) patch[k] = changes[k].newValue;
        cb(patch);
      });
    } catch (e) { /* contexte invalidé */ }
  }

  /** Message de l'interface (i18n) avec repli. */
  function t(key, subs, fallback) {
    try {
      const v = ext.i18n.getMessage(key, subs);
      if (v) return v;
    } catch (e) { /* ignore */ }
    return fallback != null ? fallback : key;
  }

  const LexoSettings = { DEFAULTS, load, save, onChange, t, ext };
  root.LexoSettings = LexoSettings;
  if (typeof module !== "undefined" && module.exports) module.exports = LexoSettings;
})(typeof globalThis !== "undefined" ? globalThis : this);
