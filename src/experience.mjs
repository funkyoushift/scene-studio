import { checkPlayerRequirements, knownFields, experienceRequirements } from "./player-contract.mjs";
import { IMAGE_ORIGIN } from "./image-address.mjs";

export const EXPERIENCE_LIMITS = {
  scenes: 100,
  elements: 40,
  variables: 64,
  assets: 128,
  actions: 16,
  bytes: 750_000,
  videoBytes: 25_000_000,
};
const keyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const fail = (message) => {
  throw new Error(message);
};
const text = (v, n, label) =>
  typeof v === "string" && v.length <= n
    ? v
    : fail(`${label} must be text of at most ${n} characters.`);
const key = (v) =>
  typeof v === "string" && keyPattern.test(v) && !forbidden.has(v)
    ? v
    : fail(
        "Use an ID beginning with a letter, followed by letters, numbers, dashes or underscores.",
      );
const number = (v, min, max) =>
  Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail(`Use a number from ${min} to ${max}.`);
const list = (v, n, label) =>
  Array.isArray(v) && v.length <= n
    ? v
    : fail(`${label} can contain up to ${n} entries.`);
const scalar = (v) =>
  typeof v === "boolean"
    ? v
    : typeof v === "number"
      ? number(v, -1e9, 1e9)
      : text(v, 200, "Value");
const color = (v) =>
  /^#[0-9a-f]{6}$/i.test(v) ? v : fail("Choose a six-digit color.");
