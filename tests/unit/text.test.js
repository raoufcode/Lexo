const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../src/shared/text.js");

test("splitParagraphs garde les décalages", () => {
  const text = "Bonjour.\n\nComment ça va ?\n  \nFin";
  const p = T.splitParagraphs(text);
  assert.deepEqual(p.map((x) => x.text), ["Bonjour.", "Comment ça va ?", "Fin"]);
  for (const x of p) assert.equal(text.substr(x.start, x.text.length), x.text);
});

test("splitParagraphs coupe les paragraphes géants aux fins de phrases", () => {
  const sentence = "Ceci est une phrase assez longue pour le test. ";
  const text = sentence.repeat(200);
  const p = T.splitParagraphs(text, 1000);
  assert.ok(p.length > 5);
  assert.equal(p.map((x) => x.text).join(""), text);
  for (const x of p) {
    assert.ok(x.text.length <= 1000);
    assert.equal(text.substr(x.start, x.text.length), x.text);
  }
});

test("diff", () => {
  assert.equal(T.diff("abc", "abc"), null);
  assert.deepEqual(T.diff("le chat", "le gros chat"), { start: 3, oldEnd: 3, newEnd: 8, delta: 5 });
});

const M = (offset, length, context) => ({ offset, length, context });

test("remapMatches: insertion avant -> décalage", () => {
  const old = "Je suis aller au marcher.";
  const m = [M(8, 5, "aller"), M(17, 7, "marcher")];
  const neu = "Hier, " + old;
  const r = T.remapMatches(m, old, neu);
  assert.deepEqual(r.map((x) => neu.substr(x.offset, x.length)), ["aller", "marcher"]);
});

test("remapMatches: modification dans un mot -> retirée", () => {
  const old = "Je suis aller au marcher.";
  const m = [M(8, 5, "aller"), M(17, 7, "marcher")];
  const neu = "Je suis allé au marcher.";
  const r = T.remapMatches(m, old, neu);
  assert.deepEqual(r.map((x) => x.context), ["marcher"]);
  assert.equal(neu.substr(r[0].offset, r[0].length), "marcher");
});

test("remapMatches: mot prolongé juste après -> retiré", () => {
  const old = "un mo";
  const r = T.remapMatches([M(3, 2, "mo")], old, "un mot");
  assert.equal(r.length, 0);
});

test("remapMatches: espace tapée après une faute -> conservée", () => {
  const r = T.remapMatches([M(3, 4, "chta")], "le chta", "le chta ");
  assert.equal(r.length, 1);
});

test("buildBatches + splitBatchMatches", () => {
  const segs = [{ text: "aaa bbb" }, { text: "ccc" }, { text: "dd ee" }];
  const [batch] = T.buildBatches(segs, 1000);
  assert.equal(batch.text, "aaa bbb\n\nccc\n\ndd ee");
  const matches = [
    { offset: 4, length: 3 },   // bbb
    { offset: 9, length: 3 },   // ccc
    { offset: 17, length: 2 },  // ee
    { offset: 5, length: 6 },   // à cheval -> ignorée
  ];
  const per = T.splitBatchMatches(batch, matches);
  assert.deepEqual(per.map((l) => l.map((m) => m.offset)), [[4], [0], [3]]);
});

test("buildBatches respecte la taille maximale", () => {
  const segs = Array.from({ length: 10 }, () => ({ text: "x".repeat(400) }));
  const b = T.buildBatches(segs, 1000);
  assert.ok(b.length >= 4);
  for (const x of b) assert.ok(x.text.length <= 1000);
});

test("escapeHtml", () => {
  assert.equal(T.escapeHtml(`<b a="1">'&`), "&lt;b a=&quot;1&quot;&gt;&#39;&amp;");
});

test("diffToEdits : phrase très mal tapée (cas réel)", () => {
  const o = "JE co,stete que le mail na' pas éte envoye cotecteme,nt.";
  const f = "Je constate que le mail n'a pas été envoyé correctement.";
  const e = T.diffToEdits(o, f);
  assert.deepEqual(e.map((x) => [o.substr(x.offset, x.length), x.to]), [
    ["JE", "Je"], ["co,stete", "constate"], ["na'", "n'a"], ["éte", "été"], ["envoye", "envoyé"], ["cotecteme,nt", "correctement"],
  ]);
  // Appliquer toutes les corrections redonne exactement la phrase corrigée.
  let out = o;
  for (const x of e.slice().reverse()) out = out.slice(0, x.offset) + x.to + out.slice(x.offset + x.length);
  assert.equal(out, f);
});

test("diffToEdits : insertion, texte identique, espaces seuls", () => {
  assert.deepEqual(T.diffToEdits("Il manque mot ici.", "Il manque un mot ici.").map((x) => [x.from, x.to]), [["manque", "manque un"]]);
  assert.deepEqual(T.diffToEdits("Tout va bien.", "Tout va bien."), []);
  assert.deepEqual(T.diffToEdits("Bonjour  toi", "Bonjour toi"), []);
});
