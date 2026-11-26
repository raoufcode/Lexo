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
      if (r && r.ok) { out.textContent = t("o_ok") + (r.model ? " — " + r.model : ""); out.className = "ok"; }
      else { out.textContent = t("o_fail", (r && (r.code || r.status || r.message)) || "?"); out.className = "ko"; }
    } catch (e) {
      out.textContent = t("o_fail", e.message); out.className = "ko";
    } finally {
      btn.disabled = false;
    }
  }
  $("testLt").addEventListener("click", () => runTest($("testLt"), $("testLtRes"), "lexo:test-lt", ["ltServer", "ltUsername", "ltApiKey"]));
  $("testClaude").addEventListener("click", () => runTest($("testClaude"), $("testClaudeRes"), "lexo:test-claude", ["claudeApiKey", "claudeModel", "claudeEffort"]));

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
