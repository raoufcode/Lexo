const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("./setup.js");
const { rephrase, parseJson } = G.LexoRephrase;

const RESULT = { language: "fr", corrected: "Je suis allé au marché.", explanation: "Accord", suggestions: [{ label: "Formel", text: "Je me suis rendu au marché." }] };
const S = (o) => Object.assign({}, G.LexoSettings.DEFAULTS, o);

function installSdk(handler) {
  class APIError extends Error {}
  class AuthenticationError extends APIError {}
  class FakeAnthropic {
    constructor(opts) { this.opts = opts; this.beta = { messages: { create: (p) => handler(p, opts) } }; }
  }
  Object.assign(FakeAnthropic, { APIError, AuthenticationError, PermissionDeniedError: class extends APIError {},
    RateLimitError: class extends APIError {}, BadRequestError: class extends APIError {}, APIConnectionError: class extends APIError {} });
  G.Anthropic = FakeAnthropic;
  return FakeAnthropic;
}

/** Faux réseau : Ollama éteint sauf si `ollama` fourni, Gemini selon `gemini`. */
function net({ gemini, ollama, log = [] } = {}) {
  G.fetch = async (url, init = {}) => {
    log.push({ url, init });
    const reply = (status, obj) => ({ ok: status < 300, status, text: async () => JSON.stringify(obj) });
    if (url.startsWith("https://generativelanguage.googleapis.com/")) return gemini ? gemini(url, init, reply) : reply(500, {});
    if (url.includes(":11434")) {
      if (!ollama) throw new TypeError("Failed to fetch");
      return ollama(url, init, reply);
    }
    throw new TypeError("unexpected " + url);
  };
  G.LexoRephrase.resetProbe();
  return log;
}

test("aucun fournisseur configuré : no_provider", async () => {
  net();
  await assert.rejects(rephrase({ text: "Bonjour à tous" }, S()), (e) => e.code === "no_provider");
});

test("Gemini (gratuit) : requête et réponse", async () => {
  const log = net({
    gemini: (url, init, reply) => reply(200, { modelVersion: "gemini-x", candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(RESULT) }] } }] }),
  });
  const r = await rephrase({ text: "Je suis aller au marcher.", tone: "formal", lang: "fr" }, S({ geminiApiKey: "AIza-test" }));
  const call = log.find((l) => l.url.includes("generativelanguage"));
  assert.match(call.url, /\/v1beta\/models\/gemini-flash-latest:generateContent$/);
  assert.equal(call.init.headers["x-goog-api-key"], "AIza-test");
  const body = JSON.parse(call.init.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.responseSchema.type, "OBJECT");
  assert.ok(!JSON.stringify(body.generationConfig.responseSchema).includes("additionalProperties"));
  assert.equal(r.provider, "gemini");
  assert.equal(r.corrected, RESULT.corrected);
  assert.equal(r.suggestions.length, 1);
});

test("Gemini : clé invalide -> auth", async () => {
  net({ gemini: (u, i, reply) => reply(400, { error: { message: "API key not valid. Please pass a valid API key." } }) });
  await assert.rejects(rephrase({ text: "Un texte à reformuler" }, S({ geminiApiKey: "bad", rephraseProvider: "gemini" })), (e) => e.code === "auth");
});

test("Ollama (local) : détecté automatiquement", async () => {
  const log = net({
    ollama: (url, init, reply) => url.endsWith("/api/tags")
      ? reply(200, { models: [{ name: "mistral:latest" }] })
      : reply(200, { model: "mistral:latest", message: { role: "assistant", content: JSON.stringify(RESULT) }, done: true }),
  });
  const r = await rephrase({ text: "Je suis aller au marcher.", tone: "neutral", lang: "fr" }, S());
  assert.equal(r.provider, "ollama");
  const body = JSON.parse(log.find((l) => l.url.endsWith("/api/chat")).init.body);
  assert.equal(body.stream, false);
  assert.equal(body.model, "mistral");
  assert.equal(body.format.type, "object");
  assert.deepEqual(await G.LexoRephrase.ollamaModels(S()), ["mistral:latest"]);
});

test("Ollama : origine refusée -> message dédié", async () => {
  net({ ollama: (url, init, reply) => url.endsWith("/api/tags") ? reply(200, { models: [] }) : reply(403, {}) });
  await assert.rejects(rephrase({ text: "Un texte à reformuler" }, S({ rephraseProvider: "ollama" })), (e) => e.code === "ollama_origin");
});

