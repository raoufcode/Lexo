/*
 * Lexo — logique de la page : suivi du champ actif, vérifications
 * progressives, soulignements, carte de suggestion, panneau.
 */
(function (root) {
  "use strict";

  const { LexoSettings, LexoText, LexoLang, LexoFields, LexoUI, LexoI18n } = root;
  const ext = LexoSettings.ext;
  const T = (k, ...a) => LexoI18n.t(k, ...a);

  const MAX_DRAWN = 300;
  const TYPE_ORDER = ["spelling", "grammar", "typo", "style"];
  const STYLE_CATS = new Set(["STYLE", "REDUNDANCY", "PLAIN_ENGLISH", "REPETITIONS_STYLE", "REPETITIONS", "SEMANTICS", "COLLOQUIALISMS", "GENDER_NEUTRALITY", "WIKIPEDIA", "MISC"]);
  const TYPO_CATS = new Set(["TYPOGRAPHY", "PUNCTUATION", "CASING"]);

  function typeOf(m) {
    const it = String(m.rule && m.rule.issueType || "").toLowerCase();
    const cat = String(m.rule && m.rule.category && m.rule.category.id || "").toUpperCase();
    const id = String(m.rule && m.rule.id || "");
    if (it === "misspelling" || /SPELL|MORFOLOGIK|HUNSPELL/.test(id)) return "spelling";
    if (it === "typographical" || it === "whitespace" || TYPO_CATS.has(cat)) return "typo";
    if (it === "style" || it === "locale-violation" || it === "register" || STYLE_CATS.has(cat)) return "style";
    return "grammar";
  }

  // ===========================================================================
  // Contrôleur d'un champ
  // ===========================================================================
  let FIELD_IDS = 0;

  class FieldController {
    constructor(app, el) {
      this.app = app;
      this.el = el;
      this.id = ++FIELD_IDS;
      this.adapter = LexoFields.createAdapter(el, app.ui.mirrors);
      this.text = "";
      this.matches = [];
      this.rects = [];
      this.seq = 0;
      this.status = "ok";
      this.lang = null;
      this.langSure = false;
      this.forcedLang = null;
      this.checking = false;
      this.hover = -1;
      this.panelHover = -1;
      this.ignored = new Set();
      this.timer = 0;
      this.firstPending = 0;
      this.active = false;
      this.panel = null;
      this.clippers = [];

      this._onInput = () => this.onInput();
      this._onMouseUp = (e) => this.onMouseUp(e);
      this._onKeyUp = () => this.app.layoutSoon();
      el.addEventListener("input", this._onInput, true);
      el.addEventListener("mouseup", this._onMouseUp, true);
      el.addEventListener("keyup", this._onKeyUp, true);
      if (el instanceof HTMLTextAreaElement || el.isContentEditable) {
        el.addEventListener("scroll", () => this.app.layoutSoon(), { passive: true });
      }
      try {
        this.ro = new ResizeObserver(() => this.app.layoutSoon());
        this.ro.observe(el);
      } catch (e) { /* ancien navigateur */ }
    }

    activate() {
      this.active = true;
      this.clippers = clippingAncestors(this.el);
      const t = this.adapter.getText();
      if (t !== this.text || !this.lastChecked) {
        this.matches = LexoText.remapMatches(this.matches, this.text, t);
        this.text = t;
        this.scheduleCheck(true);
      }
      clearInterval(this.poll);
      // Filet de sécurité : détecte les changements faits par script (sans « input »).
      this.poll = setInterval(() => {
        if (!this.el.isConnected) { this.app.drop(this); return; }
        if (this.adapter.getText() !== this.text) this.onInput();
      }, 1000);
      this.layout();
    }

    deactivate() {
      this.active = false;
      clearInterval(this.poll);
      this.hover = -1;
      this.app.ui.clearUnderlines();
      this.app.ui.hideBadge();
      this.app.ui.hideCard();
      this.closePanel();
    }

    destroy() {
      this.deactivate();
      clearTimeout(this.timer);
      this.el.removeEventListener("input", this._onInput, true);
      this.el.removeEventListener("mouseup", this._onMouseUp, true);
      this.el.removeEventListener("keyup", this._onKeyUp, true);
      if (this.ro) this.ro.disconnect();
      this.adapter.destroy();
    }

    // ------------------------------------------------------------ frappe
    onInput() {
      const t = this.adapter.getText();
      if (t === this.text) return;
      this.matches = LexoText.remapMatches(this.matches, this.text, t);
      this.text = t;
      this.app.ui.hideCard();
      this.hover = -1;
      this.app.layoutSoon();
      this.scheduleCheck(false);
      if (this.panel) this.renderPanel();
    }

    scheduleCheck(immediate) {
      clearTimeout(this.timer);
      const now = Date.now();
      if (!this.firstPending) this.firstPending = now;
      const debounce = Math.max(150, Math.min(3000, this.app.settings.debounceMs || 450));
      // Pendant une frappe continue, on vérifie quand même au moins toutes les 2,5 s.
      const wait = immediate ? 0 : Math.min(debounce, Math.max(0, this.firstPending + 2500 - now));
      this.timer = setTimeout(() => this.check(), wait);
    }

    async check() {
      this.firstPending = 0;
      const text = this.adapter.getText();
      this.text = text;
      if (!text.trim()) {
        this.matches = [];
        this.status = "ok";
        this.checking = false;
        this.lastChecked = true;
        this.layout();
        if (this.panel) this.renderPanel();
        return;
      }
      const seq = ++this.seq;
      this.checking = true;
      this.layoutBadge();
      const res = await this.app.send({
        type: "lexo:check", text, fieldId: this.id, seq,
        hint: this.lang, forced: this.forcedLang,
      });
      if (seq !== this.seq || !res || res.stale) return;
      this.checking = false;
      this.lastChecked = true;
      if (res.ok === false) {
        this.status = "error";
        this.layout();
        return;
      }
      const cur = this.adapter.getText();
      let ms = (res.matches || []).map((m) => Object.assign(m, { type: typeOf(m) }));
      if (cur !== text) ms = LexoText.remapMatches(ms, text, cur);
      ms = ms.filter((m) => !this.ignored.has(ignoreKey(m)));
      this.text = cur;
      this.matches = this.mergeAI(ms, cur);
      this.status = res.status || "ok";
      if (res.lang) { this.lang = res.lang; this.langSure = !!res.sure; }
      if (this.status === "rate_limited") {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.check(), 6000);
      }
      this.layout();
      if (this.panel) this.renderPanel();
      this.scheduleAI();
    }

    // ------------------------------------------------------------ IA
    /** Paragraphes contenant des fautes et pas encore relus par l'IA. */
    aiCandidates() {
      const out = [];
      for (const p of LexoText.splitParagraphs(this.text)) {
        if (p.text.trim().length < 6) continue;
        if (this.app.aiCache.has(aiKey(p.text))) continue;
        const end = p.start + p.text.length;
        const faulty = this.matches.some((m) => m.source !== "ai" && m.type !== "style" && m.offset >= p.start && m.offset < end);
        if (faulty) out.push(p);
      }
      return out.slice(0, 6);
    }

    scheduleAI() {
      clearTimeout(this.aiTimer);
      if (!this.app.aiEnabled()) return;
      if (!this.aiCandidates().length) return;
      // Après une vraie pause de frappe, pour économiser le quota gratuit.
      this.aiTimer = setTimeout(() => this.aiCheck(), 1400);
    }

    /** Relecture des paragraphes fautifs par l'IA (comprend les phrases mal tapées). */
    async aiCheck() {
      if (!this.app.aiEnabled() || this.aiBusy) return this.aiBusy;
      const want = this.aiCandidates();
      if (!want.length) return;
      this.aiBusy = (async () => {
        this.layoutBadge();
        const res = await this.app.send({ type: "lexo:ai-fix", paragraphs: want.map((p) => p.text), lang: this.lang });
        if (!res || !res.ok) {
          this.app.aiFailed(res && res.code);
          return;
        }
        want.forEach((p, i) => this.app.aiCacheSet(aiKey(p.text), (res.results[i] && res.results[i].matches) || []));
        const cur = this.adapter.getText();
        this.matches = this.mergeAI(LexoText.remapMatches(this.matches, this.text, cur), cur);
        this.text = cur;
        this.layout();
        if (this.panel) this.renderPanel();
      })().finally(() => { this.aiBusy = null; this.layoutBadge(); });
      return this.aiBusy;
    }

    /** Intègre les corrections de l'IA : elles priment sur celles qu'elles recouvrent. */
    mergeAI(ms, text) {
      let out = ms;
      const disabled = new Set(this.app.settings.disabledRules || []);
      const dict = new Set((this.app.settings.dictionary || []).map((w) => w.toLowerCase()));
      for (const p of LexoText.splitParagraphs(text)) {
        const ai = this.app.aiCache.get(aiKey(p.text));
        if (!ai) continue;
        const start = p.start, end = p.start + p.text.length;
        const abs = ai.map((m) => Object.assign({}, m, {
          offset: m.offset + start,
          context: p.text.substr(m.offset, m.length),
          type: typeOf(m),
        })).filter((m) => !this.ignored.has(ignoreKey(m)) && !disabled.has(m.rule.id) && !dict.has(m.context.toLowerCase()));
        const overlap = (a, b) => a.offset < b.offset + b.length && b.offset < a.offset + a.length;
        out = out.filter((m) => !(m.offset >= start && m.offset < end && (m.source === "ai" || abs.some((a) => overlap(a, m)))));
        out = out.concat(abs);
      }
      return out.sort((a, b) => a.offset - b.offset);
    }

    // ------------------------------------------------------------ rendu
    layout() {
      if (!this.active) return;
      if (!this.el.isConnected) { this.app.drop(this); return; }
      const box = this.adapter.clientBox();
      const clip = intersect(box, this.clippers, this.el);
      const list = this.matches.slice(0, MAX_DRAWN);
      this.rects = this.adapter.rectsFor(list.map((m) => ({ start: m.offset, end: m.offset + m.length })));
      const items = list.map((m, i) => ({
        type: m.type,
        rects: this.rects[i] || [],
        hot: i === this.hover || i === this.panelHover,
      }));
      if (clip.width > 0 && clip.height > 0) this.app.ui.drawUnderlines(clip, items, this.app.settings.underlineStyle);
      else this.app.ui.clearUnderlines();
      this.layoutBadge(box, clip);
    }

    layoutBadge(box, clip) {
      if (!this.active) return;
      const s = this.app.settings;
      if (!s.showBadge && !this.panel) { this.app.ui.hideBadge(); return; }
      box = box || this.adapter.clientBox();
      clip = clip || intersect(box, this.clippers, this.el);
      if (clip.width <= 0 || clip.height <= 0) { this.app.ui.hideBadge(); return; }
      const count = this.matches.length;
      let worst = null;
      for (const t of TYPE_ORDER) if (this.matches.some((m) => m.type === t)) { worst = t; break; }
      const langLabel = this.lang ? this.lang.toUpperCase() : "";
      let state;
      if (this.status === "offline") state = T("badgeOffline");
      else state = count ? T("badgeIssues", count) : T("badgeOk");
      this.app.ui.showBadge({
        left: clip.left, top: clip.top, right: clip.left + clip.width, bottom: clip.top + clip.height,
        height: box.height,
      }, {
        count, worst, status: this.status, checking: this.checking || !!this.aiBusy,
        empty: !this.text.trim(), langLabel, forceShow: !!this.panel,
        title: T("badgeTitle", (this.lang ? LexoLang.name(this.lang) + " · " : "") + state),
      }, () => this.togglePanel());
    }

    hitTest(x, y) {
      const list = this.rects;
      for (let i = 0; i < list.length; i++) {
        for (const r of list[i]) {
          if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 3) return i;
        }
      }
      return -1;
    }

    // ------------------------------------------------------------ survol
    onPointer(x, y) {
      const i = this.hitTest(x, y);
      if (i === this.hover) return;
      this.hover = i;
      this.layout();
      clearTimeout(this.hoverTimer);
      // Carte ouverte par un clic : elle reste affichée jusqu'à un clic ailleurs.
      if (this.cardPinned && this.app.ui.cardVisible()) return;
      if (i >= 0) {
        clearTimeout(this.hideTimer);
        this.hoverTimer = setTimeout(() => this.showCard(i), this.app.ui.cardVisible() ? 60 : 260);
      } else {
        this.scheduleHideCard();
      }
    }

    onMouseUp(e) {
      if (e.button !== 0) return;
      const i = this.hitTest(e.clientX, e.clientY);
      if (i >= 0) {
        // Ne pas gêner une sélection à la souris.
        const sel = this.adapter.getSelection();
        if (sel && sel.end - sel.start > 0) return;
        clearTimeout(this.hoverTimer);
        this.showCard(i, true);
      }
    }

    scheduleHideCard() {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        if (!this.inCard && !(this.cardPinned && this.app.ui.cardVisible())) this.app.ui.hideCard();
      }, 320);
    }

    showCard(i, pinned) {
      const m = this.matches[i];
      const rects = this.rects[i];
      if (!m || !rects || !rects.length) return;
      this.cardPinned = !!pinned;
      const r = rects[rects.length - 1];
      this.inCard = false;
      this.app.ui.showCard(r, m, {
        apply: (ri) => this.apply(m, ri),
        ignore: () => this.ignore(m),
        dict: () => this.addToDictionary(m),
        rule: () => this.disableRule(m),
        enter: () => { this.inCard = true; clearTimeout(this.hideTimer); },
        leave: () => { this.inCard = false; this.scheduleHideCard(); },
      });
    }

    // ------------------------------------------------------------ actions
    apply(m, ri) {
      const r = m.replacements && m.replacements[ri];
      if (!r) return false;
      const cur = this.adapter.getText();
      if (cur.substr(m.offset, m.length) !== m.context) { this.onInput(); return false; }
      const ok = this.adapter.replace(m.offset, m.offset + m.length, r.value);
      this.onInput();
      if (ok) this.app.stat("fixes");
      return ok;
    }

    async applyAll() {
      // Avant de tout corriger, on laisse l'IA relire les phrases fautives :
      // c'est elle qui comprend « co,stete » -> « constate ».
      if (this.app.aiEnabled() && (this.aiCandidates().length || this.aiBusy)) {
        clearTimeout(this.aiTimer);
        try { await Promise.race([this.aiBusy || this.aiCheck(), new Promise((r) => setTimeout(r, 12000))]); } catch (e) { /* on continue sans IA */ }
      }
      const list = this.matches
        .filter((m) => m.replacements && m.replacements.length)
        .sort((a, b) => b.offset - a.offset);
      let n = 0;
      let lastStart = Infinity;
      for (const m of list) {
        if (m.offset + m.length > lastStart) continue; // chevauchement
        const cur = this.adapter.getText();
        if (cur.substr(m.offset, m.length) !== m.context) continue;
        if (this.adapter.replace(m.offset, m.offset + m.length, m.replacements[0].value)) {
          n++;
          lastStart = m.offset;
        }
      }
      this.onInput();
      if (n) {
        this.app.stat("fixes", n);
        this.app.ui.toast(T("fixedN", n), this.app.ui.badgeRect() || this.adapter.clientBox());
      }
    }

    ignore(m) {
      this.ignored.add(ignoreKey(m));
      this.matches = this.matches.filter((x) => !this.ignored.has(ignoreKey(x)));
      this.layout();
      if (this.panel) this.renderPanel();
    }

    async addToDictionary(m) {
      const word = m.context;
      const dict = (this.app.settings.dictionary || []).slice();
      if (!dict.some((w) => w.toLowerCase() === word.toLowerCase())) dict.push(word);
      this.matches = this.matches.filter((x) => !(x.type === "spelling" && x.context.toLowerCase() === word.toLowerCase()));
      this.layout();
      this.app.ui.toast(T("addedToDict", word), this.app.ui.badgeRect() || this.adapter.clientBox());
      await this.app.saveSettings({ dictionary: dict });
    }

    async disableRule(m) {
      const id = m.rule && m.rule.id;
      if (!id) return;
      const rules = (this.app.settings.disabledRules || []).slice();
      if (!rules.includes(id)) rules.push(id);
      this.matches = this.matches.filter((x) => x.rule.id !== id);
      this.layout();
      this.app.ui.toast(T("ruleDisabled"), this.app.ui.badgeRect() || this.adapter.clientBox());
      await this.app.saveSettings({ disabledRules: rules });
    }

    setLanguage(code) {
      this.forcedLang = code === "auto" ? null : code;
      if (this.forcedLang) this.lang = this.forcedLang;
      this.matches = [];
      this.layout();
      this.scheduleCheck(true);
    }

    // ------------------------------------------------------------ panneau
    togglePanel(tab) {
      if (this.panel && !tab) { this.closePanel(); return; }
      this.openPanel(tab || "fix");
    }

    openPanel(tab, autoRephrase) {
      this.app.ui.hideCard();
      const source = this.rephraseSource();
      this.panel = {
        tab: tab || "fix",
        langMenu: false,
        rephrase: { state: "idle", tone: this.app.lastTone || "neutral", source: source.kind },
        source,
      };
      this.layoutBadge();
      const anchor = this.app.ui.badgeRect() || cornerOf(this.adapter.clientBox());
      this.app.ui.openPanel(anchor, this.panelModel(), this.panelHandlers());
      if (autoRephrase) this.runRephrase();
    }

    closePanel() {
      if (!this.panel) return;
      this.panel = null;
      this.panelHover = -1;
      this.app.ui.closePanel();
      if (this.active) this.layout();
    }

    renderPanel() {
      if (!this.panel) return;
      this.app.ui.renderPanel(this.panelModel());
    }

    /** Texte à reformuler : la sélection, sinon le paragraphe du curseur. */
    rephraseSource() {
      const text = this.adapter.getText();
      const sel = this.adapter.getSelection();
      if (sel && sel.end > sel.start && text.slice(sel.start, sel.end).trim()) {
        return { kind: "selection", start: sel.start, end: sel.end, text: text.slice(sel.start, sel.end) };
      }
      const paras = LexoText.splitParagraphs(text, 1e9);
      if (paras.length > 1 && sel) {
        const p = paras.find((q) => sel.start >= q.start && sel.start <= q.start + q.text.length) || paras[paras.length - 1];
        return { kind: "paragraph", start: p.start, end: p.start + p.text.length, text: p.text };
      }
      return { kind: "all", start: 0, end: text.length, text };
    }

    panelModel() {
      const p = this.panel;
      return {
        tab: p.tab,
        langMenu: p.langMenu,
        lang: this.lang,
        langForced: !!this.forcedLang,
        status: this.status,
        checking: this.checking,
        matches: this.matches,
        text: this.text,
        empty: !this.text.trim(),
        readonly: false,
        rephrase: Object.assign({}, p.rephrase, { source: p.source.kind === "selection" ? "selection" : p.source.kind }),
        rephraseText: p.source.text,
      };
    }

    panelHandlers() {
      return {
        close: () => this.closePanel(),
        tab: (v) => { this.panel.tab = v; if (v === "rephrase") this.panel.source = this.panel.source.text ? this.panel.source : this.rephraseSource(); this.renderPanel(); },
        apply: (i) => { const m = this.matches[i]; if (m) this.apply(m, 0); this.renderPanel(); },
        ignore: (i) => { const m = this.matches[i]; if (m) this.ignore(m); },
        applyAll: async () => { await this.applyAll(); this.renderPanel(); },
        hover: (i) => { if (i !== this.panelHover) { this.panelHover = i; this.layout(); } },
        langMenu: (open) => { this.panel.langMenu = open; this.renderPanel(); },
        lang: (v) => { this.panel.langMenu = false; this.setLanguage(v); this.renderPanel(); },
        tone: (v) => { this.panel.rephrase.tone = v; this.app.lastTone = v; if (this.panel.rephrase.state === "done") this.runRephrase(); else this.renderPanel(); },
        rephrase: () => this.runRephrase(),
        use: (txt) => this.useRephrase(txt),
        copy: (txt) => this.app.copy(txt),
        disableSite: () => this.app.disableSite(),
        options: () => this.app.send({ type: "lexo:open-options" }),
      };
    }

    async runRephrase() {
      const p = this.panel;
      if (!p) return;
      if (!p.source || !p.source.text.trim()) p.source = this.rephraseSource();
      p.tab = "rephrase";
      p.rephrase.state = "loading";
      this.renderPanel();
      const ticket = (p.ticket = (p.ticket || 0) + 1);
      const res = await this.app.send({ type: "lexo:rephrase", text: p.source.text, tone: p.rephrase.tone, lang: this.lang });
      if (this.panel !== p || p.ticket !== ticket) return;
      if (res && res.ok) {
        p.rephrase.state = "done";
        p.rephrase.result = res.result;
      } else if (res && res.code === "no_provider") {
        // Aucun fournisseur d'IA : on propose au moins la version corrigée.
        p.rephrase.state = "done";
        p.rephrase.result = this.localCorrection(p.source);
      } else {
        p.rephrase.state = "error";
        p.rephrase.code = knownError(res && res.code);
        p.rephrase.message = res && res.message;
      }
      this.renderPanel();
    }

    /** Version corrigée calculée sans IA, à partir des corrections détectées. */
    localCorrection(src) {
      let out = src.text;
      const inside = this.matches
        .filter((m) => m.replacements && m.replacements.length && m.offset >= src.start && m.offset + m.length <= src.end)
        .sort((a, b) => b.offset - a.offset);
      let last = Infinity;
      for (const m of inside) {
        if (m.offset + m.length > last) continue;
        const o = m.offset - src.start;
        out = out.slice(0, o) + m.replacements[0].value + out.slice(o + m.length);
        last = m.offset;
      }
      return { corrected: out, explanation: "", suggestions: [], local: true, provider: "local" };
    }

    useRephrase(txt) {
      const p = this.panel;
      if (!p) return;
      const src = p.source;
      const cur = this.adapter.getText();
      let start = src.start, end = src.end;
      if (cur.slice(start, end) !== src.text) {
        const idx = cur.indexOf(src.text);
        if (idx < 0) { this.app.ui.toast(T("rephraseError_parse")); return; }
        start = idx; end = idx + src.text.length;
      }
      // Garde les espaces de début/fin d'origine.
      const lead = src.text.match(/^\s*/)[0];
      const trail = src.text.match(/\s*$/)[0];
      const value = lead + txt.trim() + trail;
      if (this.adapter.replace(start, end, value)) {
        this.app.stat("rephrases");
        p.source = { kind: src.kind, start, end: start + value.length, text: value };
        p.rephrase.state = "idle";
        p.tab = "fix";
      }
      this.onInput();
      this.renderPanel();
    }
  }

  function knownError(code) {
    const known = ["empty", "too_long", "no_key", "no_provider", "unavailable", "ollama_origin", "ollama_model", "auth", "rate_limited", "bad_request", "offline", "api", "refusal", "parse", "sdk_missing", "internal", "context"];
    return known.includes(code) ? code : "api";
  }

  function aiKey(text) { return LexoText.hash(text) + ":" + text.length; }

  function ignoreKey(m) { return (m.rule && m.rule.id) + "|" + m.context; }

  function cornerOf(box) {
    return { left: box.right - 20, right: box.right, top: box.bottom - 20, bottom: box.bottom };
  }

  /** Ancêtres qui rognent leur contenu (zones défilantes). */
  function clippingAncestors(el) {
    const out = [];
    let n = el.parentElement;
    let depth = 0;
    while (n && n !== document.documentElement && depth < 25) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) out.push(n);
      n = n.parentElement;
      depth++;
    }
    return out;
  }

  function intersect(box, clippers, el) {
    let l = Math.max(0, box.left), t = Math.max(0, box.top);
    let r = Math.min(window.innerWidth, box.right), b = Math.min(window.innerHeight, box.bottom);
    for (const c of clippers) {
      if (!c.isConnected) continue;
      const q = c.getBoundingClientRect();
      l = Math.max(l, q.left); t = Math.max(t, q.top);
      r = Math.min(r, q.right); b = Math.min(b, q.bottom);
    }
    return { left: l, top: t, width: Math.max(0, r - l), height: Math.max(0, b - t) };
  }

  // ===========================================================================
  // Session en lecture seule (texte sélectionné hors champ éditable)
  // ===========================================================================
  class ReadonlySession {
    constructor(app, text, anchor) {
      this.app = app;
      this.text = text;
      this.anchor = anchor;
      this.state = { state: "idle", tone: app.lastTone || "neutral" };
      this.lang = LexoLang.guess(text).lang || app.settings.defaultLanguage;
    }
    model() {
      return {
        tab: "rephrase", readonly: true, lang: this.lang, langForced: false, status: "ok",
        matches: [], text: this.text,
        rephrase: Object.assign({ source: "selection" }, this.state), rephraseText: this.text,
      };
    }
    open() {
      this.app.ui.openPanel(this.anchor, this.model(), {
        close: () => this.close(),
        tab: () => {}, apply: () => {}, ignore: () => {}, applyAll: () => {}, hover: () => {},
        langMenu: () => {}, lang: () => {},
        tone: (v) => { this.state.tone = v; this.app.lastTone = v; if (this.state.state === "done") this.run(); else this.render(); },
        rephrase: () => this.run(),
        use: () => {},
        copy: (txt) => this.app.copy(txt),
        disableSite: () => {},
        options: () => this.app.send({ type: "lexo:open-options" }),
      });
      this.run();
    }
    render() { this.app.ui.renderPanel(this.model()); }
    async run() {
      this.state.state = "loading";
      this.render();
      const res = await this.app.send({ type: "lexo:rephrase", text: this.text, tone: this.state.tone, lang: this.lang });
      if (this.app.readonly !== this) return;
      if (res && res.ok) { this.state.state = "done"; this.state.result = res.result; }
      else if (res && res.code === "no_provider") { this.state.state = "done"; this.state.result = { corrected: this.text, explanation: "", suggestions: [], local: true }; }
      else { this.state.state = "error"; this.state.code = knownError(res && res.code); }
      this.render();
    }
    close() { this.app.ui.closePanel(); this.app.readonly = null; }
  }

  // ===========================================================================
  // Application
  // ===========================================================================
  class App {
    constructor() {
      this.ui = null;
      this.settings = Object.assign({}, LexoSettings.DEFAULTS);
      this.controllers = new Map();
      this.active = null;
      this.readonly = null;
      this.aiCache = new Map();
      this.aiBlockedUntil = 0;
      this.alive = true;
      this.frame = 0;
      this.pointer = null;
    }

    async start() {
      this.settings = await LexoSettings.load();
      LexoI18n.setLang(this.settings.uiLanguage);
      LexoSettings.onChange((patch) => this.onSettings(patch));

      const opts = { capture: true, passive: true };
      this.listeners = [
        [document, "focusin", (e) => this.onFocusIn(e), true],
        [document, "focusout", (e) => this.onFocusOut(e), true],
        [document, "mousemove", (e) => this.onMouseMove(e), opts],
        [document, "mousedown", (e) => this.onMouseDown(e), true],
        [document, "keydown", (e) => this.onKeyDown(e), true],
        [window, "scroll", () => this.layoutSoon(), opts],
        [window, "resize", () => this.layoutSoon(), opts],
      ];
      for (const [t, n, f, o] of this.listeners) t.addEventListener(n, f, o);

      try {
        this._onMessage = (msg) => { this.onMessage(msg); };
        ext.runtime.onMessage.addListener(this._onMessage);
      } catch (e) { /* ignore */ }

      // Champ déjà actif au chargement (autofocus)
      const a = deepActive();
      if (a) this.tryActivate(a);
    }

    get enabledHere() {
      const s = this.settings;
      return s.enabled && !(s.disabledSites || []).includes(location.hostname);
    }

    ensureUI() {
      if (!this.ui) this.ui = new LexoUI();
      return this.ui;
    }

    /** La correction par IA est-elle utilisable maintenant ? */
    aiEnabled() {
      return this.settings.aiCorrection !== false && Date.now() >= this.aiBlockedUntil;
    }

    aiFailed(code) {
      // Aucun service configuré : on n'insiste pas avant un changement de réglages.
      const wait = code === "no_provider" ? 10 * 60000 : code === "rate_limited" ? 60000 : 20000;
      this.aiBlockedUntil = Date.now() + wait;
    }

    aiCacheSet(key, matches) {
      this.aiCache.set(key, matches);
      if (this.aiCache.size > 300) this.aiCache.delete(this.aiCache.keys().next().value);
    }

    onSettings(patch) {
      Object.assign(this.settings, patch);
      const aiKeys = ["aiCorrection", "rephraseProvider", "geminiApiKey", "geminiModel", "ollamaUrl", "ollamaModel", "claudeApiKey", "claudeModel"];
      if (Object.keys(patch).some((k) => aiKeys.includes(k))) { this.aiBlockedUntil = 0; this.aiCache.clear(); }
      if ("uiLanguage" in patch) LexoI18n.setLang(this.settings.uiLanguage);
      if (!this.enabledHere) { this.teardown(); return; }
      const recheck = ["dictionary", "disabledRules", "level", "language", "defaultLanguage", "variants", "ltServer", "ltApiKey", "ltUsername"];
      if (Object.keys(patch).some((k) => recheck.includes(k)) && this.active) {
        this.active.scheduleCheck(true);
      }
      if (this.active) {
        this.active.layout();
        if (this.active.panel) this.active.renderPanel();
      } else {
        const a = deepActive();
        if (a) this.tryActivate(a);
      }
    }

    tryActivate(target) {
      if (!this.alive || !this.enabledHere) return;
      const el = LexoFields.resolveEditable(target);
      if (!el || !LexoFields.isVisibleEnough(el)) return;
      this.ensureUI();
      let c = this.controllers.get(el);
      if (!c) {
        c = new FieldController(this, el);
        this.controllers.set(el, c);
        this.gc();
      }
      if (this.active && this.active !== c) this.active.deactivate();
      if (this.readonly) this.readonly.close();
      this.active = c;
      c.activate();
    }

    /** Libère les contrôleurs de champs retirés de la page (applications web). */
    gc() {
      if (this.controllers.size < 20) return;
      for (const [el, c] of this.controllers) {
        if (!el.isConnected && c !== this.active) { c.destroy(); this.controllers.delete(el); }
      }
    }

    drop(c) {
      c.destroy();
      this.controllers.delete(c.el);
      if (this.active === c) this.active = null;
    }

    onFocusIn(e) {
      if (this.ui && this.ui.owns(e)) return;
      this.tryActivate(LexoFields.deepTarget(e));
    }

    onFocusOut(e) {
      if (!this.active) return;
      const c = this.active;
      setTimeout(() => {
        if (this.active !== c) return;
        const a = deepActive();
        if (a && (a === c.el || c.el.contains(a))) return;
        if (c.panel) return; // le panneau reste ouvert jusqu'à sa fermeture
        c.deactivate();
        this.active = null;
      }, 150);
    }

    onMouseMove(e) {
      if (!this.active || !this.active.matches.length) return;
      this.pointer = { x: e.clientX, y: e.clientY };
      if (this._pm) return;
      this._pm = requestAnimationFrame(() => {
        this._pm = 0;
        if (this.active && this.pointer && !(this.ui && this.ui.owns(e))) this.active.onPointer(this.pointer.x, this.pointer.y);
      });
    }

    onMouseDown(e) {
      if (!this.ui) return;
      if (this.ui.owns(e)) return;
      const t = LexoFields.deepTarget(e);
      if (this.readonly) this.readonly.close();
      if (this.active && this.active.panel && !(t === this.active.el || this.active.el.contains(t))) {
        this.active.closePanel();
        const a = deepActive();
        if (!a || !(a === this.active.el || this.active.el.contains(a))) {
          setTimeout(() => this.onFocusOut(e), 0);
        }
      }
      if (this.ui.cardVisible() && this.active && this.active.hitTest(e.clientX, e.clientY) < 0) this.ui.hideCard();
    }

    onKeyDown(e) {
      if (!this.ui) return;
      if (e.key === "Escape") {
        if (this.ui.cardVisible()) { this.ui.hideCard(); e.stopPropagation(); return; }
        if (this.active && this.active.panel) { this.active.closePanel(); e.stopPropagation(); return; }
        if (this.readonly) { this.readonly.close(); e.stopPropagation(); }
        return;
      }
      // Raccourcis de secours (au cas où ceux du navigateur ne sont pas attribués)
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && this.active) {
        if (e.code === "KeyL") { e.preventDefault(); this.active.togglePanel(); }
        else if (e.code === "KeyR") { e.preventDefault(); this.active.openPanel("rephrase", true); }
      }
    }

    onMessage(msg) {
      if (!msg || !this.alive) return;
      if (msg.type === "lexo:open-panel") {
        if (this.active) this.active.togglePanel("fix");
        else { const a = deepActive(); if (a) this.tryActivate(a); if (this.active) this.active.openPanel("fix"); }
      } else if (msg.type === "lexo:rephrase-selection") {
        if (!this.active) { const a = deepActive(); if (a) this.tryActivate(a); }
        if (this.active) { this.active.openPanel("rephrase", true); return; }
        const sel = window.getSelection();
        const text = (msg.text || (sel && sel.toString()) || "").trim();
        if (!text || window.top !== window && !sel.toString()) return;
        this.ensureUI();
        let anchor = { left: 20, right: 380, top: 20, bottom: 40 };
        try { if (sel.rangeCount) { const r = sel.getRangeAt(0).getBoundingClientRect(); anchor = r; } } catch (e) { /* ignore */ }
        this.readonly = new ReadonlySession(this, text, anchor);
        this.readonly.open();
      }
    }

    layoutSoon() {
      if (this.frame || !this.active) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.active) this.active.layout();
        if (this.ui) this.ui.reposition();
      });
    }

    async send(msg) {
      try {
        if (!ext.runtime || !ext.runtime.id) throw new Error("Extension context invalidated");
        const res = await ext.runtime.sendMessage(msg);
        return res;
      } catch (e) {
        if (/context invalidated|Extension context|receiving end/i.test(String(e && e.message))) {
          if (/context invalidated|Extension context/i.test(String(e.message))) this.shutdown();
          return { ok: false, code: "context" };
        }
        return { ok: false, code: "internal", message: String(e && e.message || e) };
      }
    }

    stat(key, n) { this.send({ type: "lexo:stat", key, n: n || 1 }); }

    async saveSettings(patch) {
      Object.assign(this.settings, patch);
      try { await LexoSettings.save(patch); } catch (e) { this.shutdown(); }
    }

    async copy(text) {
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
      if (this.ui) this.ui.toast(ok ? T("copied") : text.slice(0, 40) + "…", this.ui.badgeRect());
    }

    async disableSite() {
      const host = location.hostname;
      const list = (this.settings.disabledSites || []).slice();
      if (!list.includes(host)) list.push(host);
      if (this.ui) this.ui.toast(T("siteDisabled", host));
      await this.saveSettings({ disabledSites: list });
      this.teardown();
    }

    teardown() {
      for (const c of this.controllers.values()) c.destroy();
      this.controllers.clear();
      this.active = null;
      if (this.readonly) this.readonly.close();
      if (this.ui) { this.ui.destroy(); this.ui = null; }
    }

    /** Extension mise à jour ou désinstallée : on se retire proprement. */
    shutdown() {
      if (!this.alive) return;
      this.alive = false;
      this.teardown();
      for (const [t, n, f, o] of this.listeners || []) t.removeEventListener(n, f, o);
    }
  }

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a && a !== document.body ? a : (document.body && document.body.isContentEditable ? document.body : null);
  }

  root.LexoApp = { App, FieldController, typeOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
