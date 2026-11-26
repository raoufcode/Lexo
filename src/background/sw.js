/*
 * Chrome (service worker MV3) : charge les mêmes scripts que la page
 * d'arrière-plan de Firefox, dans le même ordre.
 */
importScripts(
  "/vendor/anthropic-sdk.js",
  "/src/shared/lang.js",
  "/src/shared/text.js",
  "/src/shared/rules.js",
  "/src/shared/settings.js",
  "/src/background/checker.js",
  "/src/background/rephrase.js",
  "/src/background/main.js"
);
