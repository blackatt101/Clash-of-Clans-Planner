import { parseExport } from "@/lib/parse";
import { GameData } from "@/lib/staticData";
import { readFileSync } from "fs";

const data = await GameData.load();
const raw = JSON.parse(readFileSync("/tmp/user-export.json", "utf8"));

try {
  const pv = await parseExport(raw, data);
  console.log("Parse OK, entries:", pv.entries.length);
} catch (e: unknown) {
  console.log("ERROR:", (e as Error).message);
}
