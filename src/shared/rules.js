/*
 * Lexo — règles locales instantanées (hors ligne). Elles complètent le
 * moteur distant et garantissent un retour immédiat même sans réseau.
 * Volontairement prudentes : aucune fausse alerte vaut mieux que du bruit.
 */
(function (root) {
  "use strict";

  const MSG = {
    fr: {
      repeat: (w) => `Le mot « ${w} » est répété.`,
      spaces: "Plusieurs espaces consécutives.",
      spaceBefore: "Espace superflue avant la ponctuation.",
      capital: "Une phrase commence normalement par une majuscule.",
      cat: { repeat: "Répétition", spaces: "Typographie", spaceBefore: "Typographie", capital: "Majuscule" },
    },
    en: {
      repeat: (w) => `The word “${w}” is repeated.`,
      spaces: "Several consecutive spaces.",
      spaceBefore: "Unnecessary space before punctuation.",
      capital: "A sentence should start with a capital letter.",
      cat: { repeat: "Repetition", spaces: "Typography", spaceBefore: "Typography", capital: "Capitalization" },
    },
  };

  // Répétitions légitimes (« nous nous », « vous vous », « that that », ...)
  const ALLOWED_REPEATS = new Set([
    "nous", "vous", "that", "had", "is", "ha", "da", "bye", "très",
    "so", "no", "non", "si", "oui", "yes", "bla", "hi", "hey", "go", "well",
  ]);

  function msgs(lang) {
    return MSG[String(lang || "fr").slice(0, 2)] || MSG.en;
  }

  /**
   * @param {string} text
   * @param {string} lang code de base (fr, en, ...)
   * @returns {Array} erreurs au format Lexo
   */
  function check(text, lang) {
    const M = msgs(lang);
    const out = [];
    const base = String(lang || "").slice(0, 2);

    // 1. Mot répété : « le le », « the the »
    const reRep = /(^|[^\p{L}\p{N}'’])([\p{L}'’]{2,})(\s+)(\2)(?=$|[^\p{L}\p{N}'’])/giu;
    let m;
    while ((m = reRep.exec(text))) {
      const w = m[2];
      if (w.toLowerCase() !== m[4].toLowerCase()) continue;
      if (ALLOWED_REPEATS.has(w.toLowerCase())) continue;
      const offset = m.index + m[1].length;
      out.push(make("LEXO_REPEAT", offset, w.length * 2 + m[3].length, M.repeat(w), [w], "duplication", M.cat.repeat));
      reRep.lastIndex = offset + w.length;
    }

    // 2. Espaces multiples à l'intérieur d'une ligne (pas d'indentation)
    const reSp = /(\S)( {2,})(?=\S)/g;
    while ((m = reSp.exec(text))) {
      const offset = m.index + 1;
      out.push(make("LEXO_SPACES", offset, m[2].length, M.spaces, [" "], "whitespace", M.cat.spaces));
    }

    // 3. Espace avant , ou . (toutes langues). En français, l'espace avant
    //    ; : ! ? est correcte : on n'y touche pas.
    const reBefore = /(\p{L})( +)([,.])(?=\s|$)/gu;
    while ((m = reBefore.exec(text))) {
      // « etc . » ou points de suspension « . . . » : on évite.
      if (m[3] === "." && text.substr(m.index + m[0].length, 2).startsWith(".")) continue;
      const offset = m.index + 1;
      out.push(make("LEXO_SPACE_BEFORE_PUNCT", offset, m[2].length + 1, M.spaceBefore, [m[3]], "typographical", M.cat.spaceBefore));
    }

    // 4. Majuscule en début de phrase, après « . ! ? » suivi d'une espace.
    //    Uniquement pour les langues à casse, et pas après une abréviation.
    if (["fr", "en", "es", "de", "it", "pt", "nl"].includes(base)) {
      const reCap = /([.!?])(\s+)(\p{Ll}[\p{L}'’]*)/gu;
      while ((m = reCap.exec(text))) {
        const before = text.slice(Math.max(0, m.index - 6), m.index + 1);
        if (/(\b\p{L}\.|etc\.|ex\.|cf\.|p\.|M\.|Mme\.|e\.g\.|i\.e\.|vs\.|\.\.)$/u.test(before)) continue;
        if (/\d\.$/.test(before)) continue; // 3.14, numérotation
        if (/https?:\/\/\S*$/.test(text.slice(Math.max(0, m.index - 60), m.index + 1))) continue;
        const word = m[3];
        const offset = m.index + 1 + m[2].length;
        const fixed = word.charAt(0).toUpperCase() + word.slice(1);
        out.push(make("LEXO_SENTENCE_CAPITAL", offset, word.length, M.capital, [fixed], "typographical", M.cat.capital));
      }
    }
    return out;
  }

  function make(id, offset, length, message, replacements, issueType, category) {
    return {
      offset, length, message, shortMessage: "",
      replacements: replacements.map((value) => ({ value })),
      rule: { id, issueType, category: { id: "LEXO", name: category } },
      source: "local",
    };
  }

  const LexoRules = { check };
  root.LexoRules = LexoRules;
  if (typeof module !== "undefined" && module.exports) module.exports = LexoRules;
})(typeof globalThis !== "undefined" ? globalThis : this);
