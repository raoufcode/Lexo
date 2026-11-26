<p align="center">
  <img src="icons/logo-256.png" width="96" alt="Lexo">
</p>

<h1 align="center">Lexo</h1>

<p align="center">
  Correcteur d'orthographe, de grammaire et de style <b>en temps réel</b>, avec <b>détection automatique de la langue</b> et <b>reformulations</b>, pour <b>Google Chrome</b> et <b>Firefox</b>.
</p>

---

## Ce que fait Lexo

- **Souligne vos fautes pendant que vous tapez**, dans tous les champs de texte du web : `textarea`, champs `input`, éditeurs riches `contenteditable` (Gmail, Outlook Web, LinkedIn, WordPress, Notion, réseaux sociaux…).
  - rouge : orthographe / faute de frappe
  - orange : grammaire, accords, conjugaison
  - violet : typographie et ponctuation
  - bleu : style
- **Corrige en un clic** : survolez ou cliquez sur un mot souligné, choisissez la suggestion. Le **Ctrl+Z** du site continue de fonctionner.
- **Détecte la langue automatiquement**, y compris paragraphe par paragraphe dans un texte qui mélange les langues (30 langues prises en charge : français, anglais, espagnol, allemand, italien, portugais, néerlandais, arabe, russe, ukrainien, polonais…). Le **français est la langue par défaut** quand la détection hésite (texte très court).
- **Propose de meilleures formulations**, **gratuitement** : version corrigée + 3 reformulations dans le ton choisi (naturel, formel, amical, concis, développé, convaincant), à appliquer en un clic. Services au choix : Google Gemini (clé gratuite), Ollama (IA locale gratuite), IA intégrée à Chrome, ou Claude (payant, facultatif).
- **Badge** en bas à droite du champ : nombre de suggestions, langue détectée, état (vérification en cours, hors ligne…). Un clic ouvre le **panneau** : liste des corrections, « Tout corriger », reformulation, changement de langue.
- **Dictionnaire personnel**, règles désactivables, désactivation par site, mode « exigeant ».
- Interface **en français par défaut** (anglais disponible), thème clair et sombre.

### Raccourcis

| Raccourci | Action |
|---|---|
| `Alt+Maj+L` | Ouvrir / fermer le panneau Lexo du champ actif |
| `Alt+Maj+R` | Reformuler la sélection (ou le paragraphe du curseur) |
| `Échap` | Fermer la carte ou le panneau |
| Clic droit → *Lexo : reformuler la sélection* | Reformuler n'importe quel texte sélectionné, même hors d'un champ |

## Installation

### Google Chrome (et Edge, Brave, Opera…)

1. Téléchargez ou clonez ce dépôt.
2. Ouvrez `chrome://extensions`, activez le **Mode développeur** (en haut à droite).
3. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier du dépôt.

### Firefox (version 121 ou plus récente)

1. Ouvrez `about:debugging#/runtime/this-firefox`.
2. Cliquez sur **Charger un module complémentaire temporaire…** et choisissez le fichier `manifest.json` du dépôt.
3. Si Firefox le demande, autorisez Lexo à accéder aux sites (bouton *Autoriser* dans la fenêtre de Lexo).

> Pour une installation permanente sur Firefox, l'extension doit être signée par Mozilla (dépôt sur addons.mozilla.org, éventuellement en mode « non listé »). `npm run package` produit les archives prêtes à envoyer.

### Activer les reformulations gratuites (facultatif)

Les corrections fonctionnent sans configuration. Sans service d'IA, l'onglet *Reformuler* propose déjà la **version corrigée**. Pour obtenir aussi des **reformulations**, choisissez l'une de ces options gratuites dans **Réglages de Lexo → Reformulations** :

