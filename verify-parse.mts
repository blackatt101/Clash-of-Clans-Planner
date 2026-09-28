import { parseExport } from "./src/lib/parse.ts";
import { GameData } from "./src/lib/staticData.ts";
import { readFileSync } from "node:fs";

const data = await GameData.load();
const raw = JSON.parse(readFileSync("/tmp/user-export.json", "utf8"));

try {
  const pv = await parseExport(raw, data);
  console.log("Parse OK, entries:", pv.entries.length);
} catch (e: unknown) {
  console.log("ERROR:", (e as Error).message);
}
