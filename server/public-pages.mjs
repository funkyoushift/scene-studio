// Martin Wenn approved this exact page copy for publication on October 25, 2026.
// Optional moderation/OAuth copy is conditional on that feature being enabled
// and qualified. This module does not register routes or enable any feature.

const pages = {
  "/privacy": {
    title: "Privacy",
    intro: "Scene Studio is a Twitch extension operated by Martin Wenn. This page explains the information used by the extension and its optional shared-chat feature.",
    sections: [
      ["Your scene and images", [
        "A broadcaster's saved configuration contains the scene's text, layout, actions, and image addresses. Twitch stores and distributes that configuration so viewers can use the overlay. Treat published scene content as public.",
        "Uploaded images are stored on Cloudflare and are publicly accessible at their image addresses. Do not upload private information. Images remain stored until the broadcaster deletes them from the image library; an image still used by the saved scene must be removed from that scene first.",
      ]],
      ["Interaction information", [
        "For shared celebrations, Scene Studio processes the Twitch channel ID and the acting viewer's Twitch user ID. It stores event IDs, timestamps, and delivery receipts to control repeated clicks and prevent an uncertain chat delivery from being replayed. Delivery receipts currently have no automatic expiry.",
        "A shared celebration includes the viewer's Twitch login in its preset chat message and viewer-facing celebration. Twitch chat messages are visible in the channel and are handled by Twitch under its own policies.",
      ]],
      ["Optional chat connection", [
        "On channels where the optional shared-chat feature is enabled, the streamer must connect Twitch moderation access before that feature is available. The moderation:read permission is used to check bans and timeouts before shared-chat actions. It does not grant Scene Studio permission to ban or time out anyone.",
        "The connection's OAuth tokens are encrypted at rest and retained until disconnection or revocation. Use Disconnect in Scene Studio to remove the stored connection, or revoke access in Twitch's connection settings. Revoking access may require the service to detect the revocation before its stored connection is cleared. Shared chat is unavailable without a valid required connection. This description does not mean shared chat is enabled for every channel or viewer.",
        "If the broadcaster separately enables chat triggers, Scene Studio requests user:read:chat, user:bot and channel:bot to receive that channel's chat messages through Twitch EventSub. It matches messages against the broadcaster's configured phrases and can display a saved carousel or celebration. This connection does not request permission to send chat as the broadcaster. Message text is processed temporarily and is not stored as chat history. Bounded message IDs, timestamps and delivery receipts are retained to prevent duplicate effects; chat-trigger receipts expire after 24 hours. Disconnect chat triggers to stop the listener, or disconnect the entire optional chat connection to remove its stored tokens.",
        "Optional subscription and Hype Train popups request channel:read:subscriptions and channel:read:hype_train. Authenticated Twitch events trigger the broadcaster's saved design. Subscriber names, subscription messages and full event payloads are not retained. Opaque event IDs, listener registrations, timestamps and delivery status prevent duplicate effects; event receipts expire after 24 hours. You can disconnect these event listeners separately or remove the entire optional Twitch connection and its encrypted tokens.",
      ]],
      ["Carousels and trigger settings", [
        "The broadcaster's saved carousel images, captions, destinations and trigger rules are stored on Cloudflare and made available to that channel's extension viewers. Published settings should not contain private information. Timer rules can run on the hosted service while the editor is closed. Broadcasters can replace these settings or save an empty design to clear them.",
      ]],
      ["Your browser and service providers", [
        "The editor can keep a draft in your browser's local storage so you can return to it. Clearing the site's browser storage removes that local draft; it does not delete a published Twitch configuration or uploaded images.",
        "Scene Studio does not use an AI API or an analytics SDK. Its copy-and-paste AI workflow lets you choose whether to share a design prompt with a separate AI service; that service's policies apply to anything you send there.",
        "Cloudflare and Twitch provide hosting and platform services. They may process IP addresses and other technical request information under their own policies.",
      ]],
      ["Contact and deletion requests", [
        "Contact Martin Wenn at m0dmacks@gmail.com for privacy questions, deletion requests, or a problem with public content. Include the channel name and the relevant page or image URL so the request can be located. Never send passwords, access tokens, or other account secrets. Requests involving content retained by Twitch may also require Twitch's own tools or support.",
      ]],
    ],
  },
  "/terms": {
    title: "Terms of use",
    intro: "Scene Studio is a free beta Twitch extension operated by Martin Wenn. It lets broadcasters arrange interactive objects and images on their stream overlay.",
    sections: [
      ["Use it responsibly", [
        "Upload and publish only content you have the rights and permission to use. Follow Twitch's rules and guidelines. Do not use the extension for harassment, spam, impersonation, illegal content, or attempts to bypass access controls, moderation, or usage limits.",
        "Scene text, published configurations, uploaded images, and shared-chat messages can be public. Keep private information and account secrets out of them. Broadcasters are responsible for the content they choose to publish.",
      ]],
      ["Beta availability and limits", [
        "The service uses bounded storage, upload, and interaction quotas. Some features are restricted to test channels or invited accounts. Features, limits, and availability may change as the beta develops.",
        "Scene Studio does not charge for interactions or require purchases or Bits. Optional shared-chat actions are available only when that feature is enabled for the channel and its required streamer connection is valid. Personal preview effects do not send chat messages.",
        "An unsuccessful or uncertain shared-chat action is not automatically retried, to avoid duplicate messages. A chat message and an on-screen effect may not always arrive together.",
      ]],
      ["Help and reports", [
        "Contact Martin Wenn at m0dmacks@gmail.com to report a problem, inappropriate content, or a rights concern. Include the channel and relevant URL, describe what happened, and never send passwords or access tokens.",
      ]],
    ],
  },
  "/support": {
    title: "Support",
    intro: "Scene Studio is operated by Martin Wenn. For help, contact m0dmacks@gmail.com.",
    sections: [
      ["Set up an overlay", [
        "Install Scene Studio from the Twitch extension page, open its configuration, and choose or import a design. Edit the objects, preview the result, and select Save overlay. In Twitch's extension manager, activate Scene Studio in the video-overlay slot for that channel. Each channel keeps its own configuration.",
        "During private testing, Twitch may show a test disclosure before the extension can appear. Accept that disclosure when it is shown. It is a testing requirement, not part of the ordinary approved release experience.",
      ]],
      ["Images and clicks", [
        "Choose an object in the editor, then use Choose image to select your own image. Review the preview and save the overlay. Uploaded images are public. The image library lets the broadcaster remove images that are no longer used by the saved scene.",
        "Personal effects and reveal cards do not need a viewer to link their Twitch identity. Publishing requires Twitch sign-in and authorization for the channel. Shared-chat clicks require a linked viewer identity and are subject to cooldowns and channel access limits.",
      ]],
      ["Optional shared chat", [
        "Shared chat is available only on enabled channels. Where the optional moderation connection is required, the streamer must connect it first so bans and timeouts can be checked. Viewers click a configured celebration to send its preset chat message and shared on-screen effect. They cannot enter arbitrary chat text through this action.",
        "If chat is unavailable, check whether the channel and your account are eligible for the current test, whether your Twitch identity is linked, and whether the streamer's required connection is valid. Wait for the displayed cooldown before trying another action. Do not repeatedly retry a delivery reported as uncertain.",
        "To disconnect moderation access, use Disconnect in Scene Studio or revoke the connection in Twitch's settings. Disconnection makes dependent shared-chat actions unavailable; it does not remove the channel's saved overlay or images.",
      ]],
      ["Report a problem", [
        "Email m0dmacks@gmail.com with the channel name, relevant URL, what you clicked, and the approximate time. Say what you expected and what appeared instead. Include an error message if available. Never send passwords, access tokens, or other account secrets.",
      ]],
    ],
  },
};

