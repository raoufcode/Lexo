/*
 * Lexo — langues : correspondance des codes, libellés, détection locale légère.
 * Module "universel" : utilisable dans le service worker, les content scripts,
 * les pages d'options et sous Node (tests).
 */
(function (root) {
  "use strict";

  /** Langues prises en charge par LanguageTool -> variante par défaut. */
  const LT_DEFAULT_VARIANT = {
    fr: "fr", en: "en-US", de: "de-DE", es: "es", it: "it", pt: "pt-PT",
    nl: "nl", pl: "pl-PL", ru: "ru-RU", uk: "uk-UA", ca: "ca-ES", sv: "sv",
    da: "da-DK", el: "el-GR", ro: "ro-RO", sk: "sk-SK", sl: "sl-SI",
    ja: "ja-JP", zh: "zh-CN", ar: "ar", fa: "fa", gl: "gl-ES", eo: "eo",
    ga: "ga-IE", be: "be-BY", br: "br-FR", ta: "ta-IN", tl: "tl-PH",
    km: "km-KH", ast: "ast-ES",
  };

  /** Variantes régionales proposées dans les options. */
  const VARIANTS = {
    en: ["en-US", "en-GB", "en-CA", "en-AU", "en-NZ", "en-ZA"],
    pt: ["pt-PT", "pt-BR", "pt-AO", "pt-MZ"],
    de: ["de-DE", "de-AT", "de-CH"],
    fr: ["fr", "fr-CA", "fr-CH", "fr-BE"],
    nl: ["nl", "nl-BE"],
    es: ["es", "es-AR"],
  };

  /** Libellés (autonymes : chaque langue est écrite dans sa propre langue). */
  const NAMES = {
    fr: "Français", en: "English", de: "Deutsch", es: "Español", it: "Italiano",
    pt: "Português", nl: "Nederlands", pl: "Polski", ru: "Русский", uk: "Українська",
    ca: "Català", sv: "Svenska", da: "Dansk", el: "Ελληνικά", ro: "Română",
    sk: "Slovenčina", sl: "Slovenščina", ja: "日本語", zh: "中文", ar: "العربية",
    fa: "فارسی", gl: "Galego", eo: "Esperanto", ga: "Gaeilge", be: "Беларуская",
    br: "Brezhoneg", ta: "தமிழ்", tl: "Tagalog", km: "ខ្មែរ", ast: "Asturianu",
  };

  /** Langues mises en avant dans les menus. */
  const MAIN_LANGS = ["fr", "en", "es", "de", "it", "pt", "nl", "ar"];

  /** Langue de base (« fr-CA » -> « fr »). */
  function base(code) {
    if (!code) return "";
    return String(code).toLowerCase().split(/[-_]/)[0];
  }

  function isSupported(code) {
    return Object.prototype.hasOwnProperty.call(LT_DEFAULT_VARIANT, base(code));
  }

  /**
   * Code LanguageTool à utiliser pour une langue, en tenant compte des
   * préférences de variantes de l'utilisateur ({ en: "en-GB", ... }).
   */
  function toLT(code, preferred) {
    const b = base(code);
    if (!isSupported(b)) return null;
    const pref = preferred && preferred[b];
    if (pref && (VARIANTS[b] || []).includes(pref)) return pref;
    // Code régional déjà valide (ex. « pt-BR » détecté) : on le garde.
    if (code && code !== b) {
      const norm = normalizeVariant(code);
      if ((VARIANTS[b] || []).includes(norm)) return norm;
    }
    return LT_DEFAULT_VARIANT[b];
  }

  function normalizeVariant(code) {
    const parts = String(code).split(/[-_]/);
    if (parts.length < 2) return parts[0].toLowerCase();
    return parts[0].toLowerCase() + "-" + parts[1].toUpperCase();
  }

  function name(code) {
    return NAMES[base(code)] || String(code || "").toUpperCase();
  }

  // ---------------------------------------------------------------------------
  // Détection locale par mots-outils : instantanée, hors ligne, fiable même sur
  // des phrases courtes là où les détecteurs statistiques hésitent.
  // ---------------------------------------------------------------------------
  const STOPWORDS = {
    fr: "le la les un une des du de et est en que qui pour dans pas ne sur au aux avec ce cette ces se sa son ses mais ou où je tu il elle nous vous ils elles on mon ma mes ton ta tes leur leurs très plus être avoir été fait bonjour merci oui non comme aussi alors donc car quand c'est j'ai suis sont était avez avons votre vos notre nos lui y d'un d'une qu'il qu'on l'on ça cela".split(" "),
    en: "the a an and is are was were to of in that it for on with as at by this be have has had not but or from you i he she we they my your his her our their will would can could do does did what which who when where there here been very just about thanks hello yes no if so than then also it's i'm don't".split(" "),
    es: "el la los las un una unos unas y es en que de del por para con no se lo le su sus al como más pero muy está están ser estar hay yo tú él ella nosotros ustedes mi mis tu tus este esta esto también porque cuando donde gracias hola sí".split(" "),
    de: "der die das und ist nicht ein eine einen dem den des zu mit sich auf für von im in es ich du er sie wir ihr sind war hat haben wird werden auch noch aber oder wenn dass bei nach wie mein dein sehr danke hallo ja nein".split(" "),
    it: "il lo la i gli le un una uno e è di del della che non per con su da in al alla sono come più ma anche questo questa io tu lui lei noi voi loro mio mia molto grazie ciao sì perché quando dove".split(" "),
    pt: "o a os as um uma e é de do da dos das que não para com em no na por se seu sua mais mas como muito também eu você ele ela nós eles meu minha está são obrigado obrigada olá sim porque quando onde".split(" "),
    nl: "de het een en is van in dat op te zijn niet met voor aan er maar om ook als bij of uit dan nog wel naar ik je jij hij zij we wij jullie mijn heel bedankt hallo ja nee".split(" "),
  };
  const STOP_SETS = {};
  for (const k of Object.keys(STOPWORDS)) STOP_SETS[k] = new Set(STOPWORDS[k]);

  /** Indices orthographiques propres à chaque langue (bonus de score). */
  const CHAR_HINTS = {
    fr: /[àâçéèêëîïôûùüÿœæ]/g,
    es: /[ñ¿¡áíóú]/g,
    de: /[äöüß]/g,
    pt: /[ãõâêôçáéíóú]/g,
    it: /[àèéìòù]/g,
  };

  /** Écritures non latines : détection immédiate. */
  const SCRIPTS = [
    ["ar", /[؀-ۿ]/g],
    ["ru", /[Ѐ-ӿ]/g],
    ["el", /[Ͱ-Ͽ]/g],
    ["ja", /[぀-ヿ]/g],
    ["zh", /[一-鿿]/g],
    ["ta", /[஀-௿]/g],
    ["km", /[ក-៿]/g],
  ];

  /**
   * Devine la langue d'un texte. Renvoie { lang, confidence } où confidence
   * est dans [0, 1], ou { lang: null, confidence: 0 } si indécidable.
   */
  function guess(text) {
    const t = String(text || "");
    if (!t.trim()) return { lang: null, confidence: 0 };

    const letters = (t.match(/\p{L}/gu) || []).length || 1;
    for (const [lang, re] of SCRIPTS) {
      const n = (t.match(re) || []).length;
      if (n / letters > 0.3) {
        // Distinction ukrainien / russe / biélorusse
        if (lang === "ru") {
          if (/[іїєґ]/i.test(t)) return { lang: "uk", confidence: 0.9 };
          if (/[ў]/i.test(t)) return { lang: "be", confidence: 0.9 };
        }
        // Persan : lettres spécifiques
        if (lang === "ar" && /[پچژگ]/.test(t)) return { lang: "fa", confidence: 0.85 };
        return { lang, confidence: 0.95 };
      }
    }

    const words = t.toLowerCase().match(/[\p{L}']+/gu) || [];
    if (!words.length) return { lang: null, confidence: 0 };

    const scores = {};
    for (const k of Object.keys(STOP_SETS)) scores[k] = 0;
    for (const w of words) {
      for (const k in STOP_SETS) {
        if (STOP_SETS[k].has(w)) scores[k] += 1;
      }
      // Élisions françaises : l' d' j' qu' n' s' c'
      if (/^(l|d|j|qu|n|s|c|m|t)'/.test(w)) scores.fr += 0.8;
    }
    for (const k in CHAR_HINTS) {
      const n = (t.match(CHAR_HINTS[k]) || []).length;
      if (n) scores[k] += Math.min(n, 4) * 0.35;
    }
    // Mots ambigus partagés : léger ajustement pour fr vs es/it/pt
    if (/\b(est|une|des|pas)\b/i.test(t)) scores.fr += 0.3;

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [bestLang, best] = ranked[0];
    const second = ranked[1][1];
    if (best < 1) return { lang: null, confidence: 0 };
    const margin = (best - second) / best;
    const coverage = Math.min(1, best / Math.max(3, words.length * 0.35));
    const confidence = Math.max(0, Math.min(1, margin * 0.6 + coverage * 0.4));
    return { lang: bestLang, confidence };
  }

  const LexoLang = {
    LT_DEFAULT_VARIANT, VARIANTS, NAMES, MAIN_LANGS,
    base, isSupported, toLT, name, guess, normalizeVariant,
    allCodes: () => Object.keys(LT_DEFAULT_VARIANT),
  };

  root.LexoLang = LexoLang;
  if (typeof module !== "undefined" && module.exports) module.exports = LexoLang;
})(typeof globalThis !== "undefined" ? globalThis : this);
