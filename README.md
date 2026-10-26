# Scene Studio

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

The newer carousel, rules, chat-input simulation and developer-event experiments
are **browser prototypes**. Their previews do not read Twitch chat, modify a
game, or publish new behavior to the extension currently in review. A simulated
event is not evidence of a live integration. On the hosted site, the developer
panel provides a roadmap and event simulation without contacting localhost.
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
destinations. Website/checkout actions remain preview-only in the submitted
extension and are rejected when saving to Twitch. This is not a claim of live
on-stream checkout. See assets/merch/SOURCES.md for image origins.

## Run or inspect the source

Use Node.js 26.3 or newer and npm.

```sh
npm ci
npm test
npm run dev
```

The local editor opens at http://127.0.0.1:5186. The hosted build is:

```sh
npm run build:pages
```

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

```powershell
$env:VITE_EXTENSION_VERSION = '0.2.0'
npm run build
./scripts/package-twitch.ps1 -Version '0.2.0'
Remove-Item Env:VITE_EXTENSION_VERSION
```

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
