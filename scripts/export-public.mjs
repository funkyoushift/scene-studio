// A fresh, allowlisted source export for the public repository. This does not
// copy Git history, publish anything, deploy a Worker, or run GitHub Actions.
import { mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputs = path.join(root, "outputs");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out")) {
  throw new Error("Usage: node scripts/export-public.mjs [--out export-folder-name]");
}
const folder = args[1] ?? "scene-studio-public-20261025";
if (!/^[a-z0-9][a-z0-9._-]{0,90}$/i.test(folder) || folder.includes("..")) {
  throw new Error("Choose a single export folder name, not a path.");
}
const output = path.join(outputs, folder);
if (path.dirname(output) !== outputs) throw new Error("Export must stay inside outputs.");

const required = [
  'test-room.html','src/TestRoom.jsx','src/TestRoomControls.jsx','src/test-room-entry.jsx','src/test-room-client.mjs','src/test-room.css','server/test-room-service.mjs','server/tester-access.mjs','tests/test-room.test.mjs',
  // Reviewed external studio and stable player sources. No outputs or credentials.
  "server/card-catalog.mjs",
  "server/card-game-schema.sql",
  "server/card-game-service.mjs",
  "server/experience-schema.sql",
  "server/experience-service.mjs",
  "server/studio-schema.sql",
  "server/studio-service.mjs",
  "src/CardGame.jsx",
  "src/CardPlayer.jsx",
  "src/ExperiencePlayer.jsx",
  "src/ExperienceStudio.jsx",
  "src/Scene.jsx",
  "src/Viewer.jsx",
  "src/card-decks.mjs",
  "src/card-game.css",
  "src/card-game.mjs",
  "src/config-entry.jsx",
  "src/experience-builder.css",
  "src/experience-examples.mjs",
  "src/experience-media.mjs",
  "src/experience.mjs",
  "src/player-channel.mjs",
  "src/studio-client.mjs",
  "src/studio-entry.jsx",
  "src/studio.css",
  "src/viewer-entry.jsx",
  "tests/card-game-service.test.mjs",
  "tests/card-game.test.mjs",
  "tests/brb-maze.test.mjs", "scripts/build-brb-maze.mjs",
  "tests/experience-service.test.mjs",
  "tests/experience.test.mjs",
  "tests/fixtures/card-game-browser.html",
  "tests/fixtures/card-game-browser.jsx",
  "tests/fixtures/experience-browser.html",
  "tests/fixtures/experience-browser.jsx",
  "tests/studio.test.mjs",
  "scripts/sync-card-catalog.mjs",

  "server/presence-service.mjs", "server/presence-schema.sql", "tests/presence-service.test.mjs",
  "src/trivia-bank.mjs", "tests/trivia-bank.test.mjs",
  "src/trivia-categories.mjs", "src/trivia-open-data.json", "scripts/import-trivia-bank.py", "assets/trivia/SOURCES.md", "assets/trivia/LICENSE-CC-BY-SA-4.0.txt",
  "src/Shoutout.jsx", "src/ShoutoutControls.jsx", "src/shoutout.css", "src/shoutout-contract.mjs", "tests/shoutout-contract.test.mjs", "server/shoutout-service.mjs", "server/shoutout-schema.sql", "tests/shoutout-service.test.mjs",
  "src/draft-workspace.mjs", "tests/draft-workspace.test.mjs",
  "src/hype-audio.mjs", "tests/hype-audio.test.mjs",
  "src/sounds.mjs", "src/sound-address.mjs", "src/sound-contract.mjs", "server/sound-service.mjs", "server/sound-schema.sql", "tests/sounds.test.mjs", "tests/sound-service.test.mjs",
  "package.json", "package-lock.json", "vite.config.js",
  "index.html", "config.html", "viewer.html", "automations.html", "mobile.html",
  "src/image-address.mjs", "src/images.mjs", "src/main.jsx", "src/party.mjs",
  "src/scene.mjs", "src/style.css", "src/templates.mjs", "src/twitch.mjs",
  "src/AutomationStudio.jsx", "src/DeveloperPanel.jsx", "src/automation-entry.jsx",
  "src/automations.css", "src/automations.mjs",
  "src/AutomationViewer.jsx", "src/automation-twitch.mjs",
  "src/Celebration.jsx", "src/celebration.css", "src/HypeTrain.jsx", "src/hype-train.css", "src/hype-state.mjs", "server/hype-schema.sql", "tests/hype-state.test.mjs",
  "src/CelebrationAudio.jsx", "src/celebration-audio.mjs", "tests/celebration-audio.test.mjs",
  "src/FlowBuilder.jsx", "src/flows.css", "src/live-flows.mjs", "src/live-context.mjs",
  "src/ThemeToggle.jsx", "src/editor-theme.mjs", "tests/editor-theme.test.mjs", "tests/live-context.test.mjs",
  "src/MobileViewer.jsx", "src/mobile-entry.jsx", "src/mobile.css",
  "src/experience-preview.mjs", "tests/experience-preview.test.mjs",
  "src/PopupPlacement.jsx", "src/popup-placement.css",
  "src/ExperienceHome.jsx", "src/experience-home.css", "src/experience-presets.mjs", "tests/experience-presets.test.mjs",
  "src/StarterLibrary.jsx", "src/starter-library.css", "src/InteractiveWidgets.jsx", "src/widgets.css",
  "server/chat-authorization.mjs", "server/image-worker.mjs",
  "server/party-service.mjs", "server/public-pages.mjs", "server/schema.sql",
  "server/developer-service.mjs", "server/developer-schema.sql",
  "server/automation-service.mjs", "server/automation-schema.sql", "server/chat-triggers.mjs", "server/chat-triggers-schema.sql",
  "server/twitch-events.mjs", "server/twitch-events-schema.sql", "tests/twitch-events.test.mjs",
  "tests/chat-authorization.test.mjs", "tests/chat-ui.test.mjs",
  "tests/image-client.test.mjs", "tests/images.test.mjs", "tests/party.test.mjs",
  "tests/scene.test.mjs", "tests/templates.test.mjs", "tests/twitch.test.mjs",
  "tests/mobile-viewer.test.mjs", "tests/mobile-mounted.test.mjs",
  "tests/fixtures/mobile-mounted.html", "tests/fixtures/mobile-mounted.jsx",
  "tests/automations.test.mjs",
  "tests/automation-service.test.mjs", "tests/automation-twitch.test.mjs", "tests/automation-router.test.mjs", "tests/chat-triggers.test.mjs",
  "tests/developer-service.test.mjs", "tests/developer-router.test.mjs",
  "scripts/cloudflare.mjs", "scripts/make-branding.mjs", "scripts/migrate-automation-capacity.mjs", "tests/automation-capacity-migration.test.mjs",
  "scripts/make-channel-designs.mjs", "scripts/package-twitch.ps1",
  "scripts/build-prototype.mjs", "scripts/build-pages.mjs", "scripts/export-public.mjs",
  "assets/branding/discovery-300x200.png", "assets/branding/discovery.svg",
  "assets/branding/icon-100.png", "assets/branding/icon-24.png",
  "assets/branding/icon-300.png", "assets/branding/icon-512.png",
  "assets/branding/mark.svg", "assets/merch/SOURCES.md", "assets/merch/hoodie.png",
  "assets/merch/mug.png", "assets/merch/shirt.png",
  "designs/funkyourev-party.json", "designs/funkyoushift-merch-preview.json",
];
const optional = ["scripts/developer-bridge.mjs", "tests/developer-bridge.test.mjs"];
const selected = [...required];
for (const file of optional) {
  try { await lstat(path.join(root, file)); selected.push(file); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

// Refuse to silently omit a newly added source dependency or test. Deliberately
// extend the list above when a new file is ready to be published.
async function filesBelow(relative) {
  const found = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await filesBelow(name));
    else found.push(name);
  }
  return found;
}
const allowed = new Set(selected);
for (const directory of ["src", "tests"]) {
  for (const file of await filesBelow(directory)) {
    if (!allowed.has(file)) throw new Error(`Source file needs explicit export approval: ${file}`);
  }
}

