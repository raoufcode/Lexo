/*
 * Lexo — adaptateurs de champs de saisie.
 *
 * Chaque adaptateur expose la même interface :
 *   getText()               texte brut du champ
 *   rectsFor(ranges)        rectangles (coordonnées fenêtre) de plages de texte
 *   clientBox()             zone visible du contenu (coordonnées fenêtre)
 *   replace(start,end,str)  remplace du texte en préservant l'annulation (Ctrl+Z)
 *   getSelection()          { start, end } ou null
 *   destroy()
 */
(function (root) {
  "use strict";

  const SKIP_SELECTOR = [
    ".CodeMirror", ".cm-editor", ".cm-content", ".monaco-editor", ".ace_editor",
    "[data-lexo='off']", "[data-lexo='false']", "[data-gramm='false']",
    "[data-enable-grammarly='false']", ".lexo-ignore",
  ].join(",");

  const OK_INPUT_TYPES = new Set(["text", "search", ""]);
  const BAD_AUTOCOMPLETE = /(username|email|password|one-time-code|cc-|tel|postal-code|street-address|address-line|country|bday|url|nickname)/i;

  /** Élément réellement ciblé (gère les Shadow DOM ouverts). */
  function deepTarget(ev) {
    const path = ev.composedPath ? ev.composedPath() : [];
    return path.length ? path[0] : ev.target;
  }

  /** Renvoie l'élément éditable à surveiller pour `el`, ou null. */
  function resolveEditable(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.closest && el.closest(SKIP_SELECTOR)) return null;

    if (el instanceof HTMLTextAreaElement) {
      if (el.readOnly || el.disabled) return null;
      if (BAD_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "")) return null;
      return el;
    }
    if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (!OK_INPUT_TYPES.has(type)) return null;
      if (el.readOnly || el.disabled) return null;
      if (BAD_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "")) return null;
      if (el.getAttribute("role") === "combobox" && el.getAttribute("aria-autocomplete") === "list" && type !== "search") {
        // listes déroulantes de sélection : souvent pas du texte rédigé
        if ((el.getAttribute("aria-haspopup") || "") === "listbox") return null;
      }
      return el;
    }
    if (el.isContentEditable) {
      let host = el;
      while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
      if (host.closest(SKIP_SELECTOR)) return null;
      if (host.getAttribute("aria-readonly") === "true") return null;
      return host;
    }
    return null;
  }

  /** Assez grand et visible pour mériter une vérification ? */
  function isVisibleEnough(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 14) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.05) return false;
    return true;
  }

  // ===========================================================================
  // <textarea> et <input>
  // ===========================================================================
  const MIRROR_PROPS = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "fontStretch",
    "fontKerning", "fontFeatureSettings", "fontVariationSettings", "letterSpacing",
    "wordSpacing", "textTransform", "textIndent", "textAlign", "lineHeight", "tabSize",
    "direction", "wordBreak", "overflowWrap", "hyphens", "textRendering",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  ];

  class TextFieldAdapter {
    constructor(el, mirrorParent) {
      this.el = el;
      this.isInput = el instanceof HTMLInputElement;
      this.kind = this.isInput ? "input" : "textarea";
      this.mirror = document.createElement("div");
      this.mirror.setAttribute("aria-hidden", "true");
      this.inner = document.createElement("span");
      this.mirror.appendChild(this.inner);
      mirrorParent.appendChild(this.mirror);
      this._key = "";
      this._cached = null;
    }

    getText() { return this.el.value || ""; }

    /** Bordures réelles (clientLeft/clientWidth ne sont pas fiables sur <input>). */
    _borders() {
      const cs = getComputedStyle(this.el);
      return {
        l: parseFloat(cs.borderLeftWidth) || 0, t: parseFloat(cs.borderTopWidth) || 0,
        r: parseFloat(cs.borderRightWidth) || 0, b: parseFloat(cs.borderBottomWidth) || 0,
      };
    }

    clientBox() {
      const r = this.el.getBoundingClientRect();
      const bd = this._borders();
      const left = r.left + bd.l;
      const top = r.top + bd.t;
      // <textarea> : clientWidth exclut la barre de défilement ; <input> : pas de barre.
      const width = this.isInput ? r.width - bd.l - bd.r : this.el.clientWidth;
      const height = this.isInput ? r.height - bd.t - bd.b : this.el.clientHeight;
      return { left, top, width, height, right: left + width, bottom: top + height, outer: r };
    }

    _syncMirror() {
      const cs = getComputedStyle(this.el);
      const s = this.mirror.style;
      for (const p of MIRROR_PROPS) s[p] = cs[p];
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;
      s.position = "absolute";
      s.left = "-100000px";
      s.top = "0";
      s.visibility = "hidden";
      s.boxSizing = "content-box";
      s.border = "0";
      s.margin = "0";
      s.overflow = "hidden";
      s.contain = "layout style";
      if (this.isInput) {
        s.whiteSpace = "pre";
        s.display = "flex";
        s.alignItems = "center";
        s.width = "100000px";
        s.height = Math.max(0, this.clientBox().height - padT - padB) + "px";
        this.inner.style.whiteSpace = "pre";
        this.inner.style.textAlign = cs.textAlign;
      } else {
        s.whiteSpace = "pre-wrap";
        s.display = "block";
        if (cs.overflowWrap === "normal" && cs.wordWrap !== "break-word") s.overflowWrap = "break-word";
        s.width = Math.max(0, this.el.clientWidth - padL - padR) + "px";
        s.height = "auto";
      }
      return { cs, padL, padT };
    }

    /**
     * @param {{start:number,end:number}[]} ranges
     * @returns {DOMRect-like[][]} pour chaque plage, ses rectangles
     */
    rectsFor(ranges) {
      const text = this.getText();
      const el = this.el;
      const key = [text.length, text.slice(0, 64), el.clientWidth, el.clientHeight, ranges.map((r) => r.start + "-" + r.end).join(","), LexoText.hash(text)].join("|");
      let rel;
      if (key === this._key && this._cached) {
        rel = this._cached;
      } else {
        this._syncMirror();
        const inner = this.inner;
        inner.textContent = "";
        const spans = [];
        let pos = 0;
        const frag = document.createDocumentFragment();
        for (const r of ranges) {
          if (r.start < pos) { spans.push(null); continue; }
          if (r.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, r.start)));
          const sp = document.createElement("span");
          sp.textContent = text.slice(r.start, r.end) || "​";
          frag.appendChild(sp);
          spans.push(sp);
          pos = r.end;
        }
        frag.appendChild(document.createTextNode(text.slice(pos) + "​"));
        inner.appendChild(frag);
        const base = this.mirror.getBoundingClientRect();
        rel = spans.map((sp) => {
          if (!sp) return [];
          return Array.from(sp.getClientRects()).filter((q) => q.width > 0.5).map((q) => ({
            left: q.left - base.left, top: q.top - base.top, width: q.width, height: q.height,
          }));
        });
        this._key = key;
        this._cached = rel;
      }
      // Conversion en coordonnées fenêtre (tient compte du défilement interne).
      const box = this.clientBox();
      const dx = box.left - el.scrollLeft;
      const dy = box.top - el.scrollTop;
      return rel.map((list) => list.map((q) => ({
        left: q.left + dx, top: q.top + dy, width: q.width, height: q.height,
        right: q.left + dx + q.width, bottom: q.top + dy + q.height,
      })));
    }

    getSelection() {
      try {
        const s = this.el.selectionStart, e = this.el.selectionEnd;
        if (s == null) return null;
        return { start: s, end: e };
      } catch (err) { return null; }
    }

    replace(start, end, str) {
      const el = this.el;
      const before = el.value;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      el.setSelectionRange(start, end);
      let ok = false;
      try {
        ok = str === "" ? document.execCommand("delete", false) : document.execCommand("insertText", false, str);
      } catch (e) { ok = false; }
      const expected = before.slice(0, start) + str + before.slice(end);
      if (!ok || el.value !== expected) {
        if (el.value === before) {
          // Repli : setter natif (compatible React/Vue) + évènement input.
          const proto = this.isInput ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          desc.set.call(el, expected);
          el.setSelectionRange(start + str.length, start + str.length);
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: str }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      this._key = "";
      return el.value === expected;
    }

    destroy() { this.mirror.remove(); }
  }

  // ===========================================================================
  // contenteditable (Gmail, Outlook, LinkedIn, Notion, WordPress, ...)
  // ===========================================================================
  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIELDSET",
    "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6",
    "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE",
    "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "UL", "CAPTION",
  ]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "svg", "SVG", "IMG", "VIDEO", "AUDIO", "CANVAS", "IFRAME", "OBJECT", "BUTTON", "SELECT"]);

  class ContentEditableAdapter {
    constructor(host) {
      this.el = host;
      this.kind = "contenteditable";
      this.dirty = true;
      this.text = "";
      this.segs = [];
      this.observer = new MutationObserver(() => { this.dirty = true; });
      this.observer.observe(host, { characterData: true, childList: true, subtree: true });
    }

    _build() {
      const segs = [];
      let text = "";
      const nl = () => { if (text && !text.endsWith("\n")) text += "\n"; };
      const walk = (node) => {
        for (let n = node.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3) {
            const data = n.data;
            if (!data) continue;
            segs.push({ node: n, start: text.length, end: text.length + data.length });
            text += data;
          } else if (n.nodeType === 1) {
            const tag = n.tagName;
            if (SKIP_TAGS.has(tag) || n.hidden) continue;
            if (tag === "BR") { text += "\n"; continue; }
            if (n.getAttribute("contenteditable") === "false") { nl(); continue; }
            const block = BLOCK_TAGS.has(tag);
            if (block) nl();
            walk(n);
            if (block) nl();
          }
        }
      };
      walk(this.el);
      this.text = text;
      this.segs = segs;
      this.dirty = false;
    }

    getText() {
      if (this.dirty) this._build();
      return this.text;
    }

    /** Position DOM pour un décalage. `atEnd` : préférer la fin du nœud précédent. */
    _point(offset, atEnd) {
      const segs = this.segs;
      let lo = 0, hi = segs.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = segs[mid];
        if (offset < s.start) hi = mid - 1;
        else if (offset > s.end) lo = mid + 1;
        else {
          // offset dans [start, end]
          if (offset === s.end && !atEnd && mid + 1 < segs.length && segs[mid + 1].start === offset) {
            return { node: segs[mid + 1].node, offset: 0 };
          }
          return { node: s.node, offset: offset - s.start };
        }
      }
      // Décalage dans un saut de ligne virtuel : on prend le segment suivant.
      const next = segs[lo];
      if (next && !atEnd) return { node: next.node, offset: 0 };
      const prev = segs[hi];
      if (prev) return { node: prev.node, offset: prev.node.data.length };
      return null;
    }

    _range(start, end) {
      this.getText();
      const a = this._point(start, false);
      const b = this._point(end, true);
      if (!a || !b) return null;
      if (!a.node.isConnected || !b.node.isConnected) { this.dirty = true; return null; }
      const r = document.createRange();
      try {
        r.setStart(a.node, Math.min(a.offset, a.node.data.length));
        r.setEnd(b.node, Math.min(b.offset, b.node.data.length));
      } catch (e) { return null; }
      return r;
    }

    clientBox() {
      const r = this.el.getBoundingClientRect();
      const left = r.left + this.el.clientLeft;
      const top = r.top + this.el.clientTop;
      const w = this.el.clientWidth || r.width;
      const h = this.el.clientHeight || r.height;
      return { left, top, width: w, height: h, right: left + w, bottom: top + h, outer: r };
    }

    rectsFor(ranges) {
      return ranges.map(({ start, end }) => {
        const range = this._range(start, end);
        if (!range) return [];
        return mergeLineRects(Array.from(range.getClientRects()));
      });
    }

    getSelection() {
      const sel = this.el.ownerDocument.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!this.el.contains(r.startContainer)) return null;
      this.getText();
      const toOffset = (node, off) => {
        if (node.nodeType === 3) {
          const s = this.segs.find((x) => x.node === node);
          return s ? s.start + off : null;
        }
        // Élément : premier segment de texte situé après le point
        const pt = this.el.ownerDocument.createRange();
        try { pt.setStart(node, off); } catch (e) { return null; }
        for (const s of this.segs) {
          try { if (pt.comparePoint(s.node, 0) >= 0) return s.start; } catch (e) { /* autre arbre */ }
        }
        return this.text.length;
      };
      const start = toOffset(r.startContainer, r.startOffset);
      const end = toOffset(r.endContainer, r.endOffset);
      if (start == null || end == null) return null;
      return { start: Math.min(start, end), end: Math.max(start, end) };
    }

    replace(start, end, str) {
      const before = this.getText();
      const range = this._range(start, end);
      if (!range) return false;
      const doc = this.el.ownerDocument;
      try { this.el.focus({ preventScroll: true }); } catch (e) { this.el.focus(); }
      const sel = doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try {
        ok = str === "" ? doc.execCommand("delete", false) : doc.execCommand("insertText", false, str);
      } catch (e) { ok = false; }
      this.dirty = true;
      const expected = before.slice(0, start) + str + before.slice(end);
      let after = this.getText();
      if (after === before) {
        // Repli : modification directe du DOM + évènement input.
        const r2 = this._range(start, end);
        if (!r2) return false;
        r2.deleteContents();
        if (str) {
          const tn = doc.createTextNode(str);
          r2.insertNode(tn);
          const caret = doc.createRange();
          caret.setStartAfter(tn); caret.collapse(true);
          sel.removeAllRanges(); sel.addRange(caret);
        }
        this.el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: str }));
        this.dirty = true;
        after = this.getText();
      }
      return after === expected || after.replace(/ /g, " ") === expected.replace(/ /g, " ");
    }

    destroy() { this.observer.disconnect(); }
  }

  /** Fusionne les rectangles d'une même ligne (les ranges en renvoient plusieurs). */
  function mergeLineRects(rects) {
    const out = [];
    for (const q of rects) {
      if (q.width < 0.5 || q.height < 1) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last.top - q.top) < 2 && Math.abs(last.height - q.height) < 4 && q.left <= last.right + 2) {
        last.right = Math.max(last.right, q.right);
        last.width = last.right - last.left;
      } else {
        out.push({ left: q.left, top: q.top, width: q.width, height: q.height, right: q.right, bottom: q.bottom });
      }
    }
    return out;
  }

  function createAdapter(el, mirrorParent) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return new TextFieldAdapter(el, mirrorParent);
    return new ContentEditableAdapter(el);
  }

  root.LexoFields = { resolveEditable, isVisibleEnough, createAdapter, deepTarget, mergeLineRects };
})(typeof globalThis !== "undefined" ? globalThis : this);
