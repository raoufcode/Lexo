// Faux serveur LanguageTool + page de test, pour les tests de bout en bout.
const http = require("http");
const fs = require("fs");
const path = require("path");

const BAD = { aller: "allé", marcher: "marché", erreurr: "erreur", teh: "the", recieve: "receive", envoye: "envoyée", stete: "stète" };

// Corrections « intelligentes » renvoyées par le faux Ollama (relecture IA).
const AI_FIXES = {
  "JE co,stete que le mail na' pas éte envoye cotecteme,nt.": "Je constate que le mail n'a pas été envoyé correctement.",
};

function check(body) {
  const p = new URLSearchParams(body);
  const text = p.get("text") || "";
  const matches = [];
  for (const [w, fix] of Object.entries(BAD)) {
    const re = new RegExp("\\b" + w + "\\b", "g");
    let m;
    while ((m = re.exec(text))) {
      matches.push({
        offset: m.index, length: w.length, message: `« ${w} » : faute probable.`, shortMessage: "",
        replacements: [{ value: fix }, { value: fix + "s" }],
        rule: { id: "MOCK_SPELL", description: "", issueType: "misspelling", category: { id: "TYPOS", name: "Fautes" } },
      });
    }
  }
  return { language: { code: p.get("language") }, matches };
}

function start(port = 0) {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/v2/check")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const p = new URLSearchParams(body);
        requests.push({ language: p.get("language"), text: p.get("text") });
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(check(body)));
      });
      return;
    }
    // Faux Ollama (reformulations)
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "mistral:latest" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const p = JSON.parse(body);
        if (/proofreader/.test(p.messages[0].content)) {
          const paras = [...p.messages[1].content.matchAll(/<paragraph index="\d+">\n([\s\S]*?)\n<\/paragraph>/g)].map((m) => AI_FIXES[m[1]] || m[1]);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ model: p.model, message: { role: "assistant", content: JSON.stringify({ paragraphs: paras }) }, done: true }));
          return;
        }
        const text = (p.messages[1].content.match(/<text>\n([\s\S]*)\n<\/text>/) || [])[1] || "";
        const corrected = text.replace(/\baller\b/g, "allé").replace(/\bmarcher\b/g, "marché");
        const content = JSON.stringify({
          language: "fr", corrected, explanation: "Participe passé et nom corrigés.",
          suggestions: [
            { label: "Formel", text: "Je me suis rendu au marché hier." },
            { label: "Concis", text: "Hier, marché." },
            { label: "Amical", text: "Hier, j'ai fait un tour au marché !" },
          ],
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model: p.model, message: { role: "assistant", content }, done: true }));
      });
      return;
    }
    const file = path.join(__dirname, "page.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, requests })));
}

module.exports = { start };
if (require.main === module) start(8099).then(({ port }) => console.log("http://127.0.0.1:" + port));
