// Fetches Switzer, Career Studio's title font, from Fontshare, unchanged. Its
// licence (ITF Free Font License) allows self-hosting it in our own app, but
// not redistributing it, naming repositories and public servers, so its files
// are never committed: `yarn dev` and `yarn build` run this first.
// https://www.fontshare.com/fonts/switzer
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";

const SOURCE = "https://api.fontshare.com/v2/fonts/download/switzer";
const FILES = ["Switzer-Variable.woff2", "Switzer-VariableItalic.woff2"];
const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fonts", "switzer");

if (FILES.every((file) => existsSync(join(directory, file)))) process.exit(0);

let archive;
try {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Fontshare answered ${response.status}`);
  archive = new Uint8Array(await response.arrayBuffer());
} catch (error) {
  console.error(`Couldn't download Switzer from ${SOURCE}: ${error.message}. Check the connection and try again.`);
  process.exit(1);
}

const entries = unzipSync(archive, { filter: ({ name }) => FILES.some((file) => name.endsWith(`/WEB/fonts/${file}`)) });
mkdirSync(directory, { recursive: true });
for (const file of FILES) {
  const data = Object.entries(entries).find(([name]) => name.endsWith(`/${file}`))?.[1];
  // Every WOFF2 file starts with "wOF2".
  if (!data || String.fromCharCode(...data.subarray(0, 4)) !== "wOF2") {
    console.error(`Fontshare's download has no usable ${file}.`);
    process.exit(1);
  }
  writeFileSync(join(directory, file), data);
}
console.log("Downloaded Switzer from Fontshare.");