const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function publicPage(path) {
  if (!Object.hasOwn(pages, path)) return null;
  const page = pages[path];
  const sections = page.sections.map(([heading, paragraphs]) => `<section><h2>${escape(heading)}</h2>${paragraphs.map(paragraph => `<p>${escape(paragraph)}</p>`).join("")}</section>`).join("");
  const navigation = Object.entries(pages).map(([href, entry]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${escape(entry.title)}</a>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(page.title)} · Scene Studio</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101710;color:#eef3e9}*{box-sizing:border-box}body{margin:0}main{width:min(100% - 40px,780px);margin:0 auto;padding:48px 0 64px}header{padding-bottom:26px;border-bottom:1px solid #344130}.brand{margin:0 0 16px;color:#b5ed70;font-size:14px;font-weight:700;letter-spacing:.04em}nav{display:flex;gap:10px 22px;flex-wrap:wrap}a{color:#c6ee9c;text-underline-offset:4px}nav a{font-size:14px}nav [aria-current=page]{color:#fff;text-decoration-thickness:2px}h1{font-size:clamp(30px,7vw,44px);line-height:1.15;margin:34px 0 18px;letter-spacing:-.035em}h2{font-size:21px;line-height:1.3;margin:30px 0 12px}p{font-size:16px;line-height:1.7;color:#cad4c4;margin:12px 0}footer{margin-top:36px;padding-top:20px;border-top:1px solid #344130}footer p{font-size:14px}a:focus-visible{outline:2px solid #b5ed70;outline-offset:5px}@media(max-width:480px){main{width:calc(100% - 32px);padding-top:28px}}
</style></head><body><main><header><p class="brand">Scene Studio · Free beta</p><nav aria-label="Information">${navigation}</nav></header><h1>${escape(page.title)}</h1><p>${escape(page.intro)}</p>${sections}<footer><p>Martin Wenn · <a href="mailto:m0dmacks@gmail.com">m0dmacks@gmail.com</a></p></footer></main></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "public, max-age=300",
    },
  });
}
