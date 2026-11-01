# Scene Studio

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

Build the website with `npm run build:pages`; build only the Twitch player and
small setup link with `npm run build`. Server setup additionally requires the
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
