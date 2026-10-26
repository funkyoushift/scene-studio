const LOGIN = /^[a-z0-9_]{1,25}$/;
const TYPES = ["affiliate", "partner", "regular"];
const MODES = ["both", "automatic", "command"];

function logins(value, label) {
  if (!Array.isArray(value) || value.length > 50) throw Error(`${label} must contain up to 50 Twitch logins.`);
  const result = value.map(item => {
    const login = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (!LOGIN.test(login)) throw Error(`${label} must use Twitch logins.`);
    return login;
  });
  if (new Set(result).size !== result.length) throw Error(`${label} cannot repeat a Twitch login.`);
  return result;
}

export function normalizeShoutoutTrigger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.type !== "shoutout" || !MODES.includes(value.mode)) throw Error("Choose a valid shoutout trigger mode.");
  const users = logins(value.users, "Shoutout users");
  const exclusions = logins(value.exclusions, "Shoutout exclusions");
  if (!Array.isArray(value.types) || value.types.length > 3 || value.types.some(type => !TYPES.includes(type)) || new Set(value.types).size !== value.types.length) throw Error("Choose unique shoutout account types.");
  if (users.some(user => exclusions.includes(user))) throw Error("A shoutout user cannot also be excluded.");
  return { type: "shoutout", mode: value.mode, users, types: [...value.types], exclusions };
}

export function normalizeShoutoutEffect(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.type !== "shoutout" ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 160 ||
      typeof value.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value.color) ||
      !Number.isInteger(value.durationSeconds) || value.durationSeconds < 5 || value.durationSeconds > 30)
    throw Error("Choose a valid shoutout message, color, and duration.");
  return { type: "shoutout", message: value.message, color: value.color, durationSeconds: value.durationSeconds };
}

export function safeShoutoutProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !/^[1-9][0-9]{0,19}$/.test(value.id) ||
      typeof value.login !== "string" || !LOGIN.test(value.login) ||
      typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.length > 70 || /[\x00-\x1f\x7f]/.test(value.displayName) ||
      typeof value.image !== "string" || !TYPES.includes(value.type)) return null;
  if (value.image) {
    try {
      const url = new URL(value.image);
      if (url.protocol !== "https:" || url.hostname !== "static-cdn.jtvnw.net" || url.port || url.username || url.password || url.search || url.hash ||
          url.href !== value.image || value.image.length > 350 || !/^\/jtv_user_pictures\/(?!.*\.\.)(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp)$/.test(url.pathname)) return null;
    } catch { return null; }
  }
  return { id: value.id, login: value.login, displayName: value.displayName, image: value.image, type: value.type };
}

export function shoutoutChannelUrl(profile) {
  const clean = safeShoutoutProfile(profile);
  if (!clean) throw Error("Choose a valid Twitch profile.");
  return `https://www.twitch.tv/${clean.login}`;
}
