// Test de bout en bout : charge l'extension dans Chromium et vérifie le
// parcours complet (soulignement, carte, correction, panneau, langue).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { chromium } = require("playwright");
const { start } = require("./server.js");

const EXT = path.resolve(__dirname, "../..");
const SHOTS = process.env.LEXO_SHOTS || path.join(os.tmpdir(), "lexo-shots");

let ctx, srv, sw;

test.before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  srv = await start();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexo-profile-"));
  ctx = await chromium.launchPersistentContext(userDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1000, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate((url) => chrome.storage.local.set({ ltServer: url, debounceMs: 250 }), `http://127.0.0.1:${srv.port}`);
  // Ferme l'onglet d'accueil ouvert à l'installation.
  for (const p of ctx.pages()) if (p.url().includes("options.html")) await p.close();
});

test.after(async () => {
  await ctx?.close();
  srv?.server.close();
});

async function openPage() {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${srv.port}/`);
  await page.waitForFunction(() => window.document.documentElement && true);
  return page;
}

const underlines = (page) =>
  page.evaluate(() => {
    const host = document.querySelector("lexo-ui");
    if (!host || !host.shadowRoot) return [];
    return Array.from(host.shadowRoot.querySelectorAll(".u")).filter((u) => u.style.display !== "none")
      .map((u) => { const r = u.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top - 6, w: r.width, cls: u.className }; });
  });

async function waitUnderlines(page, n) {
  await page.waitForFunction((n) => {
    const host = document.querySelector("lexo-ui");
    if (!host || !host.shadowRoot) return false;
    return Array.from(host.shadowRoot.querySelectorAll(".u")).filter((u) => u.style.display !== "none").length === n;
  }, n, { timeout: 8000 });
  return underlines(page);
}

test("textarea : soulignement, carte et correction", async () => {
  const page = await openPage();
  await page.click("#ta");
  await page.keyboard.type("Bonjour, je suis aller au marcher hier soir avec mes amis.", { delay: 5 });
  const u = await waitUnderlines(page, 2);
  assert.ok(u.every((x) => x.w > 10), "les soulignements ont une largeur");
  assert.ok(u[0].cls.includes("t-spelling"));
  await page.screenshot({ path: path.join(SHOTS, "1-textarea-underlines.png") });

  // Survol du premier mot souligné -> carte
  await page.mouse.move(u[0].x, u[0].y);
  await page.waitForFunction(() => !!document.querySelector("lexo-ui").shadowRoot.querySelector(".card"), null, { timeout: 4000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, "2-card.png") });
  const card = await page.evaluate(() => document.querySelector("lexo-ui").shadowRoot.querySelector(".card").innerText);
  assert.match(card, /Orthographe/i);
  assert.match(card, /allé/);

  // Clic sur la suggestion
  const chip = await page.evaluateHandle(() => document.querySelector("lexo-ui").shadowRoot.querySelector(".card .chip"));
  await chip.click();
  assert.equal(await page.inputValue("#ta"), "Bonjour, je suis allé au marcher hier soir avec mes amis.");
  await waitUnderlines(page, 1);

  // Ctrl+Z annule la correction (pile d'annulation préservée)
  await page.keyboard.press("Control+z");
  assert.equal(await page.inputValue("#ta"), "Bonjour, je suis aller au marcher hier soir avec mes amis.");
  await page.close();
});

test("le soulignement suit la frappe sans attendre le serveur", async () => {
  const page = await openPage();
  await page.click("#ta");
  await page.keyboard.type("Je suis aller au marcher.", { delay: 5 });
  const before = await waitUnderlines(page, 2);
  await page.keyboard.press("Home");
  await page.keyboard.type("Hier, ");
  // immédiatement (sans réponse serveur), les soulignements se sont décalés
  const after = await underlines(page);
  assert.equal(after.length, 2);
  assert.ok(after[0].x > before[0].x + 20);
  await page.close();
});

test("contenteditable : panneau et « Tout corriger »", async () => {
  const page = await openPage();
  await page.click("#ce");
  await page.keyboard.type("Il y a une erreurr ici. Je suis aller au marcher.", { delay: 5 });
  await waitUnderlines(page, 3);
  // Ouvre le panneau avec le badge
  await page.evaluate(() => document.querySelector("lexo-ui").shadowRoot.querySelector(".badge").click());
  await page.waitForFunction(() => !!document.querySelector("lexo-ui").shadowRoot.querySelector(".panel"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, "3-panel.png") });
  const txt = await page.evaluate(() => document.querySelector("lexo-ui").shadowRoot.querySelector(".panel").innerText);
  assert.match(txt, /Corrections \(3\)/);
  assert.match(txt, /Français/);
  await page.evaluate(() => document.querySelector("lexo-ui").shadowRoot.querySelector('[data-a="all"]').click());
  await page.waitForFunction(() => document.querySelector("#ce").innerText.includes("erreur ici"));
  assert.equal((await page.innerText("#ce")).trim(), "Il y a une erreur ici. Je suis allé au marché.");
  await page.close();
});

test("contenteditable multi-paragraphes (type Gmail) : correction ciblée", async () => {
  const page = await openPage();
  await page.evaluate(() => {
    document.querySelector("#ce").innerHTML = "<div>Bonjour Marie,</div><div><br></div><div>Je suis <b>aller</b> au marcher ce matin.</div><div>À bientôt</div>";
  });
  await page.click("#ce");
  const u = await waitUnderlines(page, 2);
  await page.mouse.click(u[1].x, u[1].y + 4);
  await page.waitForFunction(() => !!document.querySelector("lexo-ui").shadowRoot.querySelector(".card"), null, { timeout: 4000 });
  const chip = await page.evaluateHandle(() => document.querySelector("lexo-ui").shadowRoot.querySelector(".card .chip"));
  await chip.click();
  await page.waitForFunction(() => document.querySelector("#ce").innerText.includes("marché"));
  const html = await page.innerHTML("#ce");
  assert.match(html, /<b>aller<\/b> au marché ce matin/);
  assert.match(html, /<div>Bonjour Marie,<\/div>/);
  await waitUnderlines(page, 1);
  await page.close();
});

test("détection automatique de l'anglais", async () => {
  const page = await openPage();
  srv.requests.length = 0;
  await page.click("#ta");
  await page.keyboard.type("I did not recieve the email you sent me yesterday about the project.", { delay: 3 });
  await waitUnderlines(page, 1);
  assert.ok(srv.requests.some((r) => r.language === "en-US"), JSON.stringify(srv.requests.map((r) => r.language)));
  await page.close();
});

test("input simple et champ mot de passe ignoré", async () => {
  const page = await openPage();
  await page.click("#inp");
  await page.keyboard.type("Je vais aller au marcher demain", { delay: 3 });
  await waitUnderlines(page, 2);
  await page.screenshot({ path: path.join(SHOTS, "4-input.png") });
  await page.click("#pwd");
  await page.keyboard.type("aller marcher");
  await page.waitForTimeout(800);
  assert.equal((await underlines(page)).length, 0);
  await page.close();
});

test("reformulation sans service d'IA : version corrigée + invitation gratuite", async () => {
  const page = await openPage();
  await page.click("#ta");
  await page.keyboard.type("Je suis aller au marcher hier.");
  await waitUnderlines(page, 2);
  await page.keyboard.press("Alt+Shift+R");
  await page.waitForFunction(() => {
    const p = document.querySelector("lexo-ui")?.shadowRoot?.querySelector(".panel");
    return p && /gratuites/i.test(p.innerText) && /allé au marché/.test(p.innerText);
  }, null, { timeout: 6000 }).catch(async (e) => {
    console.log("PANEL:", await page.evaluate(() => document.querySelector("lexo-ui")?.shadowRoot?.querySelector(".panel")?.innerText));
    throw e;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, "5-rephrase-free.png") });
  await page.close();
});

test("reformulation gratuite avec Ollama : proposer puis remplacer", async () => {
  await sw.evaluate((url) => chrome.storage.local.set({ ollamaUrl: url }), `http://127.0.0.1:${srv.port}`);
  try {
    const page = await openPage();
    await page.click("#ta");
    await page.keyboard.type("Je suis aller au marcher hier.");
    await page.keyboard.press("Alt+Shift+R");
    await page.waitForFunction(() => {
      const p = document.querySelector("lexo-ui")?.shadowRoot?.querySelector(".panel");
      return p && /Je me suis rendu au marché hier\./.test(p.innerText);
    }, null, { timeout: 8000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, "6-rephrase-ollama.png") });
    // « Remplacer » sous la variante « Formel » (2e bloc)
    await page.evaluate(() => document.querySelector("lexo-ui").shadowRoot.querySelectorAll('[data-a="use"]')[1].click());
    await page.waitForFunction(() => document.querySelector("#ta").value === "Je me suis rendu au marché hier.");
    await page.close();
  } finally {
    await sw.evaluate(() => chrome.storage.local.set({ ollamaUrl: "http://localhost:11434" }));
  }
});
