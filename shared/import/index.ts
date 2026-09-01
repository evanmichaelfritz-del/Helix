import { parseAppleHealth } from "./apple.js";
import { emptyRecords } from "./empty.js";
import { parseGarmin } from "./garmin.js";
import { parseHelixHelper } from "./helix.js";
import type { ParseResult } from "./result.js";
import { isWhoopZipCsv, parseWhoop, parseWhoopCsvFiles, whoopZipCsvRank } from "./whoop.js";

export { emptyRecords };
export type { ParseFail, ParseOk, ParseResult } from "./result.js";

export async function parseImportFile(file: {
  name: string;
  type: string;
  buffer: ArrayBuffer;
}): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  const text = () => new TextDecoder("utf-8").decode(file.buffer);

  if (looksLikeGarminActivitiesCsv({ name, text: peekText(file.buffer) })) {
    return {
      kind: "error",
      error:
        "Garmin body battery needs the JSON dailies zip, not Connect Activities CSV.",
    };
  }

  if (name.endsWith(".json")) {
    return parseJsonText(text());
  }

  if (name.endsWith(".csv")) {
    return parseWhoop(text());
  }

  if (name.endsWith(".xml")) {
    return parseAppleHealth(text());
  }

  if (name.endsWith(".zip")) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(file.buffer);
    const entries = Object.keys(zip.files);

    if (entries.some((p) => /activities\.csv$/i.test(p)) && !entries.some((p) => p.endsWith(".json"))) {
      return {
        kind: "error",
        error:
          "Garmin body battery needs the JSON dailies zip, not Connect Activities CSV.",
      };
    }

    const helper = entries.find((p) => /helix.*\.json$/i.test(p) || p.endsWith("helix-helper.json"));
    if (helper) {
      const body = await zip.files[helper].async("string");
      return parseHelixHelper(body);
    }

    const xml = entries.find((p) => /export\.xml$/i.test(p));
    if (xml) {
      const body = await zip.files[xml].async("string");
      return parseAppleHealth(body);
    }

    const jsonFiles: { name: string; body: string }[] = [];
    for (const path of entries) {
      if (!path.toLowerCase().endsWith(".json") || zip.files[path].dir) continue;
      jsonFiles.push({ name: path, body: await zip.files[path].async("string") });
    }
    if (jsonFiles.length > 0) {
      return parseGarmin(jsonFiles);
    }

    const whoopCsvs = entries
      .filter((p) => !zip.files[p].dir && isWhoopZipCsv(p))
      .sort((a, b) => whoopZipCsvRank(a) - whoopZipCsvRank(b) || a.localeCompare(b));
    if (whoopCsvs.length > 0) {
      const files: { name: string; body: string }[] = [];
      for (const path of whoopCsvs) {
        files.push({ name: path, body: await zip.files[path].async("string") });
      }
      return parseWhoopCsvFiles(files);
    }

    return { kind: "error", error: "Could not find Whoop, Garmin JSON, Apple Health, or Helix helper data in that zip." };
  }

  return { kind: "error", error: "Use a Whoop CSV, Garmin JSON dailies zip, Apple Health export, or Helix helper JSON." };
}

export function looksLikeGarminActivitiesCsv(file: { name: string; text: string }): boolean {
  const name = file.name.toLowerCase();
  const head = file.text.slice(0, 400).toLowerCase();
  if (name.includes("activit") && name.endsWith(".csv")) return true;
  return (
    head.includes("activity type") &&
    (head.includes("distance") || head.includes("title"))
  );
}

function peekText(buffer: ArrayBuffer): string {
  const slice = buffer.slice(0, 800);
  return new TextDecoder("utf-8").decode(slice);
}

function parseJsonText(text: string): ParseResult {
  const helix = parseHelixHelper(text);
  if (helix.kind === "ok") return helix;
  return parseGarmin([{ name: "upload.json", body: text }]);
}

