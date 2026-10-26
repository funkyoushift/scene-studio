import { validateScene, newObject, id } from "./scene.mjs";

export const TEMPLATE_OPTIONS = Object.freeze([
  Object.freeze({
    key: "welcome",
    title: "Make yourself at home",
    description: "Introduce your channel and give viewers a little celebration.",
    tag: "Simple start",
    icon: "👋",
  }),
  Object.freeze({
    key: "community-party",
    title: "The party department",
    description: "Ducks, disco, and confetti with preset chat messages.",
    tag: "Shared celebration",
    icon: "🎉",
  }),
  Object.freeze({
    key: "photo-showcase",
    title: "Show what you love",
    description: "Add three images and let viewers discover the story behind each.",
    tag: "Your images",
    icon: "🖼️",
  }),
  Object.freeze({
    key: "streamer-info",
    title: "Your channel at a glance",
    description: "Give newcomers your schedule, stream plans, and chat guidelines.",
    tag: "Channel essentials",
    icon: "📅",
  }),
  Object.freeze({
    key: "clue-hunt",
    title: "A little mystery",
    description: "Hide three clickable clues and let viewers discover the answer.",
    tag: "Explore and discover",
    icon: "🔎",
  }),
]);

// Additive object starters for the beginner editor. These return objects only;
// callers append them to the current scene instead of replacing its draft.
export const INTERACTIVE_PRESET_OPTIONS = Object.freeze([
  Object.freeze({ key: "trivia", title: "Random trivia", description: "Ready-to-play questions, shuffled answers and a personal score", icon: "❔", objectCount: 1 }),
  Object.freeze({ key: "tap-challenge", title: "Personal tap challenge", description: "Each viewer works toward their own goal", icon: "♡", objectCount: 1 }),
  Object.freeze({ key: "celebration", title: "Personal celebration", description: "Give each viewer a little moment", icon: "✦", objectCount: 1 }),
  Object.freeze({ key: "clickable-link", title: "Clickable link", description: "Add your HTTPS destination when ready", icon: "↗", objectCount: 1 }),
  Object.freeze({ key: "info-card", title: "Info card", description: "Share a schedule, tip, or channel detail", icon: "ⓘ", objectCount: 1 }),
  Object.freeze({ key: "shared-party", title: "Shared party", description: "Three celebrations; optional chat connection required", icon: "🎉", objectCount: 3 }),
]);

export function createInteractivePreset(key) {
  switch (key) {
    case "trivia": {
      const object = newObject("reveal");
      return [{ ...object, title: "Random trivia", caption: "Choose an answer, then play again", detail: "", x: 4, y: 4, width: 42, height: 50, quiz: { mode: "bank", category: "mixed" } }];
    }
    case "tap-challenge":
      return [{ ...newObject("counter"), title: "Personal tap challenge", caption: "Your taps, your goal", detail: "Thanks for tapping! Every viewer has a personal count for this visit.", x: 60, y: 5, width: 34, height: 38, goal: 20 }];
    case "celebration":
      return [{ ...newObject("celebrate"), title: "A little celebration", caption: "Tap for your own moment", detail: "You made this moment!" }];
    case "clickable-link":
      return [{ ...newObject("link"), title: "Visit my link", caption: "Add a destination in Object settings", detail: "Set an HTTPS website address before publishing." }];
    case "info-card":
      return [{ ...newObject("reveal"), title: "A little about me", caption: "Click to find out more", detail: "Add your schedule, stream plans, or a detail you want viewers to know." }];
    case "shared-party": {
      const presets = [
        { preset: "ducks", title: "Release the ducks", color: "#facc15" },
        { preset: "disco", title: "Emergency disco", color: "#e879f9" },
        { preset: "confetti", title: "Confetti cannon", color: "#38bdf8" },
      ];
      return presets.map((preset, index) => ({
        ...newObject("party"), ...preset,
        x: 5 + index * 31.5, y: 65, width: 27, height: 21,
      }));
    }
    default:
      throw new Error("Choose a supported interactive starter.");
  }
}