const source = new Map();
for (const file of selected) {
  if (!(await lstat(path.join(root, file))).isFile()) throw new Error(`Not a regular file: ${file}`);
  source.set(file, await readFile(path.join(root, file)));
}
const packageJson = JSON.parse(source.get("package.json").toString("utf8"));
if (packageJson.scripts?.["build:pages"] !== "node scripts/build-pages.mjs") {
  throw new Error("Wait for the complete build:pages script before exporting.");
}

const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
const configKeys = new Set(["$schema", "name", "main", "account_id", "compatibility_date", "workers_dev", "preview_urls", "observability", "triggers", "vars", "d1_databases", "assets", "r2_buckets"]);
const varKeys = new Set(["TEST_ROOMS_RELEASED", "STUDIO_ENABLED", "STUDIO_ORIGIN", "STUDIO_URL", "CARD_GAMES_ENABLED", "EXPERIENCES_ENABLED", "PUBLIC_EXPERIENCES", "PUBLIC_PAGES", "PUBLIC_IMAGES", "PUBLIC_CHAT", "TWITCH_CHAT_CLIENT_ID", "EXTENSION_ORIGIN", "PUBLIC_SERVICE_URL", "TEST_CHANNELS", "TEST_STREAMER_LOGINS", "PARTY_CHANNELS", "PARTY_TEST_VIEWERS", "EXTENSION_CLIENT_ID", "EXTENSION_OWNER", "EXTENSION_VERSION", "ALLOWED_EXTENSION_VERSIONS", "DEVELOPER_API_ENABLED", "AUTOMATIONS_ENABLED", "CHAT_TRIGGERS_ENABLED", "TWITCH_ACTIVITY_ENABLED", "TWITCH_PRESENCE_ENABLED", "MERCH_TEST_STORES", "POPUP_TEST_LINKS"]);
for (const key of Object.keys(config)) {
  if (!configKeys.has(key)) throw new Error(`Wrangler setting needs explicit export approval: ${key}`);
}
for (const key of Object.keys(config.vars ?? {})) {
  if (!varKeys.has(key)) throw new Error(`Wrangler variable needs explicit export approval: ${key}`);
}
if (config.d1_databases?.length !== 1) throw new Error("Review changed database bindings before export.");
for (const key of Object.keys(config.d1_databases[0])) {
  if (!["binding", "database_name", "database_id"].includes(key)) throw new Error(`Database setting needs explicit export approval: ${key}`);
}
config.account_id = "REPLACE_WITH_YOUR_CLOUDFLARE_ACCOUNT_ID";
config.d1_databases[0].database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID";
Object.assign(config.vars, {
  STUDIO_ENABLED: "false", STUDIO_ORIGIN:"https://YOUR_GITHUB_PAGES_HOST", STUDIO_URL:"https://YOUR_GITHUB_PAGES_HOST/scene-studio/",
  CARD_GAMES_ENABLED:"false", EXPERIENCES_ENABLED:"false", PUBLIC_EXPERIENCES:"false",
  PUBLIC_CHAT: "false", PUBLIC_IMAGES: "false", PUBLIC_PAGES: "false",
  DEVELOPER_API_ENABLED: "false", AUTOMATIONS_ENABLED: "false", CHAT_TRIGGERS_ENABLED: "false", TWITCH_ACTIVITY_ENABLED: "false", TWITCH_PRESENCE_ENABLED: "false", MERCH_TEST_STORES: "{}", POPUP_TEST_LINKS: "{}",
  TWITCH_CHAT_CLIENT_ID: "REPLACE_WITH_YOUR_TWITCH_CHAT_CLIENT_ID",
  EXTENSION_CLIENT_ID: "REPLACE_WITH_YOUR_EXTENSION_CLIENT_ID",
  EXTENSION_OWNER: "REPLACE_WITH_YOUR_TWITCH_USER_ID",
  EXTENSION_ORIGIN: "https://REPLACE_WITH_YOUR_EXTENSION_CLIENT_ID.ext-twitch.tv",
  PUBLIC_SERVICE_URL: "https://REPLACE_WITH_YOUR_WORKER_HOST.workers.dev",
  TEST_CHANNELS: "", TEST_STREAMER_LOGINS: "", PARTY_CHANNELS: "", PARTY_TEST_VIEWERS: "{}",
});

