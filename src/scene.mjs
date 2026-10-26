import { hostedImage } from "./image-address.mjs";
import { PARTY_PRESETS } from "./party.mjs";
export const STORAGE_KEY = "scene-studio-draft-v1";
export const MAX_OBJECTS = 12;
export const MAX_IMPORT_BYTES = 2_000_000;
export const ACTIONS = ["reveal", "counter", "celebrate", "party", "link"];
export const MOTIONS = ["none", "float", "pulse", "sway"];
export const ICONS = [
  "spark",
  "heart",
  "star",
  "gift",
  "info",
  "bolt",
  "message",
  "link",
];
export const id = () => crypto.randomUUID();
export const bytes = (text) => new TextEncoder().encode(text).length;
export function newObject(kind = "reveal") {
  const presets = {
    party: {title:"Emergency ducks",caption:"Celebrate together + post in chat",icon:"spark",detail:"",preset:"ducks"},
    reveal: {
      title: "A little about me",
      caption: "Click to discover",
      icon: "info",
      detail:
        "Your story, your schedule, your next big idea. Make this space yours.",
    },
    counter: {
      title: "Send some love",
      caption: "Tap to add a heart",
      icon: "heart",
      detail: "Thanks for being here!",
    },
    celebrate: {
      title: "Make some noise",
      caption: "Tap for a celebration",
      icon: "spark",
      detail: "You made this moment!",
    },
    link: {
      title: "Explore more",
      caption: "Open a website ↗",
      icon: "link",
      detail: "Add an HTTPS link in the editor.",
    },
  };
  return {
    id: id(),
    action: kind,
    ...presets[kind],
    x: 6,
    y: 65,
    width: 26,
    height: 24,
    color: "#a3e635",
    shape: "card",
    motion: "none",
    image: "",
    url: "",
  };
}
export function starterScene() {
  const a = newObject("reveal");
  const b = {
    ...newObject("celebrate"),
    x: 69,
    y: 68,
    width: 25,
    height: 21,
    color: "#c4b5fd",
    title: "Your moment",
    caption: "Click to celebrate",
  };
  return { version: 1, name: "My first scene", objects: [a, b] };
}
function fail(message) {
  throw new Error(message);
}
function string(value, max, label) {
  if (typeof value !== "string" || value.length > max)
    fail(`${label} must be text of at most ${max} characters.`);
  return value;
}
function range(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max)
    fail(`${label} must be between ${min} and ${max}.`);
  return value;
}
function appearanceValues(object) {
  if (!object || typeof object !== "object" || Array.isArray(object)) fail("Invalid object appearance.");
  const values = {};
  for (const field of ["background", "textColor"]) {
    if (!Object.hasOwn(object, field) || object[field] === undefined) continue;
    if (typeof object[field] !== "string" || !/^#[0-9a-f]{6}$/i.test(object[field])) fail(`${field} must be a six-digit hex color.`);
    values[field] = object[field];
  }
  for (const [field, min, max] of [["opacity", 30, 100], ["fontScale", 70, 160], ["radius", 0, 48]]) {
    if (!Object.hasOwn(object, field) || object[field] === undefined) continue;
    values[field] = range(object[field], min, max, field);
  }
  return values;
}
function objectMediaOptions(object) {
  const values = {};
  if (Object.hasOwn(object, "customIcon") && object.customIcon !== undefined) {
    if (typeof object.customIcon !== "string" || [...object.customIcon].length > 8 || /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(object.customIcon))
      fail("Custom icon must contain at most 8 Unicode characters without control or bidirectional formatting characters.");
    values.customIcon = object.customIcon;
  }
  if (Object.hasOwn(object, "imageFit") && object.imageFit !== undefined) {
    if (!["cover", "contain", "icon"].includes(object.imageFit)) fail("Choose cover, contain, or icon for image fit.");
    values.imageFit = object.imageFit;
  }
  return values;
}
function quizMetadata(object) {
  if (!Object.hasOwn(object, "quiz") || object.quiz === undefined) return {};
  if (object.action !== "reveal") fail("Quiz questions must use the reveal action.");
  const quiz = object.quiz;
  if (!quiz || typeof quiz !== "object" || Array.isArray(quiz)) fail("Quiz must be an object.");
  if (!Array.isArray(quiz.choices) || quiz.choices.length < 2 || quiz.choices.length > 4)
    fail("A quiz must have 2 to 4 choices.");
  const seen = new Set();
  const choices = quiz.choices.map((raw) => {
    if (typeof raw !== "string" || raw.length > 80 || !raw.trim() || /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(raw))
      fail("Quiz choices must be nonempty text of at most 80 characters without control or bidirectional formatting characters.");
    const choice = raw.normalize("NFC").trim(), key = choice.toLowerCase();
    if (seen.has(key)) fail("Quiz choices must be distinct.");
    seen.add(key);
    return choice;
  });
  if (!Number.isInteger(quiz.correctIndex) || quiz.correctIndex < 0 || quiz.correctIndex >= choices.length)
    fail("Choose a correct quiz choice.");
  return { quiz: { choices, correctIndex: quiz.correctIndex } };
}
function counterGoal(object) {
  if (!Object.hasOwn(object, "goal") || object.goal === undefined) return {};
  if (object.action !== "counter") fail("Goals must use the counter action.");
  if (!Number.isInteger(object.goal) || object.goal < 2 || object.goal > 1000)
    fail("Counter goal must be a whole number from 2 to 1000.");
  return { goal: object.goal };
}
export function objectAppearance(object) {
  const values = appearanceValues(object), style = {};
  if (values.background !== undefined) style.backgroundColor = values.background;
  if (values.textColor !== undefined) style.color = values.textColor;
  if (values.opacity !== undefined) style.opacity = values.opacity / 100;
  if (values.radius !== undefined) style.borderRadius = `${values.radius}px`;
  if (values.fontScale !== undefined) style["--object-font-scale"] = values.fontScale / 100;
  return style;
}
export function safeLink(value) {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Use a full HTTPS website address.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    fail("Links must use HTTPS without embedded credentials.");
  return url.href;
}
export function validateScene(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.objects))
    fail("This is not a Scene Studio version 1 design.");
  if (input.objects.length > MAX_OBJECTS)
    fail(`A scene can contain up to ${MAX_OBJECTS} objects.`);
  const ids = new Set();
  const scene = {
    version: 1,
    name: string(input.name, 80, "Scene name"),
    objects: input.objects.map((o) => {
      if (!o || typeof o !== "object") fail("Invalid object.");
      const key = string(o.id, 64, "Object ID");
      if (!key || ids.has(key)) fail("Object IDs must be unique and nonempty.");
      ids.add(key);
      if (!ACTIONS.includes(o.action) || !ICONS.includes(o.icon))
        fail("Unknown interaction or icon.");
      if(o.action === "party" && !Object.hasOwn(PARTY_PRESETS,o.preset ?? "ducks")) fail("Choose a supported celebration.");
      if (!["card", "pill", "circle", "showcase", "sticker"].includes(o.shape))
        fail("Unknown appearance.");
      if (!MOTIONS.includes(o.motion ?? "none")) fail("Choose a supported motion.");
      if (!/^#[0-9a-f]{6}$/i.test(o.color)) fail("Use a six-digit hex color.");
      const width = range(o.width, 10, 80, "Width"),
        height = range(o.height, 10, 60, "Height");
      const x = range(o.x, 0, 100 - width, "Horizontal position"),
        y = range(o.y, 0, 100 - height, "Vertical position");
      const image = string(o.image ?? "", 700_000, "Image");
      if (
        image &&
        !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(
          image,
        ) &&
        !hostedImage(image)
      )
        fail("Images must be uploaded PNG, JPEG, WebP, or GIF files.");
      return {
        id: key,
        action: o.action,
        ...(Object.hasOwn(o, "popupOnly") && o.popupOnly !== undefined
          ? typeof o.popupOnly === "boolean"
            ? { popupOnly: o.popupOnly }
            : fail("popupOnly must be true or false.")
          : {}),
        ...quizMetadata(o),
        ...counterGoal(o),
        ...(o.action === "party" ? {preset:o.preset ?? "ducks"} : {}),
        icon: o.icon,
        shape: o.shape,
        motion: o.motion ?? "none",
        color: o.color,
        ...appearanceValues(o),
        ...objectMediaOptions(o),
        width,
        height,
        x,
        y,
        image,
        title: string(o.title, 70, "Title"),
        caption: string(o.caption, 100, "Caption"),
        detail: string(o.detail, 1200, "Detail"),
        url: safeLink(string(o.url ?? "", 1000, "Link")),
      };
    }),
  };
  if (bytes(JSON.stringify(scene)) > MAX_IMPORT_BYTES)
    fail("This scene is too large. Use smaller images.");
  return scene;
}
export function parseScene(text) {
  if (bytes(text) > MAX_IMPORT_BYTES)
    fail("File too large. Keep designs under 2 MB.");
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    fail("The design is not valid JSON. Import a Scene Studio export.");
  }
  return validateScene(input);
}
export function moveObject(object, x, y) {
  return {
    ...object,
    x: Math.min(100 - object.width, Math.max(0, Math.round(x * 10) / 10)),
    y: Math.min(100 - object.height, Math.max(0, Math.round(y * 10) / 10)),
  };
}
export function twitchContent(scene) {
  const clean = validateScene(scene);
  if (clean.objects.some((o) => o.image && !hostedImage(o.image)))
    fail("Save your overlay to upload these images to image hosting first.");
  const missingLink = clean.objects.find((o) => o.action === "link" && !o.url);
  if (missingLink) fail(`Add a full HTTPS website address to "${missingLink.title || missingLink.id}" before publishing.`);
  const content = JSON.stringify(clean);
  if (bytes(content) > 5000)
    fail(
      "Twitch scenes must fit within 5 KB. Shorten the text or remove an object.",
    );
  return content;
}
export function aiPrompt(scene) {
  return `Create a Scene Studio design as JSON only. This is configuration for an existing Twitch extension, not executable code. No HTML, JavaScript, CSS, scripts, URLs to images, or new action types. Version 1, name (max 80 characters), objects array (max 12). Every object needs unique id, title (max 70), caption (max 100), detail (max 1200), action (reveal/counter/celebrate/party/link), icon (spark/heart/star/gift/info/bolt/message/link), shape (card/pill/circle/showcase/sticker; showcase places an image above a readable caption; sticker displays an uploaded image without a background or visible text), motion (none/float/pulse/sway; defaults to none), color (#RRGGBB), x/y/width/height (percentage numbers). Width 10–80, height 10–60, x 0–100-width, y 0–100-height. Optional appearance: background and textColor (#RRGGBB), opacity (number 30–100), fontScale (number 70–160), radius (number 0–48 pixels); omit these unless requested. Optional customIcon is plain text or emoji, at most 8 Unicode codepoints, with no control or bidirectional formatting characters; empty is allowed. It overrides the displayed symbol but does not replace the required preset icon field. Optional imageFit is cover, contain, or icon; omit it unless requested. image must be empty. url must be empty unless action is link, then a nonempty full HTTPS address without embedded credentials is required. HTTPS links can publish in the current 0.4 Hosted Test version; Twitch public review restrictions on social and commerce links still apply, and technical acceptance is not policy approval. counter and celebrate affect only the clicking viewer. party sends a shared celebration and fixed chat message; it requires preset (ducks/disco/confetti), an enabled channel, linked viewer identity and moderation checks, and cannot send custom chat text. Do not invent other presets. Object JSON does not enable chat-keyword, subscription, or Hype Train triggers; those require separately implemented and connected integrations. Keep compact JSON under 5000 UTF-8 bytes for Twitch. Modify this design based on my request, keeping existing IDs where possible:\n${JSON.stringify({ ...scene, objects: scene.objects.map((o) => ({ ...o, image: "" })) })}\n\nMy request: `;
}
