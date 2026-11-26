/*
 * Lexo — moteur de vérification (arrière-plan).
 *
 *  - détecte la langue (texte entier puis paragraphe par paragraphe) ;
 *  - ne revérifie que les paragraphes modifiés (cache LRU par paragraphe) ;
 *  - regroupe les paragraphes à vérifier en un minimum de requêtes ;
 *  - respecte les limites du serveur public (file d'attente, reprise) ;
 *  - fusionne avec les règles locales et retombe sur elles hors ligne.
 */
(function (root) {
  "use strict";

  const { LexoLang, LexoText, LexoRules, LexoSettings } = root;
  const ext = LexoSettings.ext;

  const PUBLIC_SERVER = "https://api.languagetool.org";
  const PREMIUM_SERVER = "https://api.languagetoolplus.com";
  const REQUEST_TIMEOUT_MS = 15000;

  // ---------------------------------------------------------------------------
  // Cache LRU minimaliste
  // ---------------------------------------------------------------------------
  class LRU {
    constructor(max) { this.max = max; this.map = new Map(); }
    get(k) {
      if (!this.map.has(k)) return undefined;
      const v = this.map.get(k);
      this.map.delete(k); this.map.set(k, v);
      return v;
    }
    set(k, v) {
      this.map.delete(k); this.map.set(k, v);
      if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    }
    clear() { this.map.clear(); }
  }

  // ---------------------------------------------------------------------------
  // Limiteur de débit (fenêtre glissante) avec abandon des requêtes périmées
  // ---------------------------------------------------------------------------
  class RateLimiter {
    constructor() { this.stamps = []; this.pausedUntil = 0; }
    limits(settings) {
      const isPublic = !settings.ltApiKey && normalizeServer(settings.ltServer) === PUBLIC_SERVER;
      return isPublic ? { perMinute: 18 } : { perMinute: 120 };
    }
    async acquire(settings, isStale) {
      const { perMinute } = this.limits(settings);
      for (;;) {
        if (isStale()) return false;
        const now = Date.now();
        if (now < this.pausedUntil) {
          await sleep(Math.min(1000, this.pausedUntil - now));
          continue;
        }
        this.stamps = this.stamps.filter((t) => now - t < 60000);
        if (this.stamps.length < perMinute) {
          this.stamps.push(now);
          return true;
        }
        await sleep(Math.min(1000, 60000 - (now - this.stamps[0]) + 10));
      }
    }
    pause(ms) { this.pausedUntil = Date.now() + ms; }
    get paused() { return Date.now() < this.pausedUntil; }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function normalizeServer(url) {
    let u = String(url || PUBLIC_SERVER).trim().replace(/\/+$/, "");
    u = u.replace(/\/v2(\/check)?$/, "");
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    return u;
  }

  // ---------------------------------------------------------------------------
  // Détection de langue
  // ---------------------------------------------------------------------------
  async function detectCLD(text) {
    try {
      if (!ext.i18n || !ext.i18n.detectLanguage) return null;
      const res = await Promise.race([
        Promise.resolve(ext.i18n.detectLanguage(text)).catch(() => null),
        sleep(300).then(() => null),
      ]);
      if (!res || !res.languages || !res.languages.length) return null;
      const top = res.languages[0];
      return { lang: LexoLang.base(top.language), reliable: !!res.isReliable, pct: top.percentage };
    } catch (e) {
      return null;
    }
  }

  /**
   * Choisit la langue d'un texte. `hint` : dernière langue connue du champ.
   * Ordre : détecteur du navigateur fiable > mots-outils > indice > défaut.
   */
  async function detectLanguage(text, hint, fallback) {
    const sample = text.length > 3000 ? text.slice(0, 3000) : text;
    const letters = (sample.match(/\p{L}/gu) || []).length;
    const local = LexoLang.guess(sample);

    // Texte très court : on privilégie la continuité (langue précédente).
    if (letters < 12) {
      if (local.lang && local.confidence >= 0.75) return { lang: local.lang, sure: false };
      return { lang: hint || fallback, sure: false };
    }

    const cld = await detectCLD(sample);
    if (cld && cld.reliable && cld.pct >= 60 && cld.lang && cld.lang !== "und") {
      // Sur un texte moyen, si les mots-outils désignent clairement une autre
      // langue, on les écoute (CLD se trompe parfois sur fr/it/es).
      if (letters < 60 && local.lang && local.lang !== cld.lang && local.confidence >= 0.7) {
        return { lang: local.lang, sure: true };
      }
      return { lang: cld.lang, sure: true };
    }
    if (local.lang && local.confidence >= 0.35) return { lang: local.lang, sure: local.confidence >= 0.6 };
    if (cld && cld.lang && cld.lang !== "und" && cld.pct >= 80) return { lang: cld.lang, sure: false };
    return { lang: hint || fallback, sure: false };
  }

  // ---------------------------------------------------------------------------
  // Vérificateur
  // ---------------------------------------------------------------------------
  class Checker {
    constructor() {
      this.cache = new LRU(1500);
      this.langCache = new LRU(1500);
      this.limiter = new RateLimiter();
      this.latest = new Map(); // fieldKey -> seq
    }

    clearCache() { this.cache.clear(); this.langCache.clear(); }

    /**
     * @param {{text:string, fieldKey?:string, seq?:number, hint?:string, forced?:string}} req
     */
    async check(req, settings) {
      const text = String(req.text || "");
      const fieldKey = req.fieldKey || "default";
      const seq = req.seq || 0;
      this.latest.set(fieldKey, seq);
      if (this.latest.size > 500) this.latest.delete(this.latest.keys().next().value);
      const isStale = () => (this.latest.get(fieldKey) || 0) > seq;

      const forced = req.forced || (settings.language !== "auto" ? settings.language : null);
      const fallback = LexoLang.base(settings.defaultLanguage) || "fr";

      let docLang, sure;
      if (forced) {
        docLang = LexoLang.base(forced); sure = true;
      } else {
        const d = await detectLanguage(text, req.hint, fallback);
        docLang = d.lang; sure = d.sure;
      }

      const paragraphs = LexoText.splitParagraphs(text);
      const result = {
        lang: docLang,
        langName: LexoLang.name(docLang),
        sure,
        forced: !!forced,
        supported: LexoLang.isSupported(docLang),
        status: "ok",
        matches: [],
      };

      // Langue par paragraphe (documents multilingues), uniquement en auto.
      const plan = [];
      for (const p of paragraphs) {
        let lang = docLang;
        if (!forced && p.text.length >= 60 && paragraphs.length > 1) {
          const lk = LexoText.hash(p.text) + ":" + p.text.length;
          let pl = this.langCache.get(lk);
          if (pl === undefined) {
            const d = await detectLanguage(p.text, docLang, docLang);
            pl = d.sure ? d.lang : docLang;
            this.langCache.set(lk, pl);
          }
          lang = pl;
        }
        const lt = LexoLang.toLT(lang, settings.variants);
        plan.push({ p, lang, lt });
      }

      // Cache par paragraphe
      const level = settings.level === "picky" ? "picky" : "default";
      const server = normalizeServer(settings.ltServer);
      const pending = new Map(); // lt -> [{p, key, idx}]
      const perParagraph = new Array(plan.length);
      plan.forEach((item, idx) => {
        if (!item.lt) { perParagraph[idx] = []; return; }
        const key = [server, item.lt, level, LexoText.hash(item.p.text), item.p.text.length].join("|");
        const hit = this.cache.get(key);
        if (hit) { perParagraph[idx] = hit; return; }
        if (!pending.has(item.lt)) pending.set(item.lt, []);
        pending.get(item.lt).push({ text: item.p.text, key, idx });
      });

      // Requêtes distantes (en parallèle par langue, lots limités en taille)
      const jobs = [];
      for (const [lt, segs] of pending) {
        for (const batch of LexoText.buildBatches(segs, 9000)) {
          jobs.push(this._runBatch(batch, lt, level, settings, isStale).then((r) => {
            if (r.status !== "ok") { result.status = worst(result.status, r.status); result.message = r.message; return; }
            r.per.forEach((ms, i) => {
              const it = batch.items[i].seg;
              this.cache.set(it.key, ms);
              perParagraph[it.idx] = ms;
            });
          }));
        }
      }
      await Promise.all(jobs);
      if (isStale()) return { stale: true };

      // Assemblage + règles locales + filtres utilisateur
      const dict = new Set((settings.dictionary || []).map((w) => w.toLowerCase()));
      const disabled = new Set(settings.disabledRules || []);
      const all = [];
      plan.forEach((item, idx) => {
        const remote = perParagraph[idx] || [];
        const local = LexoRules.check(item.p.text, item.lang);
        const merged = mergeMatches(remote, local);
        for (const m of merged) {
          const word = item.p.text.substr(m.offset, m.length);
          if (disabled.has(m.rule.id)) continue;
          if (isSpelling(m) && dict.has(word.toLowerCase())) continue;
          all.push(Object.assign({}, m, {
            offset: item.p.start + m.offset,
            context: word,
            lang: item.lang,
          }));
        }
      });
      all.sort((a, b) => a.offset - b.offset);
      result.matches = all;
      if (!result.supported && result.status === "ok") result.status = "unsupported";
      return result;
    }

    async _runBatch(batch, lt, level, settings, isStale) {
      const ok = await this.limiter.acquire(settings, isStale);
      if (!ok) return { status: "stale" };
      let server = normalizeServer(settings.ltServer);
      if (settings.ltApiKey && server === PUBLIC_SERVER) server = PREMIUM_SERVER;

      const body = new URLSearchParams();
      body.set("text", batch.text);
      body.set("language", lt);
      body.set("level", level);
      const mother = LexoLang.toLT(settings.defaultLanguage || "fr", settings.variants);
      if (mother && LexoLang.base(mother) !== LexoLang.base(lt)) body.set("motherTongue", mother);
      if (settings.ltUsername && settings.ltApiKey) {
        body.set("username", settings.ltUsername);
        body.set("apiKey", settings.ltApiKey);
      }
      const dis = (settings.disabledRules || []).filter((r) => !/^LEXO_/.test(r));
      if (dis.length) body.set("disabledRules", dis.join(","));

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(server + "/v2/check", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: body.toString(),
          signal: ctrl.signal,
          credentials: "omit",
        });
        if (res.status === 429) {
          this.limiter.pause(45000);
          return { status: "rate_limited", message: "rate_limited" };
        }
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          return { status: "error", message: `HTTP ${res.status} ${msg.slice(0, 120)}` };
        }
        const data = await res.json();
        const matches = (data.matches || []).map(normalizeMatch);
        return { status: "ok", per: LexoText.splitBatchMatches(batch, matches) };
      } catch (e) {
        return { status: "offline", message: e && e.name === "AbortError" ? "timeout" : String(e && e.message || e) };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const SEVERITY = { ok: 0, stale: 0, unsupported: 1, error: 2, rate_limited: 3, offline: 4 };
  function worst(a, b) { return (SEVERITY[b] || 0) > (SEVERITY[a] || 0) ? b : a; }

  function normalizeMatch(m) {
    const rule = m.rule || {};
    return {
      offset: m.offset,
      length: m.length,
      message: m.message || "",
      shortMessage: m.shortMessage || "",
      replacements: (m.replacements || []).slice(0, 6).map((r) => ({ value: r.value })),
      rule: {
        id: rule.id || "",
        description: rule.description || "",
        issueType: rule.issueType || "",
        category: { id: (rule.category && rule.category.id) || "", name: (rule.category && rule.category.name) || "" },
      },
      source: "lt",
    };
  }

  function isSpelling(m) {
    return m.rule.issueType === "misspelling" || /SPELL|MORFOLOGIK|HUNSPELL/i.test(m.rule.id);
  }

  /** Les erreurs du serveur priment ; on ajoute les locales sans chevauchement. */
  function mergeMatches(remote, local) {
    const out = remote.slice();
    for (const l of local) {
      const overlap = remote.some((r) => l.offset < r.offset + r.length && r.offset < l.offset + l.length);
      if (!overlap) out.push(l);
    }
    return out.sort((a, b) => a.offset - b.offset);
  }

  root.LexoChecker = { Checker, detectLanguage, normalizeServer, mergeMatches, isSpelling, LRU };
  if (typeof module !== "undefined" && module.exports) module.exports = root.LexoChecker;
})(typeof globalThis !== "undefined" ? globalThis : this);