const generated = new Map();
generated.set("wrangler.jsonc", `${JSON.stringify(config, null, 2)}\n`);
generated.set(".gitignore", `node_modules/\ndist/\nsite-dist/\noutputs/\n.wrangler/\n.env*\n.dev.vars*\n!.env.example\n.codex-remote-attachments/\nserver/env.d.ts\n`);
generated.set("README.md", `# Scene Studio

One Twitch extension. A different interactive experience for every channel.

## External studio and stable player (November 1, 2026)

Setup, Build with AI, uploads, deck selection and game controls now live on this
GitHub Pages website. Sign in with the channel owner's Twitch account. The
Cloudflare service imports the existing saved scene and stores revisioned
publications with a 20-revision rollback history. The viewer package fetches
validated channel data; supported scene, media, maze and rule changes do not
require a new Twitch package. New rendering capabilities still require a package
update. OAuth credentials never enter this public repository or viewer package.

The next test package is 0.8.0. Historical test notes below are not verification
of this migration. Hosted Test still requires approved viewer testers.

Build the website with \`npm run build:pages\`; build only the Twitch player and
small setup link with \`npm run build\`. Server setup additionally requires the
SQL schemas in server/, private R2 storage, the extension secret and the Twitch
OAuth client secret. The checked-in Worker config is a disabled template.


[Open the hosted builder](https://funkyoushift.github.io/scene-studio/)

Scene Studio lets streamers place their own images, words, and clickable objects
over a Twitch player without developing and publishing an extension themselves.
The public builder runs as a static website on GitHub Pages: opening and editing
designs does not depend on the creator's PC staying on. Scene Studio supplies
the hosted API; streamers do not create an API or arrange server hosting.
Optional Twitch event sources need Twitch permission, not infrastructure setup.

## Build something of your own

Start with a welcome layout, an image showcase, channel information, a mystery,
or a party. Edit words, upload an image into the preview, drag objects, and try
the viewer experience before saving. Import/export produces validated design
data. Undo restores previous edits. Supported objects include cards, photo
showcases, round buttons, pills and image-only stickers.

The optional AI flow prepares a structured prompt for the streamer's own AI
account. Scene Studio does not require an AI API key or make paid AI calls.

## Optional chat arrival shoutouts

The current source adds a joins-chat choice alongside first-message and moderator
command shoutouts. Arrival detection uses the hosted Get Chatters poller and
requires explicit moderator:read:chatters consent. It establishes a silent
initial baseline, checks partner/affiliate filters and moderation, and prevents
repeat automatic shoutouts within a stream. Detection may be delayed. This new
path has automated coverage; it has not yet been observed with real arrivals.

## Status: distinguish the submitted extension from experiments

Last verified portal status: 0.4.0 In Review (October 26); 0.5.0 Hosted Test
(October 27). Version 0.1.0 was withdrawn to Local Test. Neither later version
is confirmed publicly approved. This export includes the 0.5 sound controls;
the public website and queued 0.4 package may differ. Recheck portal status
before installation. The following paragraphs describe historical test evidence.
Two test channels demonstrated
independent saved layouts, custom hosted images, live configuration updates,
creator attribution, and shared silent celebrations with preset chat messages.
Optional broadcaster moderation authorization and disconnect/reconnect recovery
were tested live. Ban/timeout denial and token-refresh races have automated
coverage, not equivalent live qualification. The broadcaster manually confirmed
that the hosted Choose image control opens Windows' file picker.

The submitted version supports reveals, personal reactions and celebrations,
and optional shared chat. Viewers share Twitch identity for shared chat; the
streamer connects read-only moderation access. Channel bans, timeouts and
cooldowns apply. Ordinary viewing and personal effects do not require identity
sharing. Existing image and chat services run on Cloudflare, not a local PC.

Version 0.3 implements channel-owned carousel and celebration rules, authenticated
publishing and manual effects, Twitch viewer broadcasts, hosted timers and optional
real chat-keyword input through EventSub. Its Cloudflare backend is deployed and
its package was tested as Overlay 1 on Shift before the 0.4 upgrade below. The
actual hosted editor published automation revision 1 and uploaded three images.
Shift completed optional trigger OAuth and its listener is enabled. In the actual
live Twitch player, the carousel rendered, Next showed the shirt as item 2 of 3,
the configured product destination was verified, and dismissal worked. Both actual
merch/party chat-triggered viewer effects and the scheduled carousel were later
observed in the live Twitch player. This does not establish purchase completion.
Rev also completed its four-scope
trigger authorization and has an enabled listener, while remaining on active
0.1 at that checkpoint. Browser test
messages/events remain simulations; simulation is not live integration evidence.

Real chat input requires separate optional broadcaster authorization for
moderation:read, user:read:chat, user:bot and channel:bot and an enabled listener.
No chat-write scope is added. Moderation checks gate shared effects; raw chat text
is not stored, and trigger receipt IDs/timestamps/status expire after 24 hours.
Hosted timers use minute scheduling and require intervals of at least 60 seconds.
The rule editor supports file import and a JSON-paste alternative. These hosted
paths do not require the creator's PC to stay on. GitHub Actions runs the current
test suite and production build; inspect the latest successful run for its exact
counts. Automated coverage is distinct from observed player delivery.

The newer authoring workspace adds dark/light themes and named flow pages with
When, Do, Look and Try steps. Pages can be renamed or created for any channel
purpose. Rules can rotate or randomly select supported carousel/celebration
responses. Optional carousel layout stores percentage placement and layer order.
Subscriber and Hype Train text can use {subscriber} and {hypeLevel}; authenticated
event context is broadcast transiently and is never retained in delivery receipts.
The Game HUD page is an authoring entry point, not a connected Borderlands adapter.
Uploaded sound playback, duration, repeat count, action-length looping and
Hype level sound changes are included in this source. Viewers must enable audio.
Arbitrary local/network integrations are not enabled features.

Version 0.4 source adds none, float, pulse and sway object motion presets. Browser
checks confirmed preview motion, dragging without changing object size, and the
reduced-motion setting disabling animation. Animated GIF uploads still become
still images; uploaded video and actual game integration are not implemented.

A lean mobile.html viewer is included in 0.4. Browser fixtures at portrait,
narrow and wide sizes showed no horizontal overflow and 44px buttons.
Twitch accepted the original 0.4 package in Hosted Test with
mobile.html configured, and confirmed Shift's activation in Overlay 1. Its hosted
configuration loaded two existing objects; publishing float motion reported Sent
to Twitch. After reloading and accepting Twitch's test disclosure, both saved
objects appeared in the actual 0.4 desktop viewer. The first retained its float
motion class; the operating system's reduced-motion preference correctly disabled
animation. An authorized merch chat message again displayed the live carousel.
Actual Android Twitch testing confirmed panel loading and reveal taps, but
personal celebration and incoming carousel failed in that original mobile build.
The repair removes personal celebration's randomUUID dependency, retains secure
shared-action IDs, and adds visible configuration errors/reconnect controls.
One authenticated catch-up request on mobile mount/return fetches only an
unexpired confirmed event for the current configuration revision. It does not poll.
The repair backend is deployed and replacement ZIP uploaded; Hosted Test
is restored and native retesting remains pending. A mounted browser fixture recovered
the carousel after hide/broadcast/return, showed a failed-configuration error, and
reconnected after service restoration. Browser fixtures
are not native mobile proof. Rev stayed on active 0.1 at that checkpoint.

On the hosted site, the developer panel provides a roadmap and event simulation
without contacting localhost. No real game integration is claimed.
An optional local developer bridge is included as source for developers;
GitHub Pages cannot run a Node server. The hosted builder does not need that
bridge for design work. No hosted developer API is enabled by this source export.

The server/developer-service.mjs and server/developer-schema.sql files provide a
source-only cloud API foundation, with tests for scoped keys, event receipts and
state. Its schema has not been applied to the live service, and its route remains
disabled. An accepted event returns status "accepted-not-delivered" with
delivered: false; saved state also reports delivered: false. These receipts do
not mean a viewer received an event, an overlay changed, or a game acted on it.
Schema application, enabled routes and viewer delivery require separate work
and qualification; publishing these sources does not perform those steps.

The FunkYouSHiFT merch example contains actual product photos and Streamlabs
destinations. Website/checkout objects remain preview-only in the submitted
0.1 extension and its main editor. A separate narrow configured own-merch test
exists in 0.3 automations; it is not general commerce approval or verified live
checkout. This export disables that test mapping by default. See
assets/merch/SOURCES.md for image origins.

## Run or inspect the source

Use Node.js 26.3 or newer and npm.

\`\`\`sh
npm ci
npm test
npm run dev
\`\`\`

The local editor opens at http://127.0.0.1:5186. The hosted build is:

\`\`\`sh
npm run build:pages
\`\`\`

It writes site-dist. The GitHub Actions workflow tests and builds that directory,
then deploys it to Pages. Enable GitHub Actions as the repository's Pages source.
No Cloudflare or Twitch secret is needed to build or deploy the static site.

## Deploy your own Twitch and cloud services

The checked-in Wrangler configuration is intentionally sanitized and disabled.
Replace its placeholder account, database, channel and application IDs. Create
your own D1 database and apply server/schema.sql. Store EXTENSION_SECRET and,
for optional moderated chat, TWITCH_CHAT_CLIENT_SECRET as encrypted Worker
secrets; never place them in frontend code or commit them.

Change IMAGE_ORIGIN in src/image-address.mjs and the Twitch extension's image/
fetch allowlists to your service. The source retains the submitted public service
URL for inspection; that URL contains no credential and grants no channel access.
Configure your confidential Twitch app's redirect to your Worker /chat/callback.
Review the public notice text for your own operator and data practices before
enabling PUBLIC_PAGES, PUBLIC_IMAGES or PUBLIC_CHAT. Qualify your hosted flows
before enabling wider access. GitHub Pages hosts only the frontend; authenticated
uploads, token handling and chat checks belong in the backend.

For your own Workers account, these are the concrete setup commands after npm ci.
Start with the sanitized flags disabled and fill in your own account/database IDs
and Twitch application values before deploying. Never use another operator's IDs
or credentials. Create the D1 database once, then copy its returned ID into config:

    node scripts/cloudflare.mjs login
    node scripts/cloudflare.mjs d1 create scene-studio-images
    node scripts/cloudflare.mjs d1 execute scene-studio-images --remote --file server/schema.sql
    node scripts/cloudflare.mjs d1 execute scene-studio-images --remote --file server/automation-schema.sql
    node scripts/cloudflare.mjs d1 execute scene-studio-images --remote --file server/hype-schema.sql
    node scripts/cloudflare.mjs d1 execute scene-studio-images --remote --file server/sound-schema.sql
    node scripts/cloudflare.mjs d1 execute scene-studio-images --remote --file server/shoutout-schema.sql
    node scripts/cloudflare.mjs d1 execute scene-studio-images --remote --file server/chat-triggers-schema.sql
    node scripts/cloudflare.mjs deploy
    node scripts/cloudflare.mjs secret put EXTENSION_SECRET
    node scripts/cloudflare.mjs secret put TWITCH_CHAT_CLIENT_SECRET

EXTENSION_SECRET is your own base64 Twitch Extension secret. The optional chat
secret belongs to your own confidential Twitch OAuth app. Then enable only the
features you configured and redeploy with node scripts/cloudflare.mjs deploy.
Connect the broadcaster through the editor's separate chat/event authorization
buttons. Hype Train events use version 2; resubscriptions are shared resub messages.
Use Twitch Local Test/Hosted Test for your own development channel; approval of
Scene Studio's listed extension is still required for its general installation.
Command reference: https://developers.cloudflare.com/d1/wrangler-commands/ .

For a separate Twitch package, choose a new unsubmitted version and set
VITE_EXTENSION_VERSION before building. Pass that same value to the mandatory
-Version argument of scripts/package-twitch.ps1. For example, in PowerShell:

\`\`\`powershell
$env:VITE_EXTENSION_VERSION = '0.2.0'
npm run build
./scripts/package-twitch.ps1 -Version '0.2.0'
Remove-Item Env:VITE_EXTENSION_VERSION
\`\`\`

Use your chosen version consistently in the compiled frontend, ZIP filename,
Twitch version and backend ALLOWED_EXTENSION_VERSIONS. That nonsecret backend
allowlist is retained in this export for inspection; qualify the versions before
enabling them. Naming a ZIP does not rewrite its compiled version. The packaging
script refuses an existing ZIP. Publishing Pages does not update the version
already submitted to Twitch; preserve the queued 0.4.0 package.

## Boundaries

The current model limits scenes to 12 objects and Twitch configuration to 5,000
bytes. Hosting has bounded prototype capacity, including 48 images per channel,
1,000 images total and 100 optional chat connections. These are not promises of
unlimited free hosting. Personal reaction counts are per viewer, not global polls.
No arbitrary uploaded JavaScript executes inside the Twitch extension.

PUBLIC-SOURCE-MANIFEST.json lists this exported source snapshot. Private working
notes, credentials, private attachments, browser screenshots and Git history are
excluded. Product and branding assets remain their owners' materials; no additional
license grant is implied by publishing this source snapshot.
`);

