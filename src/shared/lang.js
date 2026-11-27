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

  // ---------------------------------------------------------------------------
  // Détecteur spécialisé français / anglais : fiable sur les phrases courtes,
  // le style SMS et les fautes de frappe (là où les détecteurs génériques
  // hésitent entre 30 langues et se trompent, ex. italien, espagnol, catalan).
  // ---------------------------------------------------------------------------
  const FR_WORDS = new Map(Object.entries({
    // très discriminants (poids 1.5)
    le: 1.5, les: 1.5, une: 1.5, des: 1.5, du: 1.5, est: 1.5, et: 1.2, je: 1.5, tu: 1.2, il: 1.2,
    elle: 1.5, nous: 1.5, vous: 1.5, ils: 1.5, elles: 1.5, que: 1.5, qui: 1.5, pas: 1.5, ne: 1.2,
    avec: 1.5, dans: 1.5, sur: 1.2, mais: 1.5, ou: 1.2, où: 1.5, ce: 1.2, cette: 1.5, ces: 1.5,
    sont: 1.5, suis: 1.5, être: 1.5, avoir: 1.5, été: 1.5, merci: 1.5, bonjour: 1.5, bonsoir: 1.5,
    salut: 1.2, oui: 1.5, très: 1.5, aussi: 1.5, alors: 1.5, donc: 1.5, car: 0.8, quand: 1.5, ça: 1.5,
    cela: 1.5, ceci: 1.5, chez: 1.5, sans: 1.2, vers: 1, depuis: 1.5, encore: 1.5, toujours: 1.5,
    jamais: 1.5, rien: 1.5, tout: 1.2, tous: 1.5, toute: 1.5, toutes: 1.5, même: 1.5, autre: 1.2,
    beaucoup: 1.5, peu: 1.2, trop: 1.2, déjà: 1.5, ici: 1.5, là: 1.5, quel: 1.5, quelle: 1.5,
    pourquoi: 1.5, comment: 1.5, combien: 1.5, parce: 1.5, cordialement: 1.5, madame: 1.5,
    monsieur: 1.5, demain: 1.5, hier: 1.5, aujourd: 1.5, mon: 1, ma: 0.6, mes: 1.5, ton: 0.8, ta: 0.8,
    tes: 1.2, sa: 1, ses: 1.5, leur: 1.5, leurs: 1.5, notre: 1.5, nos: 1.5, votre: 1.5, vos: 1.5,
    au: 1.2, aux: 1.5, de: 1.2, la: 1, un: 0.8, en: 0.6, se: 1, lui: 1.2, y: 0.6, faire: 1.5, fait: 1.5,
    faut: 1.5, peux: 1.5, peut: 1.5, veux: 1.5, veut: 1.5, vais: 1.5, va: 1, vas: 1.5, ai: 1.2,
    avez: 1.5, avons: 1.5, ont: 1.5, était: 1.5, avait: 1.5, bien: 1.2, bon: 0.8, bonne: 1.5,
    entre: 0.8, sous: 1.2, pour: 0.8, comme: 1.5, plus: 0.5, moins: 1.5, non: 0.6, mail: 0.2,
    svp: 1.5, stp: 1.5, bcp: 1.5, cdt: 1.5, slt: 1.5, mdr: 1.5, jsp: 1.5, pk: 1.2, pq: 1.2, tkt: 1.5,
    ok: 0, voila: 1.5, voilà: 1.5, juste: 0.8, "peut-être": 1.5, "aujourd'hui": 1.5,
  }));
  const EN_WORDS = new Map(Object.entries({
    the: 1.5, and: 1.5, is: 1.2, are: 1.5, was: 1.5, were: 1.5, be: 1.2, been: 1.5, being: 1.5,
    have: 1.5, has: 1.5, had: 1.5, do: 1.2, does: 1.5, did: 1.5, not: 1.2, yes: 1.5, to: 1.2, of: 1.2,
    in: 0.8, on: 0.4, at: 1.2, by: 1.2, for: 1.2, from: 1.5, with: 1.5, as: 0.5, that: 1.5, this: 1.5,
    these: 1.5, those: 1.5, it: 1.2, its: 1.2, i: 1.2, you: 1.5, he: 1.2, she: 1.5, we: 1.2, they: 1.5,
    my: 1.5, your: 1.5, his: 1.5, her: 1.5, our: 1.5, their: 1.5, them: 1.5, him: 1.5, us: 0.8,
    will: 1.5, would: 1.5, can: 1.2, could: 1.5, should: 1.5, shall: 1.5, may: 1, might: 1.5, must: 1.5,
    what: 1.5, which: 1.5, who: 1.5, when: 1.5, where: 1.5, why: 1.5, how: 1.5, there: 1.5, here: 1.2,
    than: 1.5, then: 1.5, also: 1.5, just: 1, about: 1.5, please: 1.5, thanks: 1.5, thank: 1.5,
    hello: 1.2, hi: 1.2, hey: 1.2, dear: 1.5, regards: 1.5, best: 1, sorry: 1.5, if: 1.2, so: 0.8,
    because: 1.5, but: 0.8, or: 0.6, all: 1, any: 1.5, some: 1.5, more: 1.5, most: 1.5, very: 1.5,
    much: 1.5, many: 1.5, really: 1.5, get: 1.5, got: 1.5, make: 1.5, made: 1.5, know: 1.5,
    think: 1.5, want: 1.5, need: 1.5, like: 1.5, well: 1, good: 1.5, great: 1.5, today: 1.5,
    tomorrow: 1.5, yesterday: 1.5, meeting: 1, see: 1.2, let: 1.2, me: 0.4, an: 0.6, no: 0.6,
    thx: 1.5, pls: 1.5, plz: 1.5, ur: 1.2, u: 0.8, lol: 1, btw: 1.5, asap: 1.2, gonna: 1.5, wanna: 1.5,
    im: 1.2, dont: 1.5, cant: 1.5, wont: 1.5, didnt: 1.5, doesnt: 1.5, isnt: 1.5, ive: 1.2, youre: 1.5,
    one: 1, two: 1.5, new: 1, time: 1, now: 1.2, up: 1, out: 1.2, "there's": 1.5, "it's": 1.5, "i'm": 1.5,
    "don't": 1.5, "can't": 1.5, "won't": 1.5, "didn't": 1.5, "i've": 1.5, "you're": 1.5, "i'll": 1.5, "we're": 1.5,
  }));

  /**
   * Classe un texte en français ou anglais.
   * @returns {{lang: "fr"|"en"|null, confidence:number, fr:number, en:number}}
   */
  function frenchOrEnglish(text) {
    const t = String(text || "");
    let fr = 0, en = 0;
    const words = t.toLowerCase().match(/[\p{L}'’-]+/gu) || [];
    for (let w of words) {
      w = w.replace(/’/g, "'");
      if (FR_WORDS.has(w)) fr += FR_WORDS.get(w);
      if (EN_WORDS.has(w)) en += EN_WORDS.get(w);
      // Élisions françaises : l'eau, d'accord, j'ai, qu'il, n'a, c'est, s'il, m'a, t'as
      if (/^(l|d|j|qu|n|c|s|m|t|jusqu|lorsqu|puisqu)'\p{L}/u.test(w)) {
        fr += 1.4;
        const rest = w.slice(w.indexOf("'") + 1);
        if (FR_WORDS.has(rest)) fr += FR_WORDS.get(rest) * 0.5;
      } else if (/^\p{L}+'(s|t|re|ve|ll|d|m)$/u.test(w)) {
        en += 1.4; // it's, don't, we're, I'll, I'd, I'm
      }
      // Terminaisons caractéristiques
      if (w.length > 4) {
        if (/(eau|eaux|eux|euse|ais|ait|aient|ez|ée|ées|ité|oir|oire|ième|ment)$/.test(w)) fr += 0.35;
        if (/(ing|ings|ed|ly|ness|ship|ful|less|ous|ight|ould|ough)$/.test(w)) en += 0.35;
      }
    }
    // Lettres accentuées : quasi absentes en anglais
    const acc = (t.match(/[éèêëàâîïôûùüçœæÉÈÊÀÇ]/g) || []).length;
    fr += Math.min(acc, 6) * 0.7;
    // Digrammes et lettres typiques de l'anglais
    const lower = t.toLowerCase();
    en += Math.min((lower.match(/th|wh|sh(?!ampo)/g) || []).length, 8) * 0.3;
    en += Math.min((lower.match(/w/g) || []).length, 6) * 0.15;
    fr += Math.min((lower.match(/qu|ou[^n]|oi/g) || []).length, 8) * 0.15;
    // « I » isolé en majuscule
    en += Math.min((t.match(/(^|[^\p{L}])I([^\p{L}']|$|')/gu) || []).length, 3) * 1.2;
    // Ponctuation française : espace avant ? ! : ; et guillemets « »
    fr += Math.min((t.match(/\p{L} [?!:;]|[«»]/gu) || []).length, 3) * 0.6;

    const total = fr + en;
    if (total < 0.9) return { lang: null, confidence: 0, fr, en };
    const lang = fr >= en ? "fr" : "en";
    const margin = Math.abs(fr - en) / total; // 0..1
    const strength = Math.min(1, Math.max(fr, en) / 3); // assez d'indices ?
    const confidence = Math.round(margin * (0.45 + 0.55 * strength) * 100) / 100;
    return { lang: fr === en ? null : lang, confidence, fr, en };
  }

  /**
   * Devine la langue parmi une liste autorisée (par défaut : français, anglais).
   */
  function guessAmong(text, allowed) {
    const list = (allowed && allowed.length ? allowed : Object.keys(LT_DEFAULT_VARIANT)).map(base);
    if (list.length === 1) return { lang: list[0], confidence: 1 };
    const onlyFrEn = list.every((l) => l === "fr" || l === "en");
    if (onlyFrEn) return frenchOrEnglish(text);
    const g = guess(text);
    if (g.lang && list.includes(g.lang)) {
      // Entre fr et en, le détecteur spécialisé tranche mieux.
      if (g.lang === "fr" || g.lang === "en") {
        const fe = frenchOrEnglish(text);
        if (fe.lang && fe.confidence >= 0.3 && list.includes(fe.lang)) return fe;
      }
      return g;
    }
    // Langue détectée non autorisée : on se rabat sur fr/en s'ils sont permis.
    if (list.includes("fr") && list.includes("en")) return frenchOrEnglish(text);
    return { lang: null, confidence: 0 };
  }

  const LexoLang = {
    LT_DEFAULT_VARIANT, VARIANTS, NAMES, MAIN_LANGS,
    base, isSupported, toLT, name, guess, guessAmong, frenchOrEnglish, normalizeVariant,
    allCodes: () => Object.keys(LT_DEFAULT_VARIANT),
  };

  root.LexoLang = LexoLang;
  if (typeof module !== "undefined" && module.exports) module.exports = LexoLang;
})(typeof globalThis !== "undefined" ? globalThis : this);
