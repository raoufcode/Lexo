// Environnement minimal « navigateur » pour charger les scripts de l'arrière-plan sous Node.
const store = {};
globalThis.chrome = {
  runtime: { id: "test" },
  i18n: { detectLanguage: async () => ({ isReliable: false, languages: [] }), getMessage: () => "" },
  storage: {
    local: {
      get: async () => Object.assign({}, store),
      set: async (o) => Object.assign(store, o),
    },
    onChanged: { addListener() {} },
  },
};
require("../../src/shared/lang.js");
require("../../src/shared/text.js");
require("../../src/shared/rules.js");
require("../../src/shared/settings.js");
require("../../src/background/checker.js");
require("../../src/background/rephrase.js");
module.exports = globalThis;
