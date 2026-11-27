const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/shared/lang.js");

test("guess: français", () => {
  assert.equal(L.guess("Bonjour, je suis aller au marché hier avec mes amis.").lang, "fr");
  assert.equal(L.guess("C'est très bien, merci pour votre aide").lang, "fr");
  assert.equal(L.guess("j'ai fait ça").lang, "fr");
});

test("guess: anglais, espagnol, allemand, italien, portugais, néerlandais", () => {
  assert.equal(L.guess("I have been working on this project for a while and it is great").lang, "en");
  assert.equal(L.guess("Hola, ¿cómo estás? Yo estoy muy bien, gracias por preguntar").lang, "es");
  assert.equal(L.guess("Ich habe heute keine Zeit, aber wir sehen uns morgen").lang, "de");
  assert.equal(L.guess("Ciao, come stai? Io sono molto contento di vederti").lang, "it");
  assert.equal(L.guess("Olá, você está bem? Eu não sei se ele vai").lang, "pt");
  assert.equal(L.guess("Ik heb het niet gezien maar het is heel mooi").lang, "nl");
});

test("guess: écritures non latines", () => {
  assert.equal(L.guess("مرحبا كيف حالك اليوم").lang, "ar");
  assert.equal(L.guess("Привет, как дела?").lang, "ru");
  assert.equal(L.guess("Привіт, як справи? Їжак").lang, "uk");
  assert.equal(L.guess("こんにちは、元気ですか").lang, "ja");
});

test("guess: texte vide ou indécidable", () => {
  assert.equal(L.guess("").lang, null);
  assert.equal(L.guess("12345 !!!").lang, null);
});

test("toLT: variantes et préférences", () => {
  assert.equal(L.toLT("fr"), "fr");
  assert.equal(L.toLT("en"), "en-US");
  assert.equal(L.toLT("en", { en: "en-GB" }), "en-GB");
  assert.equal(L.toLT("pt-br"), "pt-BR");
  assert.equal(L.toLT("de", { de: "xx" }), "de-DE");
  assert.equal(L.toLT("tr"), null);
  assert.equal(L.isSupported("fr-CA"), true);
  assert.equal(L.name("fr"), "Français");
});

test("français / anglais : phrases courtes, style SMS et fautes de frappe", () => {
  const cases = [
    ["Hi, how are you?", "en"], ["thx for ur help", "en"], ["See you tomorrow", "en"], ["I cant come today sorry", "en"],
    ["ok merci", "fr"], ["Bonne journée", "fr"], ["c'est noté", "fr"], ["Le meeting est à 10h", "fr"],
    ["JE co,stete que le mail na' pas éte envoye cotecteme,nt.", "fr"], ["Bonjour, comme àa va ?", "fr"],
    ["dsl jsp si je peux venir", "fr"], ["let me know", "en"], ["on se voit demain", "fr"],
    ["Can you send me the file?", "en"], ["Tu peux m'envoyer le fichier ?", "fr"], ["Yes", "en"], ["Oui", "fr"],
    ["Good morning everyone", "en"], ["Salut tout le monde", "fr"], ["please find attached the report", "en"],
    ["veuillez trouver ci-joint le rapport", "fr"], ["it's fine", "en"], ["à quelle heure", "fr"],
    ["I recieve teh email yesterday", "en"], ["jai pas recu ton mesage", "fr"], ["Nice to meet you", "en"],
  ];
  for (const [t, exp] of cases) assert.equal(L.frenchOrEnglish(t).lang, exp, t);
});

test("guessAmong : seules les langues autorisées sont proposées", () => {
  // Texte espagnol, mais seuls fr/en autorisés : jamais « es »
  assert.ok(["fr", "en", null].includes(L.guessAmong("Hola, ¿cómo estás? Muy bien gracias", ["fr", "en"]).lang));
  assert.equal(L.guessAmong("Hola, ¿cómo estás? Yo estoy muy bien, gracias por preguntar", ["fr", "en", "es"]).lang, "es");
  assert.equal(L.guessAmong("n'importe quoi", ["fr"]).lang, "fr");
});