**Option 1 — Google Gemini (gratuit, 2 minutes, sans carte bancaire)**
1. Ouvrez [aistudio.google.com/apikey](https://aistudio.google.com/apikey) avec un compte Google.
2. Cliquez sur **Create API key** et copiez la clé (`AIza…`).
3. Collez-la dans *Clé API Gemini*, puis cliquez sur **Tester**.

> Avec le palier gratuit, Google peut utiliser les textes envoyés pour améliorer ses produits, et le nombre de requêtes par minute et par jour est limité.

**Option 2 — Ollama (gratuit, 100 % privé, fonctionne hors ligne)**
1. Installez [Ollama](https://ollama.com/download) sur votre ordinateur.
2. Dans un terminal : `ollama pull mistral` (environ 4 Go ; modèle performant en français).
3. Laissez Ollama lancé, puis cliquez sur **Tester** dans les réglages de Lexo.

> Si le test indique qu'Ollama refuse la connexion, définissez la variable d'environnement `OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*` puis relancez Ollama. Il faut un ordinateur avec au moins 8 Go de mémoire.

**Option 3 — IA intégrée à Chrome** : sur les versions récentes de Chrome et les ordinateurs compatibles, Lexo utilise automatiquement le modèle intégré au navigateur (Gemini Nano), sans clé ni réseau, s'il est déjà téléchargé et prend en charge la langue du texte.

En mode **Automatique** (par défaut), Lexo utilise le premier service prêt : IA de Chrome → Gemini → Ollama → Claude. Si l'un échoue (quota atteint…), il passe au suivant.

*Claude (Anthropic)* reste disponible comme option **payante** dans la même section.

## Comment ça marche

```
 Page web (content script)                          Arrière-plan (service worker / page d'événements)
 ┌──────────────────────────────┐   message       ┌─────────────────────────────────────────────┐
 │ suivi du champ actif         │ ─────────────▶ │ détection de langue (navigateur + mots-outils)│
 │ recalage instantané pendant  │                 │ découpage en paragraphes + cache LRU        │
 │   la frappe (diff)           │ ◀───────────── │ lots par langue → LanguageTool (/v2/check)  │
 │ soulignements, carte, badge, │   erreurs       │ limiteur de débit, abandon des requêtes     │
 │   panneau (Shadow DOM fermé) │                 │   périmées, règles locales hors ligne       │
 └──────────────────────────────┘                 │ reformulations → Gemini, Ollama, Chrome,    │
                                                  │   Claude (au choix, repli automatique)      │
                                                  └─────────────────────────────────────────────┘
```

Ce qui rend Lexo fluide et robuste :

- **Aucune attente visible** : les soulignements suivent la frappe immédiatement (recalage local par différence de texte) ; le serveur n'est interrogé qu'après une courte pause (450 ms par défaut, réglable) et au plus toutes les 2,5 s pendant une frappe continue.
- **Seuls les paragraphes modifiés sont revérifiés** (cache par paragraphe) : même un long e-mail reste instantané.
- **Les réponses périmées sont ignorées** : si vous tapez pendant une vérification, le résultat est recalé sur le texte actuel ou abandonné.
- **Respect des limites du serveur public** (file d'attente, pause automatique en cas de 429).
- **Hors ligne**, des règles locales prudentes continuent de fonctionner (mots répétés, espaces doubles, espace avant la ponctuation, majuscule en début de phrase).
- **Isolation totale** : l'interface vit dans un Shadow DOM fermé — aucun conflit de styles, et le site ne peut pas la modifier.
- **Champs sensibles ignorés** : mots de passe, e-mails, numéros, codes à usage unique, éditeurs de code (CodeMirror, Monaco, Ace), et tout élément marqué `data-lexo="off"` ou `data-gramm="false"`.
- **Insertion compatible avec les frameworks** (React, Vue, Draft.js, ProseMirror…) via `execCommand('insertText')`, avec repli sur le setter natif + évènement `input`.
- **Mise à jour de l'extension** : les scripts déjà injectés se retirent proprement au lieu de produire des erreurs.

### Moteur de correction

Lexo utilise [LanguageTool](https://languagetool.org) :

- par défaut, le serveur public gratuit `https://api.languagetool.org` (limité à environ 20 requêtes/minute, ce que Lexo gère) ;
- un compte **LanguageTool Premium** (identifiant + clé API dans les réglages) ;
- ou **votre propre serveur**, pour une confidentialité totale et aucune limite :
  ```bash
  docker run -d -p 8081:8010 erikvl87/languagetool
  ```
  puis indiquez `http://localhost:8081` comme serveur dans les réglages.

## Confidentialité

- Le texte des champs est envoyé **uniquement** au serveur LanguageTool choisi, et au service de reformulation choisi **seulement** quand vous demandez une reformulation (avec Ollama ou l'IA de Chrome, rien ne quitte votre ordinateur).
- Vos clés API restent dans le stockage local du navigateur et ne sont envoyées qu'au service correspondant.
- Lexo ne collecte aucune donnée et n'a aucun serveur propre.

## Développement

```bash
npm install          # outils de développement (esbuild, SDK Anthropic)
npm test             # tests unitaires (Node)
npm run test:e2e     # tests de bout en bout : charge l'extension dans Chromium (Playwright)
npm run package      # dist/lexo-chrome-<version>.zip et dist/lexo-firefox-<version>.zip
npm run lint:firefox # validation Mozilla (web-ext lint)
npm run build:vendor # régénère vendor/anthropic-sdk.js à partir du SDK officiel
```

Les tests de bout en bout utilisent un faux serveur LanguageTool local (`tests/e2e/server.js`) ; `node tests/e2e/server.js` le lance aussi seul sur `http://127.0.0.1:8099` avec une page de test.

### Structure

```
manifest.json            Manifest V3 commun Chrome + Firefox
src/shared/              Modules sans DOM : langues, texte, règles locales, réglages, traductions
src/background/          Moteur de vérification, reformulation (Gemini, Ollama, Chrome, Claude), routage
src/content/             Adaptateurs de champs, interface (Shadow DOM), contrôleur
src/popup/, src/options/ Fenêtre de l'icône et page des réglages
vendor/anthropic-sdk.js  SDK officiel Anthropic empaqueté (généré par npm run build:vendor)
tests/unit/, tests/e2e/  Tests
```

Pas d'étape de compilation : le dépôt se charge tel quel dans le navigateur.

## Limites connues

- **Google Docs** et les éditeurs qui dessinent le texte dans un `<canvas>` ne sont pas pris en charge.
- Les champs dans des `<iframe>` d'un autre domaine sont gérés par leur propre instance de Lexo (comportement normal).
- Le serveur public LanguageTool limite le volume ; pour un usage intensif, utilisez un compte Premium ou un serveur personnel.