export function createTemplate(key) {
  let name;
  let objects;

  switch (key) {
    case "welcome":
      name = "Welcome to my channel";
      objects = [
        {
          ...newObject("reveal"),
          title: "Welcome in!",
          caption: "A little about this channel",
          detail: "Make yourself at home. Tell viewers who you are, what you love, and what they can expect here. Edit this card to make it yours.",
          x: 5, y: 65, width: 34, height: 25,
        },
        {
          ...newObject("celebrate"),
          title: "Glad you are here",
          caption: "Tap for your own celebration",
          detail: "You belong here!",
          color: "#c4b5fd",
          x: 65, y: 65, width: 30, height: 25,
        },
      ];
      break;
    case "community-party": {
      name = "The party department";
      const party = newObject("party");
      const presets = [
        { preset: "ducks", title: "Release the ducks", color: "#facc15" },
        { preset: "disco", title: "Emergency disco", color: "#e879f9" },
        { preset: "confetti", title: "Confetti cannon", color: "#38bdf8" },
      ];
      objects = presets.map((preset, index) => ({
        ...party, ...preset, id: id(),
        x: 5 + index * 31.5, y: 65, width: 27, height: 21,
      }));
      objects.push({
        ...newObject("reveal"),
        title: "How the party works",
        caption: "A very unserious control room",
        detail: "Pick a celebration to send a preset message in chat and a silent celebration to viewers with the extension open. The streamer must connect optional chat for this channel first. Viewers must share their Twitch identity; channel bans and timeouts apply. Wait 20 seconds between clicks. The local editor previews effects without posting in chat.",
        shape: "pill", color: "#c4b5fd",
        x: 26, y: 88, width: 48, height: 10,
      });
      break;
    }
    case "photo-showcase": {
      name = "My image showcase";
      const card = newObject("reveal");
      const titles = ["Your first feature", "Your next favorite", "One more story"];
      objects = titles.map((title, index) => ({
        ...card, id: id(), title,
        caption: "Add your image, then tell its story",
        detail: "Choose an image for this card in the editor. It could be your artwork, a favorite moment, or something you made. Replace this text with the story you want viewers to discover when they click.",
        shape: "showcase", icon: "star", color: "#38bdf8",
        x: 5 + index * 30.5, y: 31, width: 29, height: 53,
      }));
      break;
    }
    case "streamer-info": {
      name = "My channel at a glance";
      const card = newObject("reveal");
      const cards = [
        {
          title: "When to catch me", caption: "Open the stream schedule", icon: "info", color: "#38bdf8",
          detail: "Add your usual streaming days and start times here. Include your time zone, and tell viewers where you announce a change. Keep this card updated when your schedule changes.",
        },
        {
          title: "What's on stream", caption: "Games, projects, and plans", icon: "star", color: "#c4b5fd",
          detail: "Tell viewers what you stream and what is coming next. Add today's game, a project you are working on, or how viewers can take part. Replace this text with your own plans.",
        },
        {
          title: "The chat vibe", caption: "Make yourself at home", icon: "message", color: "#a3e635",
          detail: "Add your channel's chat guidelines here: how you welcome newcomers, whether spoilers are okay, and any channel traditions. Make it clear, friendly, and specific to your community.",
        },
      ];
      objects = cards.map((content, index) => ({
        ...card, ...content, id: id(),
        x: 5 + index * 31, y: 72, width: 28, height: 20,
      }));
      break;
    }
    case "clue-hunt": {
      name = "The hidden answer";
      const clue = newObject("reveal");
      objects = [
        {
          ...clue, id: id(), title: "A little mystery", caption: "Three clues. One answer.",
          detail: "Explore the three clue objects and guess what they describe. Open the answer whenever you are ready. This is just for fun: no score, prize, or required order. In the editor, move the clues around and replace them with your own mystery.",
          shape: "pill", icon: "info", color: "#c4b5fd",
          x: 32, y: 5, width: 36, height: 14,
        },
        {
          ...clue, id: id(), title: "Clue 1", caption: "A familiar voice", icon: "spark", color: "#facc15",
          detail: "My voice sounds just like yours. What could I be?",
          shape: "circle", x: 7, y: 22, width: 17, height: 20,
        },
        {
          ...clue, id: id(), title: "Clue 2", caption: "Listen closely", icon: "star", color: "#38bdf8",
          detail: "Try a shout in an empty hallway. You might hear me answer.",
          shape: "circle", x: 77, y: 37, width: 17, height: 20,
        },
        {
          ...clue, id: id(), title: "Clue 3", caption: "A little later", icon: "bolt", color: "#a3e635",
          detail: "You make a sound first. I repeat it a moment later.",
          shape: "circle", x: 12, y: 72, width: 17, height: 20,
        },
        {
          ...clue, id: id(), title: "Reveal the answer", caption: "Open when you are ready", icon: "gift", color: "#fbbf24",
          detail: "The answer is an echo! A sound reflects back to you, so it seems to answer in your own voice. Thanks for exploring this little mystery.",
          shape: "pill", x: 59, y: 79, width: 35, height: 16,
        },
      ];
      break;
    }
    default:
      throw new Error("Choose a supported starter template.");
  }

  return validateScene({ version: 1, name, objects });
}