test("mode auto : passe au service suivant en cas d'échec", async () => {
  net({
    gemini: (u, i, reply) => reply(429, { error: { message: "quota" } }),
    ollama: (url, init, reply) => url.endsWith("/api/tags")
      ? reply(200, { models: [] })
      : reply(200, { message: { content: JSON.stringify(RESULT) } }),
  });
  const r = await rephrase({ text: "Encore un autre texte", tone: "neutral" }, S({ geminiApiKey: "k" }));
  assert.equal(r.provider, "ollama");
});

test("IA intégrée à Chrome (API Prompt)", async () => {
  net();
  let created;
  G.LanguageModel = {
    availability: async () => "available",
    create: async (opts) => { created = opts; return { prompt: async (p, o) => { assert.ok(o.responseConstraint); return JSON.stringify(RESULT); }, destroy() {} }; },
  };
  try {
    const r = await rephrase({ text: "Texte pour Chrome", tone: "neutral", lang: "fr" }, S());
    assert.equal(r.provider, "chrome");
    assert.deepEqual(created.expectedOutputs, [{ type: "text", languages: ["fr"] }]);
  } finally {
    delete G.LanguageModel;
  }
});

test("Claude (payant) : modèle, effort, sortie structurée, repli", async () => {
  net();
  let seen;
  installSdk(async (p, opts) => { seen = { p, opts }; return { model: p.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(RESULT) }] }; });
  const r = await rephrase({ text: "Texte pour Claude.", tone: "formal", lang: "fr" }, S({ claudeApiKey: "sk-test" }));
  assert.equal(r.provider, "claude");
  assert.equal(seen.opts.dangerouslyAllowBrowser, true);
  assert.equal(seen.p.model, "claude-opus-5-5");
  assert.equal(seen.p.output_config.effort, "low");
  assert.equal(seen.p.output_config.format.type, "json_schema");
  assert.deepEqual(seen.p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(seen.p.fallbacks, "default");
});

test("Claude : refus et clé refusée", async () => {
  net();
  installSdk(async () => ({ stop_reason: "refusal", content: [] }));
  await assert.rejects(rephrase({ text: "texte refusé ici", rephraseProvider: "claude" }, S({ claudeApiKey: "k", rephraseProvider: "claude" })), (e) => e.code === "refusal");
  const SDK = installSdk(async () => { throw new SDK.AuthenticationError("bad key"); });
  await assert.rejects(rephrase({ text: "autre texte ici" }, S({ claudeApiKey: "k", rephraseProvider: "claude" })), (e) => e.code === "auth");
});

test("parseJson tolère un bloc de code", () => {
  assert.deepEqual(parseJson('Voici :\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJson("pas de json"), (e) => e.code === "parse");
});

test("correction intelligente (aiFix) : un seul appel, corrections mot à mot, cache", async () => {
  const log = net({
    gemini: (url, init, reply) => {
      const body = JSON.parse(init.body);
      assert.match(body.systemInstruction.parts[0].text, /proofreader/);
      assert.equal(body.generationConfig.responseSchema.properties.paragraphs.type, "ARRAY");
      return reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ paragraphs: [
        "Je constate que le mail n'a pas été envoyé correctement.", "Bonjour,",
      ] }) }] } }] });
    },
  });
  const s = S({ geminiApiKey: "k" });
  const paras = ["JE co,stete que le mail na' pas éte envoye cotecteme,nt.", "Bonjour,"];
  const r = await G.LexoRephrase.aiFix(paras, "fr", s);
  assert.equal(r.provider, "gemini");
  const m = r.results[0].matches;
  assert.deepEqual(m.map((x) => [paras[0].substr(x.offset, x.length), x.replacements[0].value]).slice(0, 2), [["JE", "Je"], ["co,stete", "constate"]]);
  assert.equal(m.length, 6);
  assert.ok(m.every((x) => x.rule.id === "LEXO_AI" && x.source === "ai"));
  assert.deepEqual(r.results[1].matches, []);
  const calls = log.filter((l) => l.url.includes("generativelanguage")).length;
  await G.LexoRephrase.aiFix(paras, "fr", s); // depuis le cache
  assert.equal(log.filter((l) => l.url.includes("generativelanguage")).length, calls);
});

test("aiFix : une réécriture complète est ignorée (garde-fou)", async () => {
  net({ gemini: (u, i, reply) => reply(200, { candidates: [{ content: { parts: [{ text: '{"paragraphs":["Un tout autre texte qui n\'a strictement rien à voir avec l\'original, beaucoup plus long."]}' }] } }] }) });
  const r = await G.LexoRephrase.aiFix(["Salut ca va"], "fr", S({ geminiApiKey: "k2" }));
  assert.deepEqual(r.results[0].matches, []);
});
