const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("./setup.js");
const { rephrase } = G.LexoRephrase;

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

const S = (o) => Object.assign({}, G.LexoSettings.DEFAULTS, { claudeApiKey: "sk-test" }, o);

test("sans clé : erreur no_key", async () => {
  await assert.rejects(rephrase({ text: "x" }, S({ claudeApiKey: "" })), (e) => e.code === "no_key");
});

test("requête : modèle, effort, sortie structurée, repli", async () => {
  let seen;
  installSdk(async (p, opts) => {
    seen = { p, opts };
    return {
      model: p.model, stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ language: "fr", corrected: "Je suis allé au marché.", explanation: "Accord", suggestions: [{ label: "Formel", text: "Je me suis rendu au marché." }] }) }],
    };
  });
  const r = await rephrase({ text: "Je suis aller au marcher.", tone: "formal", lang: "fr" }, S());
  assert.equal(seen.opts.dangerouslyAllowBrowser, true);
  assert.equal(seen.p.model, "claude-opus-5-5");
  assert.equal(seen.p.output_config.effort, "low");
  assert.equal(seen.p.output_config.format.type, "json_schema");
  assert.deepEqual(seen.p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(seen.p.fallbacks, "default");
  assert.equal(r.corrected, "Je suis allé au marché.");
  assert.equal(r.suggestions.length, 1);
});

test("Haiku : pas de paramètre de repli", async () => {
  let seen;
  installSdk(async (p) => { seen = p; return { stop_reason: "end_turn", content: [{ type: "text", text: '{"language":"en","corrected":"Hi","explanation":"","suggestions":[]}' }] }; });
  await rephrase({ text: "Hi there friend", tone: "neutral" }, S({ claudeModel: "claude-haiku-5-5" }));
  assert.equal(seen.fallbacks, undefined);
  assert.equal(seen.betas, undefined);
});

test("refus et erreurs typées", async () => {
  installSdk(async () => ({ stop_reason: "refusal", content: [] }));
  await assert.rejects(rephrase({ text: "texte refusé ici" }, S()), (e) => e.code === "refusal");
  const SDK = installSdk(async () => { throw new SDK.AuthenticationError("bad key"); });
  await assert.rejects(rephrase({ text: "autre texte ici" }, S()), (e) => e.code === "auth");
});
