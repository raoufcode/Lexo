/* Lexo — fenêtre de l'icône de la barre d'outils. */
(async function () {
  "use strict";
  const { LexoSettings, LexoI18n, LexoLang } = window;
  const ext = LexoSettings.ext;
  const $ = (id) => document.getElementById(id);

  const settings = await LexoSettings.load();
  LexoI18n.setLang(settings.uiLanguage);
  LexoI18n.apply(document);

  // Onglet courant
  let host = "";
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (/^https?:$|^file:$/.test(url.protocol)) host = url.hostname;
  } catch (e) { /* onglet interne */ }

  // Interrupteur général
  $("enabled").checked = settings.enabled;
  document.body.classList.toggle("off", !settings.enabled);
  $("enabled").addEventListener("change", async (e) => {
    await LexoSettings.save({ enabled: e.target.checked });
    document.body.classList.toggle("off", !e.target.checked);
  });

  // Site courant
  if (host) {
    $("host").textContent = host;
    $("site").checked = !(settings.disabledSites || []).includes(host);
    $("site").addEventListener("change", async (e) => {
      const s = await LexoSettings.load();
      const list = (s.disabledSites || []).filter((h) => h !== host);
      if (!e.target.checked) list.push(host);
      await LexoSettings.save({ disabledSites: list });
    });
  } else {
    $("site").disabled = true;
    $("internal").hidden = false;
  }

  // Langue
  const sel = $("language");
  const add = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; sel.appendChild(o); };
  add("auto", "✨ " + LexoI18n.t("p_auto"));
  const codes = LexoLang.MAIN_LANGS.concat(LexoLang.allCodes().filter((c) => !LexoLang.MAIN_LANGS.includes(c)));
  codes.forEach((c) => add(c, LexoLang.name(c)));
  sel.value = settings.language || "auto";
  sel.addEventListener("change", () => LexoSettings.save({ language: sel.value }));

  // Statistiques
  const { stats = {} } = await ext.storage.local.get("stats");
  $("fixes").textContent = String((stats.fixes || 0) + (stats.rephrases || 0));

  $("options").addEventListener("click", () => { ext.runtime.openOptionsPage(); window.close(); });

  // Firefox : les autorisations d'accès aux sites peuvent devoir être accordées.
  try {
    const granted = await ext.permissions.contains({ origins: ["<all_urls>"] });
    if (!granted) {
      $("perm").hidden = false;
      $("grant").addEventListener("click", async () => {
        const ok = await ext.permissions.request({ origins: ["<all_urls>"] });
        if (ok) $("perm").hidden = true;
      });
    }
  } catch (e) { /* API indisponible */ }
})();
