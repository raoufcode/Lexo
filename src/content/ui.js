/*
 * Lexo — interface injectée dans la page (Shadow DOM fermé : aucun conflit
 * de styles avec le site, et le site ne peut pas modifier l'interface).
 *   - calque de soulignements
 *   - badge du champ actif
 *   - carte de suggestion
 *   - panneau (corrections, reformulations, langue)
 */
(function (root) {
  "use strict";

  const { LexoText, LexoLang, LexoI18n } = root;
  const esc = LexoText.escapeHtml;
  const T = (k, ...a) => LexoI18n.t(k, ...a);

  const WAVE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2.2 Q1.5 0 3 1.5 T6 0.8' fill='none' stroke='%23000' stroke-width='1.25'/%3E%3C/svg%3E\")";

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .root {
    position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--fg);
    --accent: #6246ea; --accent-fg: #fff; --accent-soft: rgba(98,70,234,.10);
    --bg: #ffffff; --bg2: #f6f5fb; --fg: #1d1b2e; --muted: #6b6880; --border: rgba(20,16,50,.12);
    --spelling: #e5484d; --grammar: #e8890c; --style: #3e7bfa; --typo: #8e4ec6; --ok: #2f9e6b;
    --shadow: 0 10px 30px rgba(20,16,50,.18), 0 2px 6px rgba(20,16,50,.10);
  }
  @media (prefers-color-scheme: dark) {
    .root { --bg: #1f1d2b; --bg2: #2a2839; --fg: #ecebf5; --muted: #a7a5b9; --border: rgba(255,255,255,.12);
      --accent: #8b74ff; --accent-soft: rgba(139,116,255,.16); --shadow: 0 10px 30px rgba(0,0,0,.5); }
  }
  .t-spelling { color: var(--spelling); } .t-grammar { color: var(--grammar); }
  .t-style { color: var(--style); } .t-typo { color: var(--typo); }

  /* ---- soulignements ---- */
  .clip { position: fixed; overflow: hidden; pointer-events: none; contain: strict; }
  .u { position: absolute; height: 3px; pointer-events: none; background: currentColor;
       -webkit-mask: ${WAVE} repeat-x 0 0 / 6px 3px; mask: ${WAVE} repeat-x 0 0 / 6px 3px; }
  .solid .u { -webkit-mask: none; mask: none; height: 2px; border-radius: 1px; }
  .dotted .u { -webkit-mask: radial-gradient(circle, #000 1px, transparent 1.3px) repeat-x 0 0 / 4px 3px;
               mask: radial-gradient(circle, #000 1px, transparent 1.3px) repeat-x 0 0 / 4px 3px; }
  .hl { position: absolute; background: currentColor; opacity: 0; border-radius: 3px; transition: opacity .12s; pointer-events: none; }
  .hl.on { opacity: .16; }

  /* ---- badge ---- */
  .badge { position: fixed; pointer-events: auto; cursor: pointer; display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 11px; border: 0; padding: 0; background: var(--accent); color: #fff;
    font: 600 11px/1 system-ui, sans-serif; box-shadow: 0 1px 4px rgba(20,16,50,.25); transition: transform .15s, opacity .2s;
    opacity: .92; user-select: none; }
  .badge:hover { transform: scale(1.12); opacity: 1; }
  .badge.small { width: 18px; height: 18px; border-radius: 9px; font-size: 10px; }
  .badge.ok { background: var(--ok); }
  .badge.spelling { background: var(--spelling); } .badge.grammar { background: var(--grammar); }
  .badge.style { background: var(--style); } .badge.typo { background: var(--typo); }
  .badge.idle { background: var(--muted); opacity: .55; }
  .badge.warn { background: #b7791f; }
  .badge svg { width: 12px; height: 12px; }
  .badge .lang { position: absolute; bottom: -6px; right: -8px; font-size: 8px; padding: 1px 3px; border-radius: 4px; background: var(--bg); color: var(--fg); box-shadow: 0 0 0 1px var(--border); }
  .badge.busy::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ---- carte & panneau ---- */
  .card, .panel { position: fixed; pointer-events: auto; background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    border-radius: 12px; box-shadow: var(--shadow); animation: pop .12s ease-out; }
  @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.98); } to { opacity: 1; transform: none; } }
  .card { width: max-content; min-width: 220px; max-width: 340px; padding: 10px 12px 10px; }
  .head { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 4px; background: currentColor; flex: none; }
  .grow { flex: 1; }
  .msg { margin: 6px 0 8px; font-size: 13px; }
  .repls { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font: inherit; color: inherit; }
  .chip { border: 0; cursor: pointer; padding: 5px 10px; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 600; font-size: 13px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
  .chip:hover { filter: brightness(1.08); }
  .chip.alt { background: var(--accent-soft); color: var(--accent); }
  .chip.del { text-decoration: line-through; }
  .actions { display: flex; gap: 2px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); flex-wrap: wrap; }
  .link { border: 0; background: none; cursor: pointer; padding: 4px 6px; border-radius: 6px; color: var(--muted); font-size: 12px; }
  .link:hover { background: var(--bg2); color: var(--fg); }
  .x { border: 0; background: none; cursor: pointer; width: 22px; height: 22px; border-radius: 6px; color: var(--muted); font-size: 16px; line-height: 1; }
  .x:hover { background: var(--bg2); color: var(--fg); }

  .panel { width: 380px; max-width: calc(100vw - 16px); max-height: min(560px, calc(100vh - 16px)); display: flex; flex-direction: column; overflow: hidden; }
  .ph { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .logo { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, #6246ea, #a855f7); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; flex: none; }
  .title { font-weight: 700; font-size: 14px; }
  .pill { border: 1px solid var(--border); background: var(--bg2); border-radius: 999px; padding: 3px 9px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .pill:hover { border-color: var(--accent); }
  .tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
  .tab { border: 0; background: none; cursor: pointer; padding: 6px 10px; border-radius: 8px 8px 0 0; color: var(--muted); font-weight: 600; border-bottom: 2px solid transparent; }
  .tab.on { color: var(--accent); border-bottom-color: var(--accent); }
  .pb { overflow: auto; padding: 8px 12px 12px; flex: 1; }
  .pf { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--bg2); }
  .item { display: flex; gap: 8px; padding: 8px; border-radius: 8px; cursor: default; }
  .item:hover { background: var(--bg2); }
  .item .dot { margin-top: 6px; }
  .snip { font-size: 13px; word-break: break-word; }
  .snip mark { background: none; color: inherit; text-decoration: line-through; text-decoration-color: currentColor; opacity: .75; }
  .snip .arrow { color: var(--muted); margin: 0 4px; }
  .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .empty { text-align: center; padding: 22px 8px; color: var(--muted); }
  .empty .big { font-size: 28px; }
  .primary { border: 0; cursor: pointer; padding: 7px 12px; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 600; }
  .primary:disabled { opacity: .5; cursor: default; }
  .tones { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
  .tone { border: 1px solid var(--border); background: var(--bg); border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .tone.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .note { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .res { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
  .res .lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); margin-bottom: 4px; }
  .res .txt { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
  .res .row { display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end; }
  .sk { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--bg2), var(--border), var(--bg2)); background-size: 200% 100%; animation: sh 1.2s infinite; margin: 8px 0; }
  @keyframes sh { to { background-position: -200% 0; } }
  .err { color: var(--spelling); font-size: 13px; padding: 8px 0; }
  .menu { position: absolute; top: 44px; right: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); padding: 4px; max-height: 300px; overflow: auto; z-index: 2; min-width: 180px; }
  .mi { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .mi:hover, .mi.on { background: var(--accent-soft); color: var(--accent); }
  .status { font-size: 12px; color: var(--muted); padding: 4px 0 6px; }
  .status.warn { color: #b7791f; }
  .toast { position: fixed; pointer-events: none; background: var(--fg); color: var(--bg); padding: 6px 10px; border-radius: 8px; font-size: 12px; animation: pop .12s ease-out; }
  `;

  const ICON_CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>';
  const ICON_WARN = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5l7 13H1z" opacity=".25"/><rect x="7" y="5" width="2" height="5" rx="1"/><rect x="7" y="11.2" width="2" height="2" rx="1"/></svg>';

  const TONES = ["neutral", "formal", "friendly", "concise", "detailed", "persuasive"];

  class LexoUI {
    constructor() {
      this.host = document.createElement("lexo-ui");
      this.host.setAttribute("data-lexo", "off");
      // Shadow DOM fermé ; ouvert uniquement pour les tests automatisés.
      const testing = document.documentElement && document.documentElement.hasAttribute("data-lexo-test");
      this.shadow = this.host.attachShadow({ mode: testing ? "open" : "closed" });
      const style = document.createElement("style");
      style.textContent = CSS;
      this.root = document.createElement("div");
      this.root.className = "root";
      this.mirrors = document.createElement("div");
      this.clip = document.createElement("div");
      this.clip.className = "clip";
      this.shadow.append(style, this.root);
      this.root.append(this.mirrors, this.clip);
      this.pool = [];
      this.badge = null;
      this.card = null;
      this.panel = null;
      this.mount();
      // Empêche le champ de perdre le focus quand on clique sur l'interface.
      this.root.addEventListener("mousedown", (e) => {
        const t = e.composedPath()[0];
        if (!(t && t.closest && t.closest("input, textarea, select"))) e.preventDefault();
      });
    }

    mount() {
      const parent = document.documentElement || document.body;
      if (parent && this.host.parentNode !== parent) parent.appendChild(this.host);
    }

    owns(ev) {
      return (ev.composedPath ? ev.composedPath() : []).includes(this.host);
    }

    // ------------------------------------------------------------------ calque
    /**
     * @param {{left,top,width,height}} box zone de découpe (champ)
     * @param {{type:string, rects:Array, hot:boolean}[]} items
     */
    drawUnderlines(box, items, style) {
      this.mount();
      const c = this.clip;
      c.className = "clip " + (style || "wavy");
      c.style.left = box.left + "px";
      c.style.top = box.top + "px";
      c.style.width = Math.max(0, box.width) + "px";
      c.style.height = Math.max(0, box.height) + "px";
      let n = 0;
      for (const it of items) {
        for (const r of it.rects) {
          const hl = this._node(n++, "hl");
          hl.className = "hl t-" + it.type + (it.hot ? " on" : "");
          place(hl, r.left - box.left - 1, r.top - box.top, r.width + 2, r.height);
          const u = this._node(n++, "u");
          u.className = "u t-" + it.type;
          place(u, r.left - box.left, r.bottom - box.top - 2.5, r.width, null);
        }
      }
      for (let i = n; i < this.pool.length; i++) this.pool[i].style.display = "none";
    }

    _node(i, cls) {
      let el = this.pool[i];
      if (!el) {
        el = document.createElement("div");
        this.pool[i] = el;
        this.clip.appendChild(el);
      }
      el.style.display = "";
      return el;
    }

    clearUnderlines() {
      for (const el of this.pool) el.style.display = "none";
    }

    // ------------------------------------------------------------------- badge
    showBadge(box, state, onClick) {
      this.mount();
      if (!this.badge) {
        this.badge = document.createElement("button");
        this.badge.type = "button";
        this.badge.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this._badgeClick && this._badgeClick(); });
        this.root.appendChild(this.badge);
      }
      this._badgeClick = onClick;
      const b = this.badge;
      const small = box.height < 40;
      // Petits champs (une ligne) : badge discret, seulement s'il y a quelque chose à dire.
      if (small && !state.count && !state.checking && state.status === "ok" && !state.forceShow) {
        b.style.display = "none";
        return;
      }
      let cls = "badge" + (small ? " small" : "");
      let html = "";
      if (state.disabled) { cls += " idle"; html = ICON_PAUSE; }
      else if (state.status === "offline" || state.status === "rate_limited" || state.status === "error") { cls += " warn"; html = ICON_WARN; }
      else if (state.count) { cls += " " + (state.worst || "spelling"); html = esc(state.count > 99 ? "99+" : String(state.count)); }
      else if (state.status === "unsupported") { cls += " idle"; html = "L"; }
      else if (state.empty) { cls += " idle"; html = "L"; }
      else { cls += " ok"; html = ICON_CHECK; }
      if (state.checking) cls += " busy";
      if (state.langLabel && !small) html += `<span class="lang">${esc(state.langLabel)}</span>`;
      b.className = cls;
      if (b._html !== html) { b.innerHTML = html; b._html = html; }
      b.title = state.title || "Lexo";
      b.style.display = "";
      const size = small ? 18 : 22;
      // Position : coin bas-droit du champ, restreint à la partie visible.
      const vw = window.innerWidth, vh = window.innerHeight;
      const right = Math.min(box.right, vw - 4);
      const bottom = Math.min(box.bottom, vh - 4);
      let x, y;
      if (small) {
        x = right - size + 4;
        y = box.top - size / 2 + 2;
        if (y < 2) y = box.bottom - size / 2;
      } else {
        x = right - size - 8;
        y = bottom - size - 8;
      }
      x = Math.max(2, Math.min(vw - size - 2, x));
      y = Math.max(2, Math.min(vh - size - 2, y));
      b.style.left = x + "px";
      b.style.top = y + "px";
      b._rect = { left: x, top: y, right: x + size, bottom: y + size };
    }

    hideBadge() { if (this.badge) this.badge.style.display = "none"; }
    badgeRect() { return this.badge && this.badge.style.display !== "none" ? this.badge._rect : null; }

    // -------------------------------------------------------------------- carte
    showCard(anchor, m, h) {
      this.mount();
      this.hideCard();
      const card = document.createElement("div");
      card.className = "card";
      const type = m.type;
      const repl = (m.replacements || []).slice(0, 5);
      const chips = repl.map((r, i) => {
        const label = r.value === "" ? (m.context || T("delete")) : r.value;
        const cls = "chip" + (i ? " alt" : "") + (r.value === "" ? " del" : "");
        return `<button class="${cls}" data-a="apply" data-i="${i}" title="${esc(T("apply"))}">${esc(visible(label))}</button>`;
      }).join("");
      const spelling = type === "spelling";
      card.innerHTML = `
        <div class="head t-${type}"><span class="dot"></span><span>${esc(T("type_" + type))}</span>
          <span class="grow"></span><button class="x" data-a="close" aria-label="${esc(T("close"))}">×</button></div>
        <div class="msg">${esc(m.message || m.shortMessage || "")}</div>
        ${chips ? `<div class="repls">${chips}</div>` : ""}
        <div class="actions">
          <button class="link" data-a="ignore">${esc(T("ignore"))}</button>
          ${spelling ? `<button class="link" data-a="dict">${esc(T("addToDictionary"))}</button>` : ""}
          <button class="link" data-a="rule" title="${esc(m.rule && m.rule.id || "")}">${esc(T("disableRule"))}</button>
        </div>`;
      card.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-a]");
        if (!btn) return;
        e.preventDefault();
        const a = btn.getAttribute("data-a");
        if (a === "apply") h.apply(+btn.getAttribute("data-i"));
        else if (a === "ignore") h.ignore();
        else if (a === "dict") h.dict();
        else if (a === "rule") h.rule();
        this.hideCard();
      });
      card.addEventListener("mouseenter", () => h.enter && h.enter());
      card.addEventListener("mouseleave", () => h.leave && h.leave());
      this.root.appendChild(card);
      this.card = card;
      positionNear(card, anchor, 6);
    }

    hideCard() {
      if (this.card) { this.card.remove(); this.card = null; }
    }

    cardVisible() { return !!this.card; }

    // ------------------------------------------------------------------ panneau
    openPanel(anchor, model, h) {
      this.mount();
      this._panelH = h;
      this._panelAnchor = anchor;
      if (!this.panel) {
        this.panel = document.createElement("div");
        this.panel.className = "panel";
        this.panel.addEventListener("click", (e) => this._onPanelClick(e));
        this.panel.addEventListener("mouseover", (e) => {
          const it = e.target.closest(".item[data-i]");
          this._panelH && this._panelH.hover(it ? +it.getAttribute("data-i") : -1);
        });
        this.panel.addEventListener("mouseleave", () => this._panelH && this._panelH.hover(-1));
        this.root.appendChild(this.panel);
      }
      this.renderPanel(model);
      positionNear(this.panel, anchor, 8, true);
    }

    panelOpen() { return !!this.panel; }

    closePanel() {
      if (this.panel) { this.panel.remove(); this.panel = null; }
    }

    renderPanel(model) {
      if (!this.panel) return;
      this._model = model;
      const p = this.panel;
      const scroll = p.querySelector(".pb") ? p.querySelector(".pb").scrollTop : 0;
      const langLabel = model.lang ? LexoLang.name(model.lang) : "—";
      const langTitle = model.langForced ? T("langForced") : T("langAuto");
      const count = model.matches.length;
      p.innerHTML = `
        <div class="ph">
          <div class="logo">L</div><div class="title">Lexo</div><span class="grow"></span>
          <button class="pill" data-a="langmenu" title="${esc(langTitle)}">${model.langForced ? "" : "✨ "}${esc(langLabel)} ▾</button>
          <button class="x" data-a="close" aria-label="${esc(T("close"))}">×</button>
        </div>
        ${model.langMenu ? this._langMenu(model) : ""}
        ${model.readonly ? "" : `<div class="tabs">
          <button class="tab ${model.tab === "fix" ? "on" : ""}" data-a="tab" data-v="fix">${esc(T("tabFix"))}${count ? ` (${count})` : ""}</button>
          <button class="tab ${model.tab === "rephrase" ? "on" : ""}" data-a="tab" data-v="rephrase">${esc(T("tabRephrase"))}</button>
        </div>`}
        <div class="pb">${model.tab === "rephrase" || model.readonly ? this._rephraseBody(model) : this._fixBody(model)}</div>
        <div class="pf">
          ${model.tab === "fix" && !model.readonly && model.matches.some((m) => m.replacements && m.replacements.length)
            ? `<button class="primary" data-a="all">${esc(T("fixAll"))}</button>` : ""}
          <span class="grow"></span>
          ${model.readonly ? "" : `<button class="link" data-a="site">${esc(T("disableSite"))}</button>`}
          <button class="link" data-a="options" title="${esc(T("settings"))}">⚙</button>
        </div>`;
      const pb = p.querySelector(".pb");
      if (pb) pb.scrollTop = scroll;
    }

    _langMenu(model) {
      const cur = model.langForced ? model.lang : "auto";
      const codes = LexoLang.MAIN_LANGS.concat(LexoLang.allCodes().filter((c) => !LexoLang.MAIN_LANGS.includes(c)));
      const items = [`<button class="mi ${cur === "auto" ? "on" : ""}" data-a="lang" data-v="auto">✨ ${esc(T("langAutoItem"))}</button>`]
        .concat(codes.map((c) => `<button class="mi ${cur === c ? "on" : ""}" data-a="lang" data-v="${c}">${esc(LexoLang.name(c))}</button>`));
      return `<div class="menu">${items.join("")}</div>`;
    }

    _status(model) {
      const s = model.status;
      if (s === "offline") return `<div class="status warn">${esc(T("statusOffline"))}</div>`;
      if (s === "rate_limited") return `<div class="status warn">${esc(T("statusRateLimited"))}</div>`;
      if (s === "error") return `<div class="status warn">${esc(T("statusError"))}</div>`;
      if (s === "unsupported") return `<div class="status warn">${esc(T("statusUnsupported", LexoLang.name(model.lang)))}</div>`;
      if (model.checking) return `<div class="status">${esc(T("checking"))}</div>`;
      return "";
    }

    _fixBody(model) {
      const head = this._status(model);
      if (!model.matches.length) {
        if (model.empty) return head + `<div class="empty"><div class="big">✍️</div>${esc(T("emptyField"))}</div>`;
        return head + `<div class="empty"><div class="big">🎉</div>${esc(T("noIssues"))}</div>`;
      }
      const text = model.text || "";
      return head + model.matches.map((m, i) => {
        const a = Math.max(0, m.offset - 28);
        const b = Math.min(text.length, m.offset + m.length + 28);
        const before = (a > 0 ? "…" : "") + text.slice(a, m.offset);
        const after = text.slice(m.offset + m.length, b) + (b < text.length ? "…" : "");
        const r0 = m.replacements && m.replacements[0];
        const fix = r0 ? `<span class="arrow">→</span><button class="chip" data-a="fix" data-i="${i}">${esc(visible(r0.value === "" ? T("delete") : r0.value))}</button>` : "";
        return `<div class="item" data-i="${i}">
          <span class="dot t-${m.type}"></span>
          <div class="grow">
            <div class="snip">${esc(oneLine(before))}<mark class="t-${m.type}">${esc(visible(m.context || ""))}</mark>${fix}<span class="sub"> ${esc(oneLine(after))}</span></div>
            <div class="sub">${esc(m.message || "")}</div>
          </div>
          <button class="x" data-a="ign" data-i="${i}" title="${esc(T("ignore"))}">×</button>
        </div>`;
      }).join("");
    }

    _rephraseBody(model) {
      const r = model.rephrase || {};
      const tones = TONES.map((t) => `<button class="tone ${r.tone === t ? "on" : ""}" data-a="tone" data-v="${t}">${esc(T("tone_" + t))}</button>`).join("");
      const src = T(r.source === "selection" ? "rephraseSelection" : r.source === "paragraph" ? "rephraseParagraph" : "rephraseAll");
      let body = `<div class="note">${esc(src)}</div><div class="tones">${tones}</div>`;
      if (!r.state || r.state === "idle") {
        body += `<button class="primary" data-a="rephrase" ${model.rephraseText ? "" : "disabled"}>✨ ${esc(T("rephraseGo"))}</button>`;
      } else if (r.state === "loading") {
        body += `<div class="sk"></div><div class="sk" style="width:80%"></div><div class="sk" style="width:60%"></div>`;
      } else if (r.state === "error") {
        body += `<div class="err">${esc(T("rephraseError_" + (r.code || "api")) || r.message)}</div>
          <button class="primary" data-a="rephrase">${esc(T("retry"))}</button>`;
        if (["auth", "no_key", "no_provider", "unavailable", "bad_request", "ollama_origin", "ollama_model"].includes(r.code)) body += ` <button class="link" data-a="options">${esc(T("configure"))}</button>`;
      } else if (r.state === "done" && r.result) {
        const res = r.result;
        const blocks = [];
        if (res.corrected && res.corrected !== model.rephraseText) {
          blocks.push({ label: T("correctedVersion"), text: res.corrected, sub: res.explanation });
        } else {
          blocks.push({ label: T("correctedVersion"), text: "", sub: T("noIssuesShort") });
        }
        res.suggestions.forEach((s) => blocks.push({ label: s.label || T("tone_" + r.tone), text: s.text }));
        body += blocks.map((b, i) => `<div class="res">
            <div class="lbl">${esc(b.label)}</div>
            ${b.text ? `<div class="txt">${esc(b.text)}</div>` : ""}
            ${b.sub ? `<div class="sub">${esc(b.sub)}</div>` : ""}
            ${b.text ? `<div class="row">
              <button class="link" data-a="copy" data-i="${i}">${esc(T("copy"))}</button>
              ${model.readonly ? "" : `<button class="chip" data-a="use" data-i="${i}">${esc(T("replace"))}</button>`}
            </div>` : ""}
          </div>`).join("");
        this._blocks = blocks;
        if (res.local) {
          body += `<div class="res"><div class="lbl">🪄 ${esc(T("freeAiTitle"))}</div>
            <div class="sub">${esc(T("freeAiHelp"))}</div>
            <div class="row"><button class="chip" data-a="options">${esc(T("configure"))}</button></div></div>`;
        }
        if (!res.local) body += `<div class="row" style="display:flex;justify-content:flex-end;margin-top:8px"><button class="link" data-a="rephrase">↻ ${esc(T("again"))}</button></div>`;
      }
      return body;
    }

    _onPanelClick(e) {
      const btn = e.target.closest("[data-a]");
      const h = this._panelH;
      if (!btn || !h) {
        if (this._model && this._model.langMenu && h) h.langMenu(false);
        return;
      }
      e.preventDefault();
      const a = btn.getAttribute("data-a");
      const v = btn.getAttribute("data-v");
      const i = +btn.getAttribute("data-i");
      switch (a) {
        case "close": h.close(); break;
        case "tab": h.tab(v); break;
        case "fix": h.apply(i, 0); break;
        case "ign": h.ignore(i); break;
        case "all": h.applyAll(); break;
        case "langmenu": h.langMenu(!this._model.langMenu); break;
        case "lang": h.lang(v); break;
        case "tone": h.tone(v); break;
        case "rephrase": h.rephrase(); break;
        case "use": h.use(this._blocks[i].text); break;
        case "copy": h.copy(this._blocks[i].text); break;
        case "site": h.disableSite(); break;
        case "options": h.options(); break;
      }
    }

    reposition() {
      if (this.panel && this._panelAnchor) positionNear(this.panel, this._panelAnchor, 8, true);
    }

    toast(text, anchor) {
      const el = document.createElement("div");
      el.className = "toast";
      el.textContent = text;
      this.root.appendChild(el);
      positionNear(el, anchor || { left: window.innerWidth / 2, right: window.innerWidth / 2, top: 20, bottom: 20 }, 6);
      setTimeout(() => el.remove(), 1600);
    }

    destroy() {
      this.host.remove();
    }
  }

  function place(el, x, y, w, h) {
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.width = Math.max(1, w) + "px";
    if (h != null) el.style.height = h + "px";
  }

  /** Affiche les espaces invisibles d'une suggestion (ex. « ␣ »). */
  function visible(s) {
    if (s === " ") return "␣";
    return String(s).replace(/\n/g, "↵");
  }

  function oneLine(s) { return String(s).replace(/\s*\n\s*/g, " ⏎ "); }

  /** Place un élément flottant sous (ou au-dessus de) `anchor`, dans l'écran. */
  function positionNear(el, anchor, gap, preferLeft) {
    el.style.left = "0px"; el.style.top = "0px";
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = preferLeft ? anchor.right - w : anchor.left;
    let y = anchor.bottom + gap;
    if (y + h > vh - 8) {
      const up = anchor.top - gap - h;
      y = up >= 8 ? up : Math.max(8, vh - h - 8);
    }
    x = Math.max(8, Math.min(vw - w - 8, x));
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
  }

  root.LexoUI = LexoUI;
})(typeof globalThis !== "undefined" ? globalThis : this);
