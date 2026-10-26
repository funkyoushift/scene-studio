import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const folder = new URL("../assets/branding/", import.meta.url);
await mkdir(folder, { recursive: true });
const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect width="1024" height="1024" rx="220" fill="#141a16"/>
<rect x="186" y="196" width="550" height="400" rx="66" fill="#283629" stroke="#445143" stroke-width="12"/>
<rect x="248" y="270" width="550" height="400" rx="66" fill="#a3e635"/>
<circle cx="360" cy="382" r="30" fill="#172217"/>
<path d="M435 368h235M435 416h153" fill="none" stroke="#172217" stroke-width="27" stroke-linecap="round"/>
<path d="M515 499v333l91-90 65 116 76-43-66-113h124z" fill="#f4f7ec" stroke="#141a16" stroke-width="24" stroke-linejoin="round"/>
</svg>`;
await writeFile(new URL("mark.svg", folder), mark);
for (const size of [24, 100, 300, 512]) {
  await sharp(Buffer.from(mark)).resize(size, size).png().toFile(fileURLToPath(new URL(`icon-${size}.png`, folder)));
}
const discovery = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
<rect width="300" height="200" fill="#141a16"/>
<rect x="188" y="-36" width="180" height="180" rx="44" fill="#263326" transform="rotate(18 220 50)"/>
<rect x="204" y="30" width="64" height="46" rx="9" fill="#a3e635"/>
<path d="M235 55v43l12-11 9 16 10-6-9-15h16z" fill="#f4f7ec" stroke="#141a16" stroke-width="3" stroke-linejoin="round"/>
<text x="24" y="46" fill="#a3e635" font-family="sans-serif" font-size="10" font-weight="700" letter-spacing="2">YOUR STREAM.</text>
<text x="24" y="62" fill="#a3e635" font-family="sans-serif" font-size="10" font-weight="700" letter-spacing="2">YOUR INTERACTIONS.</text>
<text x="24" y="115" fill="#f4f7ec" font-family="sans-serif" font-size="30" font-weight="700">Scene Studio</text>
<text x="24" y="144" fill="#c1cbbd" font-family="sans-serif" font-size="13">Make your overlay clickable.</text>
<text x="24" y="164" fill="#c1cbbd" font-family="sans-serif" font-size="13">No coding required.</text>
</svg>`;
await writeFile(new URL("discovery.svg", folder), discovery);
await sharp(Buffer.from(discovery)).png().toFile(fileURLToPath(new URL("discovery-300x200.png", folder)));
console.log("Created editable SVGs, icon PNGs and a 300x200 discovery image in assets/branding.");
