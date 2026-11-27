/* Lexo — page des réglages (enregistrement automatique). */
(async function () {
  "use strict";
  const { LexoSettings, LexoI18n, LexoLang } = window;
  const ext = LexoSettings.ext;
  const $ = (id) => document.getElementById(id);
  let settings = await LexoSettings.load();
  const t = (k, ...a) => LexoI18n.t(k, ...a);

  function render() {
    LexoI18n.setLang(settings.uiLanguage);
    LexoI18n.apply(document);
    document.title = t("o_title");
  }

  // Listes de langues
  const codes = LexoLang.MAIN_LANGS.concat(LexoLang.allCodes().filter((c) => !LexoLang.MAIN_LANGS.includes(c)));
  function fillLangs(sel, withAuto) {
    sel.textContent = "";
    if (withAuto) sel.add(new Option("✨ " + t("p_auto"), "auto"));
    codes.forEach((c) => sel.add(new Option(LexoLang.name(c), c)));
  }

  // Variantes régionales
  function renderVariants() {
    const box = $("variants");
    box.textContent = "";
    for (const base of Object.keys(LexoLang.VARIANTS)) {
      const label = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = LexoLang.name(base);
      const sel = document.createElement("select");
      LexoLang.VARIANTS[base].forEach((v) => sel.add(new Option(v, v)));
      sel.value = (settings.variants || {})[base] || LexoLang.LT_DEFAULT_VARIANT[base];
      sel.addEventListener("change", () => {
        const variants = Object.assign({}, settings.variants, { [base]: sel.value });
        save({ variants });
      });
      label.append(span, sel);
      box.appendChild(label);
    }
  }

  let savedTimer = 0;
  async function save(patch) {
    Object.assign(settings, patch);
    await LexoSettings.save(patch);
    $("saved").hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $("saved").hidden = true; }, 1400);
  }

  function bindFields() {
    document.querySelectorAll("[data-key]").forEach((el) => {
      const key = el.getAttribute("data-key");
      const num = el.getAttribute("data-type") === "number";
      if (el.getAttribute("data-type") === "bool") {
        el.checked = settings[key] !== false;
        el.addEventListener("change", () => save({ [key]: el.checked }));
        return;
      }
      el.value = settings[key] != null ? settings[key] : "";
      const handler = () => {
        let v = el.value;
        if (num) v = Number(v);
        if (typeof v === "string") v = v.trim();
        if (key === "debounceMs") $("debounceVal").textContent = v + " ms";
        save({ [key]: v });
        if (key === "uiLanguage") { render(); fillAll(); }
      };
      let timer = 0;
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
        if (key === "debounceMs") $("debounceVal").textContent = el.value + " ms";
        clearTimeout(timer);
        timer = setTimeout(handler, el.tagName === "SELECT" ? 0 : 400);
      });
    });
    $("debounceVal").textContent = settings.debounceMs + " ms";
  }

  function fillAll() {
    fillLangs($("language"), true);
    fillLangs($("defaultLanguage"), false);
    $("language").value = settings.language;
    $("defaultLanguage").value = settings.defaultLanguage;
    renderVariants();
    renderLists();
  }

  // Dictionnaire
  const dict = $("dictionary");
  dict.value = (settings.dictionary || []).join("\n");
  let dictTimer = 0;
  dict.addEventListener("input", () => {
    clearTimeout(dictTimer);
    dictTimer = setTimeout(() => {
      const words = Array.from(new Set(dict.value.split(/\n/).map((w) => w.trim()).filter(Boolean)));
      save({ dictionary: words });
    }, 500);
  });

  // Règles et sites désactivés
  function renderList(id, key) {
    const ul = $(id);
    ul.textContent = "";
    const items = settings[key] || [];
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = t("o_none");
      ul.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = item;
      const btn = document.createElement("button");
      btn.textContent = t("o_remove");
      btn.addEventListener("click", async () => {
        await save({ [key]: (settings[key] || []).filter((x) => x !== item) });
        renderLists();
      });
      li.append(span, btn);
      ul.appendChild(li);
    });
  }
  function renderLists() {
    renderList("rules", "disabledRules");
    renderList("sites", "disabledSites");
  }

  // Tests de connexion
  async function runTest(btn, out, type, overrideKeys) {
    out.textContent = "…";
    out.className = "muted";
    btn.disabled = true;
    const override = {};
    overrideKeys.forEach((k) => { override[k] = settings[k]; });
    try {
      const r = await ext.runtime.sendMessage({ type, override });
      if (r && r.ok) { out.textContent = t("o_ok") + " — " + [r.provider && t("o_provider_" + r.provider).split(" (")[0], r.model].filter(Boolean).join(" · "); out.className = "ok"; }
      else { out.textContent = t("o_fail", (r && (r.code || r.status || r.message)) || "?"); out.className = "ko"; }
    } catch (e) {
      out.textContent = t("o_fail", e.message); out.className = "ko";
    } finally {
      btn.disabled = false;
    }
  }
  $("testLt").addEventListener("click", () => runTest($("testLt"), $("testLtRes"), "lexo:test-lt", ["ltServer", "ltUsername", "ltApiKey"]));
  const REPHRASE_KEYS = ["rephraseProvider", "geminiApiKey", "geminiModel", "ollamaUrl", "ollamaModel", "claudeApiKey", "claudeModel", "claudeEffort"];
  $("testRephrase").addEventListener("click", async () => {
    await runTest($("testRephrase"), $("testRephraseRes"), "lexo:test-rephrase", REPHRASE_KEYS);
    refreshStatus();
  });

  // État des fournisseurs (lequel est prêt ?)
  async function refreshStatus() {
    const override = {};
    REPHRASE_KEYS.forEach((k) => { override[k] = settings[k]; });
    let st = {};
    try { st = (await ext.runtime.sendMessage({ type: "lexo:rephrase-status", override })).status || {}; } catch (e) { /* ignore */ }
    const ul = $("providerStatus");
    ul.textContent = "";
    for (const id of ["gemini", "ollama", "chrome", "claude"]) {
      const li = document.createElement("li");
      li.className = st[id] ? "on" : "";
      li.textContent = (st[id] ? "✔ " : "○ ") + t("o_provider_" + id).split(" (")[0];
      li.title = t(st[id] ? "o_ready" : "o_not_ready");
      ul.appendChild(li);
    }
  }
  let statusTimer = 0;
  LexoSettings.onChange((patch) => {
    if (Object.keys(patch).some((k) => REPHRASE_KEYS.includes(k))) {
      clearTimeout(statusTimer);
      statusTimer = setTimeout(refreshStatus, 600);
    }
  });

  // Modèles Ollama installés
  async function loadOllamaModels() {
    const dl = $("ollamaModels");
    try {
      const r = await ext.runtime.sendMessage({ type: "lexo:ollama-models", override: { ollamaUrl: settings.ollamaUrl } });
      dl.textContent = "";
      (r && r.models || []).forEach((m) => dl.appendChild(new Option(m, m)));
      if (r && r.ok && r.models.length && !r.models.some((m) => m.split(":")[0] === String(settings.ollamaModel).split(":")[0])) {
        $("ollamaModel").value = r.models[0];
        save({ ollamaModel: r.models[0] });
      }
    } catch (e) { /* Ollama absent */ }
  }
  $("ollamaRefresh").addEventListener("click", () => { loadOllamaModels(); refreshStatus(); });
  refreshStatus();
  loadOllamaModels();

  $("reset").addEventListener("click", async () => {
    if (!confirm(t("o_reset_confirm"))) return;
    const keep = { stats: (await ext.storage.local.get("stats")).stats };
    await ext.storage.local.clear();
    if (keep.stats) await ext.storage.local.set(keep);
    location.reload();
  });

  // Les changements faits ailleurs (popup, page) se reflètent ici.
  LexoSettings.onChange((patch) => {
    Object.assign(settings, patch);
    if ("disabledRules" in patch || "disabledSites" in patch) renderLists();
    if ("dictionary" in patch && document.activeElement !== dict) dict.value = (settings.dictionary || []).join("\n");
  });

  // Accueil
  if (location.hash === "#welcome") {
    $("welcome").hidden = false;
    try {
      const granted = await ext.permissions.contains({ origins: ["<all_urls>"] });
      if (!granted) {
        $("perm").hidden = false;
        $("grant").addEventListener("click", async () => {
          if (await ext.permissions.request({ origins: ["<all_urls>"] })) $("perm").hidden = true;
        });
      }
    } catch (e) { /* ignore */ }
  }

  render();
  fillAll();
  bindFields();
})();
