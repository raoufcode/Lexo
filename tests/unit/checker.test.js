const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("./setup.js");
const { Checker, normalizeServer } = G.LexoChecker;
const settings = () => Object.assign({}, G.LexoSettings.DEFAULTS, { ltServer: "http://lt.test" });

/** Faux serveur LanguageTool : signale chaque occurrence des mots de `bad`. */
function mockFetch(bad, log) {
  return async (url, opts) => {
    const body = new URLSearchParams(opts.body);
    const text = body.get("text");
    log && log.push({ url, language: body.get("language"), text });
    const matches = [];
    for (const [word, fix] of Object.entries(bad)) {
      let i = -1;
      while ((i = text.indexOf(word, i + 1)) >= 0) {
        matches.push({ offset: i, length: word.length, message: "Faute", replacements: [{ value: fix }],
          rule: { id: "MORFOLOGIK_RULE_FR", issueType: "misspelling", category: { id: "TYPOS", name: "Typos" } } });
      }
    }
    return { ok: true, status: 200, json: async () => ({ matches }) };
  };
}

test("normalizeServer", () => {
  assert.equal(normalizeServer("api.languagetool.org/v2/check"), "https://api.languagetool.org");
  assert.equal(normalizeServer("http://localhost:8081/"), "http://localhost:8081");
});

test("détecte le français et place les erreurs au bon endroit", async () => {
  const log = [];
  G.fetch = mockFetch({ marcher: "marché" }, log);
  const c = new Checker();
  const text = "Je suis allé au marcher hier soir avec mes amis.";
  const r = await c.check({ text, fieldId: 1, seq: 1 }, settings());
  assert.equal(r.lang, "fr");
  assert.equal(r.status, "ok");
  assert.equal(log[0].language, "fr");
  assert.equal(r.matches.length, 1);
  assert.equal(text.substr(r.matches[0].offset, r.matches[0].length), "marcher");
});

test("anglais détecté automatiquement, variante préférée respectée", async () => {
  const log = [];
  G.fetch = mockFetch({}, log);
  const s = settings();
  s.variants = Object.assign({}, s.variants, { en: "en-GB" });
  const r = await new Checker().check({ text: "I have been working on this project and it is going well.", fieldId: 1, seq: 1 }, s);
  assert.equal(r.lang, "en");
  assert.equal(log[0].language, "en-GB");
});

test("texte court ambigu : langue par défaut (français)", async () => {
  G.fetch = mockFetch({});
  const r = await new Checker().check({ text: "Ok", fieldId: 1, seq: 1 }, settings());
  assert.equal(r.lang, "fr");
});

test("ne revérifie que les paragraphes modifiés (cache)", async () => {
  const log = [];
  G.fetch = mockFetch({ marcher: "marché" }, log);
  const c = new Checker();
  const p1 = "Je suis allé au marcher hier soir avec mes amis.";
  const p2 = "Nous avons acheté des pommes et des poires pour le dessert.";
  await c.check({ text: p1 + "\n" + p2, fieldId: 1, seq: 1 }, settings());
  assert.equal(log.length, 1);
  const p3 = "Ensuite nous sommes rentrés à la maison.";
  const text = p1 + "\n" + p2 + "\n" + p3;
  const r = await c.check({ text, fieldId: 1, seq: 2 }, settings());
  assert.equal(log.length, 2);
  assert.equal(log[1].text, p3);
  assert.equal(text.substr(r.matches[0].offset, r.matches[0].length), "marcher");
});

test("document multilingue : un lot par langue", async () => {
  const log = [];
  G.fetch = mockFetch({}, log);
  const fr = "Bonjour à tous, je vous écris pour vous donner des nouvelles de notre projet.";
  const en = "The meeting will take place next week and we would like you to be there with us.";
  const r = await new Checker().check({ text: fr + "\n\n" + en, fieldId: 1, seq: 1 }, settings());
  assert.deepEqual(log.map((l) => l.language).sort(), ["en-US", "fr"]);
});

test("dictionnaire personnel et règles désactivées", async () => {
  G.fetch = mockFetch({ Lexo: "Lexi", marcher: "marché" });
  const s = settings();
  s.dictionary = ["lexo"];
  const r = await new Checker().check({ text: "J'utilise Lexo pour aller au marcher demain matin.", fieldId: 1, seq: 1 }, s);
  assert.deepEqual(r.matches.map((m) => m.context), ["marcher"]);
  s.disabledRules = ["MORFOLOGIK_RULE_FR"];
  const r2 = await new Checker().check({ text: "J'utilise Lexo pour aller au marcher demain matin.", fieldId: 1, seq: 1 }, s);
  assert.equal(r2.matches.length, 0);
});

test("hors ligne : les règles locales prennent le relais", async () => {
  G.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const r = await new Checker().check({ text: "Il est est parti hier soir sans rien dire.", fieldId: 1, seq: 1 }, settings());
  assert.equal(r.status, "offline");
  assert.deepEqual(r.matches.map((m) => m.rule.id), ["LEXO_REPEAT"]);
});

test("429 : signale la limitation", async () => {
  G.fetch = async () => ({ ok: false, status: 429, text: async () => "" });
  const r = await new Checker().check({ text: "Bonjour, comment allez-vous aujourd'hui ?", fieldId: 1, seq: 1 }, settings());
  assert.equal(r.status, "rate_limited");
});

test("requête périmée abandonnée", async () => {
  let calls = 0;
  G.fetch = async (u, o) => { calls++; await new Promise((r) => setTimeout(r, 30)); return mockFetch({})(u, o); };
  const c = new Checker();
  const a = c.check({ text: "Premier texte à vérifier pour le test.", fieldId: 7, seq: 1 }, settings());
  const b = c.check({ text: "Second texte à vérifier pour le test.", fieldId: 7, seq: 2 }, settings());
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.stale, true);
  assert.equal(rb.status, "ok");
});
