/*
 * Lexo — point d'entrée de l'arrière-plan : routage des messages, menu
 * contextuel, raccourcis clavier, statistiques.
 */
(function (root) {
  "use strict";

  const { LexoSettings, LexoChecker, LexoRephrase } = root;
  const ext = LexoSettings.ext;
  const t = LexoSettings.t;

  const checker = new LexoChecker.Checker();
  let settingsPromise = LexoSettings.load();
  LexoSettings.onChange((patch) => {
    settingsPromise = LexoSettings.load();
    const affectsCache = ["ltServer", "ltApiKey", "ltUsername", "variants", "level", "defaultLanguage"];
    if (Object.keys(patch).some((k) => affectsCache.includes(k))) checker.clearCache();
    if ("ollamaUrl" in patch) LexoRephrase.resetProbe();
  });

  async function handle(msg, sender) {
    const settings = await settingsPromise;
    switch (msg && msg.type) {
      case "lexo:check": {
        const tabId = sender && sender.tab ? sender.tab.id : "x";
        const frameId = sender && sender.frameId != null ? sender.frameId : 0;
        return checker.check(
          Object.assign({}, msg, { fieldKey: `${tabId}:${frameId}:${msg.fieldId}` }),
          settings
        );
      }
      case "lexo:rephrase":
        try {
          return { ok: true, result: await LexoRephrase.rephrase(msg, settings) };
        } catch (e) {
          return { ok: false, code: e.code || "api", message: e.message };
        }
      case "lexo:ai-fix":
        try {
          return Object.assign({ ok: true }, await LexoRephrase.aiFix(msg.paragraphs || [], msg.lang, settings));
        } catch (e) {
          return { ok: false, code: e.code || "api", message: e.message };
        }
      case "lexo:test-rephrase":
        try {
          const s = Object.assign({}, settings, msg.override || {});
          LexoRephrase.resetProbe();
          return Object.assign({ ok: true }, await LexoRephrase.test(s, msg.provider));
        } catch (e) {
          return { ok: false, code: e.code || "api", message: e.message };
        }
      case "lexo:rephrase-status":
        LexoRephrase.resetProbe();
        return { ok: true, status: await LexoRephrase.status(Object.assign({}, settings, msg.override || {})) };
      case "lexo:ollama-models":
        try {
          return { ok: true, models: await LexoRephrase.ollamaModels(Object.assign({}, settings, msg.override || {})) };
        } catch (e) {
          return { ok: false, code: e.code || "api", message: e.message };
        }
      case "lexo:test-lt": {
        const s = Object.assign({}, settings, msg.override || {});
        const c = new LexoChecker.Checker();
        const r = await c.check({ text: "Je suis aller au marcher hier soir.", fieldId: "test", seq: 1, forced: "fr" }, s);
        return { ok: r.status === "ok", status: r.status, message: r.message, count: r.matches.length };
      }
      case "lexo:open-options":
        await ext.runtime.openOptionsPage();
        return { ok: true };
      case "lexo:stat": {
        const { stats = {} } = await ext.storage.local.get("stats");
        stats[msg.key] = (stats[msg.key] || 0) + (msg.n || 1);
        await ext.storage.local.set({ stats });
        return { ok: true };
      }
      default:
        return { ok: false, code: "unknown_message" };
    }
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("lexo:")) return false;
    handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, code: "internal", message: String(e && e.message || e) }));
    return true; // réponse asynchrone
  });

  // --- Menu contextuel ------------------------------------------------------
  function createMenus() {
    try {
      ext.contextMenus.removeAll(() => {
        ext.contextMenus.create({
          id: "lexo-rephrase",
          title: t("ctxRephrase", null, "Lexo : reformuler la sélection"),
          contexts: ["selection", "editable"],
        });
        ext.contextMenus.create({
          id: "lexo-check",
          title: t("ctxCheck", null, "Lexo : vérifier ce champ"),
          contexts: ["editable"],
        });
      });
    } catch (e) { /* menus indisponibles */ }
  }

  if (ext.contextMenus) {
    ext.contextMenus.onClicked.addListener((info, tab) => {
      if (!tab || tab.id == null) return;
      const type = info.menuItemId === "lexo-rephrase" ? "lexo:rephrase-selection" : "lexo:open-panel";
      sendToTab(tab.id, { type, text: info.selectionText || "" }, info.frameId);
    });
  }

  function sendToTab(tabId, msg, frameId) {
    try {
      const opts = frameId != null ? { frameId } : undefined;
      const p = ext.tabs.sendMessage(tabId, msg, opts);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* onglet sans script (page interne du navigateur) */ }
  }

  // --- Raccourcis clavier ---------------------------------------------------
  if (ext.commands) {
    ext.commands.onCommand.addListener(async (command) => {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const type = command === "rephrase" ? "lexo:rephrase-selection" : "lexo:open-panel";
      sendToTab(tab.id, { type });
    });
  }

  // --- Installation ---------------------------------------------------------
  ext.runtime.onInstalled.addListener((details) => {
    createMenus();
    if (details.reason === "install") {
      ext.tabs.create({ url: ext.runtime.getURL("src/options/options.html#welcome") });
    }
  });
  if (ext.runtime.onStartup) ext.runtime.onStartup.addListener(createMenus);

  root.LexoBackground = { checker, handle };
})(typeof globalThis !== "undefined" ? globalThis : this);
