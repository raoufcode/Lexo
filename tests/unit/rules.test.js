const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../src/shared/rules.js");

const ids = (text, lang = "fr") => R.check(text, lang).map((m) => [m.rule.id, text.substr(m.offset, m.length), m.replacements[0].value]);

test("mot répété", () => {
  assert.deepEqual(ids("Je suis le le meilleur."), [["LEXO_REPEAT", "le le", "le"]]);
  const r = ids("Il est est parti.");
  assert.deepEqual(r, [["LEXO_REPEAT", "est est", "est"]]);
  assert.deepEqual(ids("nous nous sommes vus"), []);
});

test("espaces multiples", () => {
  assert.deepEqual(ids("Bonjour  le monde"), [["LEXO_SPACES", "  ", " "]]);
  assert.deepEqual(ids("  indentation"), []);
});

test("espace avant virgule / point", () => {
  assert.deepEqual(ids("Bonjour , ça va"), [["LEXO_SPACE_BEFORE_PUNCT", " ,", ","]]);
  // l'espace avant ! ? ; : est correcte en français
  assert.deepEqual(ids("Bonjour ! Ça va ?"), []);
});

test("majuscule en début de phrase", () => {
  assert.deepEqual(ids("Il pleut. alors je reste."), [["LEXO_SENTENCE_CAPITAL", "alors", "Alors"]]);
  assert.deepEqual(ids("Voir p. suivante, etc. merci"), []);
  assert.deepEqual(ids("Version 3.14 ok"), []);
  assert.deepEqual(ids("It rains. then I stay.", "en"), [["LEXO_SENTENCE_CAPITAL", "then", "Then"]]);
});

test("pas de faux positifs sur un texte correct", () => {
  assert.deepEqual(ids("Bonjour, je vous écris au sujet de la réunion. Merci beaucoup !"), []);
  assert.deepEqual(ids("Hello, I am writing about the meeting. Thanks a lot!", "en"), []);
});
