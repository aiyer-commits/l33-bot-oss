import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const OUTPUT_DIR = path.join(process.cwd(), "public", "ime");
const USER_AGENT = "l33-bot-ime-pack-builder";
const PACK_PREFIXES = ["ja-mozc.", "zh-rime-ice."];

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function appendCandidate(map, key, candidate, limit = 12) {
  if (!key || !candidate) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, [candidate]);
    return;
  }
  if (existing.length >= limit || existing.includes(candidate)) return;
  existing.push(candidate);
}

function parseRimeDictionary(source, map) {
  const lines = source.split("\n");
  let inBody = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (!inBody) {
      if (line === "...") inBody = true;
      continue;
    }
    const parts = rawLine.split("\t");
    if (parts.length < 2) continue;
    const phrase = parts[0]?.trim();
    const reading = parts[1]?.trim().replace(/\s+/g, "").toLowerCase();
    if (!phrase || !reading) continue;
    appendCandidate(map, reading, phrase);
  }
}

function parseMozcDictionary(source, map) {
  const lines = source.split("\n");
  for (const rawLine of lines) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    const parts = rawLine.split("\t");
    if (parts.length < 5) continue;
    const reading = parts[0]?.trim();
    const candidate = parts[4]?.trim();
    if (!reading || !candidate) continue;
    appendCandidate(map, reading, candidate);
  }
}

async function buildChinesePack() {
  const manifest = await fetchText("https://raw.githubusercontent.com/iDvel/rime-ice/main/rime_ice.dict.yaml");
  const imports = [];
  for (const line of manifest.split("\n")) {
    const match = line.match(/^\s*-\s+([A-Za-z0-9_/-]+)/);
    if (match?.[1]) imports.push(match[1]);
  }
  const map = new Map();
  for (const table of imports) {
    const url = `https://raw.githubusercontent.com/iDvel/rime-ice/main/${table}.dict.yaml`;
    const source = await fetchText(url);
    parseRimeDictionary(source, map);
  }
  return {
    source: "rime-ice",
    generatedAt: new Date().toISOString(),
    candidates: Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function buildJapanesePack() {
  const map = new Map();
  for (let index = 0; index <= 9; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const url = `https://raw.githubusercontent.com/google/mozc/master/src/data/dictionary_oss/dictionary${suffix}.txt`;
    const source = await fetchText(url);
    parseMozcDictionary(source, map);
  }
  return {
    source: "mozc_dictionary_oss",
    generatedAt: new Date().toISOString(),
    candidates: Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const existingFiles = await readdir(OUTPUT_DIR).catch(() => []);
  await Promise.all(
    existingFiles
      .filter((name) => PACK_PREFIXES.some((prefix) => name.startsWith(prefix)) || name === "manifest.json")
      .map((name) => rm(path.join(OUTPUT_DIR, name), { force: true })),
  );
  const [japanesePack, chinesePack] = await Promise.all([buildJapanesePack(), buildChinesePack()]);
  const japanesePayload = JSON.stringify(japanesePack);
  const chinesePayload = JSON.stringify(chinesePack);
  const japaneseHash = crypto.createHash("sha256").update(japanesePayload).digest("hex").slice(0, 12);
  const chineseHash = crypto.createHash("sha256").update(chinesePayload).digest("hex").slice(0, 12);
  const japaneseFilename = `ja-mozc.${japaneseHash}.json`;
  const chineseFilename = `zh-rime-ice.${chineseHash}.json`;
  await writeFile(path.join(OUTPUT_DIR, japaneseFilename), japanesePayload);
  await writeFile(path.join(OUTPUT_DIR, chineseFilename), chinesePayload);
  await writeFile(
    path.join(OUTPUT_DIR, "manifest.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      packs: {
        japanese: japaneseFilename,
        chinese: chineseFilename,
      },
    }),
  );
  console.log("IME packs written to", OUTPUT_DIR);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