// Official GitHub Pages workflow versions checked against GitHub Docs and
// actions/setup-node README on October 25, 2026. No personal token is required.
generated.set(".github/workflows/pages.yml", `name: Publish Scene Studio Pages

on:
  push:
    branches: [main, master]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: github-pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: '26.3.0'
          package-manager-cache: false
      - name: Install dependencies
        run: npm ci --ignore-scripts --no-audit --no-fund
      - name: Test
        run: npm test
      - uses: actions/configure-pages@v5
      - name: Build static site
        run: npm run build:pages
      - uses: actions/upload-pages-artifact@v4
        with:
          path: site-dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`);

const outputFiles = new Map([...source, ...[...generated].map(([file, text]) => [file, Buffer.from(text)])]);
const patterns = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["openai-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ["aws-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];
const secretHits = [];
const forbiddenPath = /(?:^|\/)(?:\.git|\.wrangler|node_modules|dist|site-dist|outputs|\.codex-remote-attachments)(?:\/|$)|(?:^|\/)(?:HANDOFF\.md|\.env[^/]*|\.dev\.vars[^/]*)$/i;
for (const [file, bytes] of outputFiles) {
  if (forbiddenPath.test(file)) throw new Error(`Forbidden export path: ${file}`);
  if (/\.(?:png|jpg|jpeg|gif|webp|woff2?)$/i.test(file)) continue;
  const text = bytes.toString("utf8");
  for (const [kind, pattern] of patterns) if (pattern.test(text)) secretHits.push({ file, kind });
}
if (secretHits.length) {
  // Only metadata leaves this scan; credential values are never printed.
  throw new Error(`Possible credential material; export stopped: ${JSON.stringify(secretHits)}`);
}

