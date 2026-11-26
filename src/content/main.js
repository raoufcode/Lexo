/* Lexo — démarrage du script de page (une seule fois par document). */
(function (root) {
  "use strict";
  if (root.__lexoStarted) return;
  root.__lexoStarted = true;
  // Pas de correction dans les documents non HTML (XML, SVG, PDF...).
  if (!(document instanceof HTMLDocument) || !document.documentElement) return;
  const app = new root.LexoApp.App();
  app.start().catch((e) => console.warn("[Lexo]", e));
})(typeof globalThis !== "undefined" ? globalThis : this);
