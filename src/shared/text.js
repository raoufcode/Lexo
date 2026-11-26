/*
 * Lexo — utilitaires de texte purs (sans DOM) : découpage en paragraphes,
 * différences entre deux versions, recalage des erreurs pendant la frappe,
 * regroupement en lots pour l'API.
 */
(function (root) {
  "use strict";

  /**
   * Découpe un texte en paragraphes (séparés par un ou plusieurs retours à la
   * ligne). Chaque paragraphe conserve son décalage dans le texte d'origine.
   * Les paragraphes vides sont ignorés.
   * @returns {{start:number, text:string}[]}
   */
  function splitParagraphs(text, maxLen = 4000) {
    const out = [];
    const re = /[^\n]+/g;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].trim()) continue;
      if (m[0].length <= maxLen) {
        out.push({ start: m.index, text: m[0] });
      } else {
        // Paragraphe géant : on le coupe proprement aux fins de phrases.
        for (const part of splitLong(m[0], maxLen)) {
          out.push({ start: m.index + part.start, text: part.text });
        }
      }
    }
    return out;
  }

  function splitLong(text, maxLen) {
    const parts = [];
    let pos = 0;
    while (pos < text.length) {
      let end = Math.min(text.length, pos + maxLen);
      if (end < text.length) {
        const slice = text.slice(pos, end);
        const cut = Math.max(
          slice.lastIndexOf(". "), slice.lastIndexOf("! "),
          slice.lastIndexOf("? "), slice.lastIndexOf("; ")
        );
        if (cut > maxLen * 0.5) end = pos + cut + 2;
        else {
          const sp = slice.lastIndexOf(" ");
          if (sp > maxLen * 0.5) end = pos + sp + 1;
        }
      }
      parts.push({ start: pos, text: text.slice(pos, end) });
      pos = end;
    }
    return parts;
  }

  /** Hachage rapide (FNV-1a 32 bits) pour les clés de cache. */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  /**
   * Différence minimale entre deux chaînes : préfixe et suffixe communs.
   * @returns {{start:number, oldEnd:number, newEnd:number, delta:number}|null}
   */
  function diff(oldText, newText) {
    if (oldText === newText) return null;
    const max = Math.min(oldText.length, newText.length);
    let p = 0;
    while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
    let s = 0;
    while (
      s < max - p &&
      oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)
    ) s++;
    return {
      start: p,
      oldEnd: oldText.length - s,
      newEnd: newText.length - s,
      delta: newText.length - oldText.length,
    };
  }

  /**
   * Recale les erreurs connues après une modification du texte, pour que les
   * soulignements suivent la frappe sans attendre le serveur. Les erreurs qui
   * touchent la zone modifiée sont retirées (elles seront revérifiées).
   */
  function remapMatches(matches, oldText, newText) {
    const d = diff(oldText, newText);
    if (!d) return matches.slice();
    const isW = (c) => !!c && /[\p{L}\p{N}'’-]/u.test(c);
    const out = [];
    for (const m of matches) {
      const end = m.offset + m.length;
      if (end < d.start || (end === d.start && !isW(newText[end]) && !isW(oldText[end]))) {
        out.push(m); // avant la modification, mot non prolongé
      } else if (
        m.offset > d.oldEnd ||
        (m.offset === d.oldEnd && !isW(oldText[m.offset - 1]) && !isW(newText[m.offset + d.delta - 1]))
      ) {
        out.push(Object.assign({}, m, { offset: m.offset + d.delta })); // après : décalée
      }
      // sinon : chevauche la modification -> retirée, sera revérifiée
    }
    // Vérifie que le texte souligné est toujours identique (sécurité).
    return out.filter((m) => {
      if (m.offset < 0 || m.offset + m.length > newText.length) return false;
      return m.context == null || newText.substr(m.offset, m.length) === m.context;
    });
  }

  /**
   * Regroupe des segments en lots dont la taille cumulée ne dépasse pas
   * maxChars. Les segments sont joints par SEP dans la requête.
   */
  const SEP = "\n\n";
  function buildBatches(segments, maxChars = 12000) {
    const batches = [];
    let cur = null;
    for (const seg of segments) {
      const len = seg.text.length;
      if (!cur || (cur.text.length + SEP.length + len > maxChars && cur.items.length)) {
        cur = { text: "", items: [] };
        batches.push(cur);
      }
      if (cur.items.length) cur.text += SEP;
      cur.items.push({ seg, at: cur.text.length });
      cur.text += seg.text;
    }
    return batches;
  }

  /**
   * Répartit les erreurs d'une réponse de lot sur chaque segment, en
   * coordonnées locales au segment. Les erreurs à cheval sont ignorées.
   */
  function splitBatchMatches(batch, matches) {
    const per = batch.items.map(() => []);
    for (const m of matches) {
      // recherche du segment contenant m.offset
      let lo = 0, hi = batch.items.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (batch.items[mid].at <= m.offset) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (idx < 0) continue;
      const it = batch.items[idx];
      const local = m.offset - it.at;
      if (local + m.length > it.seg.text.length) continue;
      per[idx].push(Object.assign({}, m, { offset: local }));
    }
    return per;
  }

  /** Mot (lettres, chiffres, apostrophes, tirets) autour d'une position. */
  function wordAt(text, offset, length) {
    return text.substr(offset, length);
  }

  /** Échappe un texte pour insertion dans du HTML. */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  const LexoText = {
    splitParagraphs, hash, diff, remapMatches, buildBatches,
    splitBatchMatches, wordAt, escapeHtml, SEP,
  };
  root.LexoText = LexoText;
  if (typeof module !== "undefined" && module.exports) module.exports = LexoText;
})(typeof globalThis !== "undefined" ? globalThis : this);