await mkdir(outputs, { recursive: true });
await mkdir(output); // Never overwrite an existing repository/export.
for (const [file, content] of outputFiles) {
  await mkdir(path.dirname(path.join(output, file)), { recursive: true });
  await writeFile(path.join(output, file), content);
}
for (const [file, content] of source) {
  if (!(await readFile(path.join(root, file))).equals(content)) {
    throw new Error(`Source changed during export; do not publish this folder: ${file}`);
  }
}
const manifest = {
  format: 1, createdUtc: new Date().toISOString(),
  snapshot: "Current 0.5 development source; separate from the queued Twitch 0.4.0 package. Portal status last verified October 27, 2026.",
  generated: [...generated.keys()],
  files: [...outputFiles].sort(([a], [b]) => a.localeCompare(b)).map(([file, content]) => ({
    path: file, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex"),
  })),
  scan: { copiedGitHistory: false, credentialPatternHits: 0,
    note: "Bounded pattern scan plus explicit allowlist; not a complete security audit." },
};
await writeFile(path.join(output, "PUBLIC-SOURCE-MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, sourceFiles: source.size, generatedFiles: generated.size,
  totalFiles: outputFiles.size + 1, credentialPatternHits: 0,
  next: "Inspect and test this export before publishing. No remote action was performed." }, null, 2));