function unique(rows, label) {
  const ids = rows.map((r) => key(r.id));
  if (new Set(ids).size !== ids.length) fail(`${label} IDs must be unique.`);
  return new Set(ids);
}
export function hostedExperience(value, channel) {
  const m =
    typeof value === "string" &&
    value.startsWith(IMAGE_ORIGIN) &&
    value
      .slice(IMAGE_ORIGIN.length)
      .match(/^\/experiences\/([1-9][0-9]{0,19})\/([a-f0-9]{64})\.json$/);
  return Boolean(m && (!channel || m[1] === channel));
}
export function hostedExperienceMedia(value, channel) {
  const m =
    typeof value === "string" &&
    value.startsWith(IMAGE_ORIGIN) &&
    value
      .slice(IMAGE_ORIGIN.length)
      .match(/^\/media\/([1-9][0-9]{0,19})\/([a-f0-9]{64})\.(png|mp4|webm)$/);
  return Boolean(m && (!channel || m[1] === channel));
}
export function validateExperience(input, { published = false, channel } = {}) {
  if (!input || input.kind !== "experience" || input.version !== 1)
    fail("Import a Scene Studio experience version 1.");
  if (
    new TextEncoder().encode(JSON.stringify(input)).length >
    EXPERIENCE_LIMITS.bytes
  )
    fail("This experience is too large. Split it into smaller chapters.");
  knownFields(input, ['kind','version','id','name','start','enabled','saveProgress','variables','assets','scenes','requires'], 'Experience');
  checkPlayerRequirements(input.requires);
  const sceneRows = list(input.scenes, EXPERIENCE_LIMITS.scenes, "Scenes");
  if (!sceneRows.length) fail("Add at least one scene.");
  const sceneIds = unique(sceneRows, "Scene");
  const variableRows = list(
    input.variables ?? [],
    EXPERIENCE_LIMITS.variables,
    "Variables",
  );
  unique(variableRows, "Variable");
  variableRows.forEach(v => knownFields(v, ['id','initial'], 'Variable'));
  const variables = variableRows.map((v) => ({
    id: key(v.id),
    initial: scalar(v.initial),
  }));
  const types = new Map(variables.map((v) => [v.id, typeof v.initial]));
  const assetRows = list(input.assets ?? [], EXPERIENCE_LIMITS.assets, "Media");
  const assetIds = unique(assetRows, "Media");
  const assets = assetRows.map((a) => {
    knownFields(a, ["id","kind","name","source"], "Media");
    if (!["image", "video"].includes(a.kind))
      fail("Media must be an image or video.");
    const source = text(a.source, 500, "Media address");
    const local = /^local-media:[a-f0-9-]{36}$/.test(source);
    if (!(hostedExperienceMedia(source, channel) || (!published && local)))
      fail(
        "Upload media in this builder; arbitrary media addresses are not supported.",
      );
    if (
      !local &&
      !(a.kind === "image"
        ? source.endsWith(".png")
        : /\.(mp4|webm)$/.test(source))
    )
      fail("Media type and file do not match.");
    return {
      id: key(a.id),
      kind: a.kind,
      name: text(a.name ?? a.id, 100, "Media name"),
      source,
    };
  });
  function conditions(rows = []) {
    return list(rows, 12, "Conditions").map((c) => {
      knownFields(c, ["variable","op","value"], "Condition");
      if (
        !types.has(c.variable) ||
        !["eq", "ne", "gt", "gte", "lt", "lte"].includes(c.op)
      )
        fail("Choose a known variable and comparison.");
      const value = scalar(c.value);
      if (
        typeof value !== types.get(c.variable) ||
        (!["eq", "ne"].includes(c.op) && typeof value !== "number")
      )
        fail("The comparison value must match the variable type.");
      return { variable: c.variable, op: c.op, value };
    });
  }
  function actions(rows = []) {
    let transitions = 0;
    return list(rows, EXPERIENCE_LIMITS.actions, "Actions").map((a, index) => {
      knownFields(a, ['type','scene','scenes','variable','value'], 'Action');
      if (["goto", "random", "restart"].includes(a.type)) {
        if (++transitions > 1 || index !== rows.length - 1)
          fail(
            "Put a single scene change or restart at the end of the action list.",
          );
        if (a.type === "restart") return { type: a.type };
        const targets =
          a.type === "goto"
            ? [a.scene]
            : list(a.scenes, 20, "Random destinations");
        if (!targets.length || targets.some((s) => !sceneIds.has(s)))
          fail("Every destination must point to an existing scene.");
        return a.type === "goto"
          ? { type: a.type, scene: a.scene }
          : { type: a.type, scenes: [...targets] };
      }
      if (!types.has(a.variable))
        fail("Choose an existing variable for this action.");
      if (a.type === "toggle" && types.get(a.variable) === "boolean")
        return { type: a.type, variable: a.variable };
      if (a.type === "set" && typeof scalar(a.value) === types.get(a.variable))
        return { type: a.type, variable: a.variable, value: a.value };
      if (a.type === "add" && types.get(a.variable) === "number")
        return {
          type: a.type,
          variable: a.variable,
          value: number(a.value, -1e6, 1e6),
        };
      fail(
        "Choose set, add, toggle, go to scene, random scene, or restart with matching values.",
      );
    });
  }
  const scenes = sceneRows.map((s) => {
    knownFields(s, ['id','title','description','background','media','fit','loop','videoEnd','timer','elements'], 'Scene');
    if (s.timer) knownFields(s.timer, ['seconds','actions'], 'Timer');
    if (s.fit !== undefined && !['contain','cover'].includes(s.fit)) fail('Choose contain or cover for scene media.');
    const media = s.media ?? "";
    if (media && !assetIds.has(media))
      fail("Scene media must refer to an uploaded asset.");
    const elements = list(
      s.elements ?? [],
      EXPERIENCE_LIMITS.elements,
      "Scene elements",
    );
    unique(elements, "Element");
    return {
      id: key(s.id),
      title: text(s.title ?? "", 100, "Scene title"),
      description: text(s.description ?? "", 3000, "Scene description"),
      background: color(s.background ?? "#161b2e"),
      media,
      fit: s.fit === "cover" ? "cover" : "contain",
      loop: s.loop === true,
      videoEnd: actions(s.videoEnd),
      ...(s.timer
        ? {
            timer: {
              seconds: number(s.timer.seconds, 0.5, 3600),
              actions: actions(s.timer.actions),
            },
          }
        : {}),
      elements: elements.map((e) => {
        knownFields(e, ['id','kind','label','x','y','width','height','color','background','transparent','fontSize','motion','when','actions','asset'], 'Element');
        if (!["button", "text", "image"].includes(e.kind))
          fail("Choose button, text, or image.");
        const width = number(e.width, 2, 100),
          height = number(e.height, 2, 100);
        if (
          e.kind === "image" &&
          (!assetIds.has(e.asset) ||
            assets.find((a) => a.id === e.asset)?.kind !== "image")
        )
          fail("Choose an image for this element.");
        return {
          id: key(e.id),
          kind: e.kind,
          label: text(e.label ?? "", 1000, "Element text"),
          x: number(e.x, 0, 100 - width),
          y: number(e.y, 0, 100 - height),
          width,
          height,
          color: color(e.color ?? "#ffffff"),
          background: color(e.background ?? "#4338ca"),
          transparent: e.transparent === true,
          fontSize: number(e.fontSize ?? 18, 12, 64),
          motion: ["none", "float", "pulse", "sway"].includes(
            e.motion ?? "none",
          )
            ? (e.motion ?? "none")
            : fail("Choose none, float, pulse, or sway for motion."),
          when: conditions(e.when),
          ...(e.kind === "button" ? { actions: actions(e.actions) } : {}),
          ...(e.kind === "image" ? { asset: e.asset } : {}),
        };
      }),
    };
  });
  if (!sceneIds.has(input.start)) fail("Choose an existing starting scene.");
  const result = {
    kind: "experience",
    version: 1,
    id: key(input.id),
    name: text(input.name, 80, "Experience name"),
    start: input.start,
    enabled: input.enabled !== false,
    saveProgress: input.saveProgress === true,
    variables,
    assets,
    scenes,
  };
  return {...result, requires: experienceRequirements(result)};
}
export function validateExperienceSlot(value) {
  if (value?.kind === "experience-ref" && hostedExperience(value.url))
    return {
      kind: "experience-ref",
      url: value.url,
      name: text(value.name, 80, "Experience name"),
      enabled: value.enabled !== false,
    };
  return validateExperience(value);
}
export function initialExperienceState(design) {
  return {
    scene: design.start,
    values: Object.fromEntries(design.variables.map((v) => [v.id, v.initial])),
    visit: 0,
  };
}
export function restoreExperienceState(design, saved) {
  const fresh = initialExperienceState(design);
  if (
    !saved ||
    !design.scenes.some((s) => s.id === saved.scene) ||
    !saved.values
  )
    return fresh;
  for (const v of design.variables) {
    const value = saved.values[v.id];
    if (typeof value !== typeof v.initial) return fresh;
    try {
      scalar(value);
    } catch {
      return fresh;
    }
    fresh.values[v.id] = value;
  }
  return { ...fresh, scene: saved.scene };
}
export function conditionsMet(conditions, values) {
  return conditions.every((c) => {
    const a = values[c.variable],
      b = c.value;
    return (
      {
        eq: () => a === b,
        ne: () => a !== b,
        gt: () => a > b,
        gte: () => a >= b,
        lt: () => a < b,
        lte: () => a <= b,
      }[c.op]?.() ?? false
    );
  });
}
export function advanceExperience(
  design,
  state,
  actions,
  random = Math.random,
) {
  let next = { ...state, values: { ...state.values } };
  for (const a of actions) {
    if (a.type === "set") next.values[a.variable] = a.value;
    if (a.type === "toggle") next.values[a.variable] = !next.values[a.variable];
    if (a.type === "add")
      next.values[a.variable] = Math.max(
        -1e9,
        Math.min(1e9, next.values[a.variable] + a.value),
      );
    if (a.type === "restart")
      next = { ...initialExperienceState(design), visit: state.visit + 1 };
    if (a.type === "goto" || a.type === "random")
      next = {
        ...next,
        scene:
          a.type === "goto"
            ? a.scene
            : a.scenes[
                Math.min(
                  a.scenes.length - 1,
                  Math.max(0, Math.floor(random() * a.scenes.length)),
                )
              ],
        visit: state.visit + 1,
      };
  }
  return next;
}
export const experienceText = (value, values) =>
  value.replace(/\{([A-Za-z][A-Za-z0-9_-]{0,63})\}/g, (all, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : all,
  );
export function experienceWarnings(design) {
  const reached = new Set([design.start]),
    queue = [design.start];
  while (queue.length) {
    const current = queue.shift();
    const s = design.scenes.find((s) => s.id === current);
    for (const a of [
      ...s.elements.flatMap((e) => e.actions ?? []),
      ...(s.timer?.actions ?? []),
      ...s.videoEnd,
    ]) {
      for (const target of a.type === "goto"
        ? [a.scene]
        : a.type === "random"
          ? a.scenes
          : [])
        if (!reached.has(target)) {
          reached.add(target);
          queue.push(target);
        }
    }
  }
  return design.scenes
    .filter((s) => !reached.has(s.id))
    .map((s) => `No path from the start reaches “${s.title || s.id}”.`);
}
export function newExperience() {
  return {
    kind: "experience",
    version: 1,
    id: `experience-${crypto.randomUUID()}`,
    name: "My interactive experience",
    enabled: true,
    saveProgress: false,
    start: "start",
    variables: [],
    assets: [],
    scenes: [
      {
        id: "start",
        title: "Start here",
        description: "Your images, your choices, your world.",
        background: "#161b2e",
        media: "",
        elements: [],
      },
    ],
  };
}
export function experiencePrompt(design) {
  return `Create or edit a Scene Studio experience as JSON only, using this data format. No executable code, HTML, scripts, external requests, or invented actions. Preserve existing media IDs and source addresses; only the streamer can upload files. Scenes support images or video via a media asset ID, a title, description, background hex color, fit contain/cover, loop boolean, videoEnd action list and optional timer {seconds:0.5..3600,actions:[]}. Each scene has elements: kind button/text/image, id, label, x/y/width/height in percentages fitting inside 0..100, color/background hex, fontSize 12..64, transparent boolean, motion none/float/pulse/sway, when:[]; image elements use asset ID. Buttons have actions: [{type:'goto',scene:'id'}], {type:'set',variable:'id',value:...}, {type:'add',variable:'id',value:number}, {type:'toggle',variable:'id'}, {type:'random',scenes:['id',...]}, {type:'restart'}. Only one transition/restart, last in the action list. Variables are [{id,initial:boolean|number|string}]. Conditions are ANDed {variable,op:eq/ne/gt/gte/lt/lte,value}; comparisons must match the variable type. Text can show {variableId}. Boolean flags can represent inventory, achievements, and remembered choices. Numeric values can represent scores, resources, or relationships. Each viewer has independent state; no shared votes, verified prizes, payments, game control, or backend integrations. Optional saveProgress stores progress on this device. Up to 100 scenes, 40 elements per scene, 64 variables, 128 media assets, 16 actions per interaction. Every destination and asset reference must exist. Return the whole revised experience, not a patch. Current design:\n${JSON.stringify(design)}\nMy idea: `;
}
