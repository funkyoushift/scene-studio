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
  "package.json", "package-lock.json", "vite.config.js",
  "index.html", "config.html", "viewer.html", "automations.html", "mobile.html",
  "src/image-address.mjs", "src/images.mjs", "src/main.jsx", "src/party.mjs",
  "src/scene.mjs", "src/style.css", "src/templates.mjs", "src/twitch.mjs",
  "src/AutomationStudio.jsx", "src/DeveloperPanel.jsx", "src/automation-entry.jsx",
  "src/automations.css", "src/automations.mjs",
  "src/AutomationViewer.jsx", "src/automation-twitch.mjs",
  "src/MobileViewer.jsx", "src/mobile-entry.jsx", "src/mobile.css",
  "server/chat-authorization.mjs", "server/image-worker.mjs",
  "server/party-service.mjs", "server/public-pages.mjs", "server/schema.sql",
  "server/developer-service.mjs", "server/developer-schema.sql",
  "server/automation-service.mjs", "server/automation-schema.sql", "server/chat-triggers.mjs", "server/chat-triggers-schema.sql",
  "tests/chat-authorization.test.mjs", "tests/chat-ui.test.mjs",
  "tests/image-client.test.mjs", "tests/images.test.mjs", "tests/party.test.mjs",
  "tests/scene.test.mjs", "tests/templates.test.mjs", "tests/twitch.test.mjs",
  "tests/mobile-viewer.test.mjs",
  "tests/automations.test.mjs",
  "tests/automation-service.test.mjs", "tests/automation-twitch.test.mjs", "tests/automation-router.test.mjs", "tests/chat-triggers.test.mjs",
  "tests/developer-service.test.mjs", "tests/developer-router.test.mjs",
  "scripts/cloudflare.mjs", "scripts/make-branding.mjs",
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
const configKeys = new Set(["$schema", "name", "main", "account_id", "compatibility_date", "workers_dev", "preview_urls", "observability", "triggers", "vars", "d1_databases"]);
const varKeys = new Set(["PUBLIC_PAGES", "PUBLIC_IMAGES", "PUBLIC_CHAT", "TWITCH_CHAT_CLIENT_ID", "EXTENSION_ORIGIN", "PUBLIC_SERVICE_URL", "TEST_CHANNELS", "PARTY_CHANNELS", "PARTY_TEST_VIEWERS", "EXTENSION_CLIENT_ID", "EXTENSION_OWNER", "EXTENSION_VERSION", "ALLOWED_EXTENSION_VERSIONS", "DEVELOPER_API_ENABLED", "AUTOMATIONS_ENABLED", "CHAT_TRIGGERS_ENABLED", "MERCH_TEST_STORES"]);
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
  PUBLIC_CHAT: "false", PUBLIC_IMAGES: "false", PUBLIC_PAGES: "false",
  DEVELOPER_API_ENABLED: "false", AUTOMATIONS_ENABLED: "false", CHAT_TRIGGERS_ENABLED: "false", MERCH_TEST_STORES: "{}",
  TWITCH_CHAT_CLIENT_ID: "REPLACE_WITH_YOUR_TWITCH_CHAT_CLIENT_ID",
  EXTENSION_CLIENT_ID: "REPLACE_WITH_YOUR_EXTENSION_CLIENT_ID",
  EXTENSION_OWNER: "REPLACE_WITH_YOUR_TWITCH_USER_ID",
  EXTENSION_ORIGIN: "https://REPLACE_WITH_YOUR_EXTENSION_CLIENT_ID.ext-twitch.tv",
  PUBLIC_SERVICE_URL: "https://REPLACE_WITH_YOUR_WORKER_HOST.workers.dev",
  TEST_CHANNELS: "", PARTY_CHANNELS: "", PARTY_TEST_VIEWERS: "{}",
});

const generated = new Map();
generated.set("wrangler.jsonc", `${JSON.stringify(config, null, 2)}\n`);
generated.set(".gitignore", `node_modules/\ndist/\nsite-dist/\noutputs/\n.wrangler/\n.env*\n.dev.vars*\n!.env.example\n.codex-remote-attachments/\nserver/env.d.ts\n`);
generated.set("README.md", `# Scene Studio

One Twitch extension. A different interactive experience for every channel.

[Open the hosted builder](https://funkyoushift.github.io/scene-studio/)

Scene Studio lets streamers place their own images, words, and clickable objects
over a Twitch player without developing and publishing an extension themselves.
The public builder runs as a static website on GitHub Pages: opening and editing
designs does not depend on the creator's PC staying on.

## Build something of your own

Start with a welcome layout, an image showcase, channel information, a mystery,
or a party. Edit words, upload an image into the preview, drag objects, and try
the viewer experience before saving. Import/export produces validated design
data. Undo restores previous edits. Supported objects include cards, photo
showcases, round buttons, pills and image-only stickers.

The optional AI flow prepares a structured prompt for the streamer's own AI
account. Scene Studio does not require an AI API key or make paid AI calls.

## Status: distinguish the submitted extension from experiments

Twitch version 0.1.0 was submitted for review on October 25, 2026. It is **in
review**, not approved or publicly released. Two test channels demonstrated
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
0.1. Version 0.1 remains in review. Browser test
messages/events remain simulations; simulation is not live integration evidence.

Real chat input requires separate optional broadcaster authorization for
moderation:read, user:read:chat, user:bot and channel:bot and an enabled listener.
No chat-write scope is added. Moderation checks gate shared effects; raw chat text
is not stored, and trigger receipt IDs/timestamps/status expire after 24 hours.
Hosted timers use minute scheduling and require intervals of at least 60 seconds.
The rule editor supports file import and a JSON-paste alternative. These hosted
paths do not require the creator's PC to stay on. The current source
suite passes 129 tests; automated coverage does not establish live delivery.

Version 0.4 source adds none, float, pulse and sway object motion presets. Browser
checks confirmed preview motion, dragging without changing object size, and the
reduced-motion setting disabling animation. Animated GIF uploads still become
still images; uploaded video and actual game integration are not implemented.

A lean mobile.html viewer is also prepared for 0.4. Browser fixtures at portrait,
narrow and wide sizes showed no horizontal overflow, 44px buttons and working
on-demand images/personal reactions. Six tests cover the mobile viewer. Its static
HTML/JS/CSS total is 631045 bytes, excluding Twitch's helper, runtime configuration
and on-demand images. Twitch accepted the 0.4 package in Hosted Test with
mobile.html configured, and confirmed Shift's activation in Overlay 1. Its hosted
configuration loaded two existing objects; publishing float motion reported Sent
to Twitch. After reloading and accepting Twitch's test disclosure, both saved
objects appeared in the actual 0.4 desktop viewer. The first retained its float
motion class; the operating system's reduced-motion preference correctly disabled
animation. An authorized merch chat message again displayed the live carousel.
Native Twitch iOS/Android testing remains pending. Browser fixtures are not native
mobile proof. Rev stays on active
0.1, which remains in review. The same free backend now allows version 0.4.

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
already submitted to Twitch; preserve the submitted 0.1.0 package.

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
  snapshot: "Current source including browser prototypes; separate from submitted Twitch version 0.1.0.",
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
