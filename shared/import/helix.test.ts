import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { HELIX_EXPORT_KIND } from "../types.js";
import { parseHelixHelper, parseHelixHelperFile } from "./helix.js";
import { parseImportFile } from "./index.js";

const RETA_MOTS_HELPER = {
  kind: HELIX_EXPORT_KIND,
  version: 1,
  exportedAt: "2026-09-01T00:00:00Z",
  peptides: [
    { name: "MOTS-C", unit: "mcg", lastAmount: 500 },
    { name: "Retatrutide", unit: "mg", lastAmount: 2 },
  ],
  vials: [
    {
      peptideName: "MOTS-C",
      label: "MOTS-C vial",
      totalAmount: 10000,
      remainingAmount: 8500,
      dose: 500,
    },
    {
      peptideName: "Retatrutide",
      label: "Reta vial",
      totalAmount: 10,
      remainingAmount: 8,
      dose: 2,
    },
  ],
  doses: [
    { peptideName: "MOTS-C", amount: 500, unit: "mcg", loggedOn: "2026-08-30" },
    { peptideName: "Retatrutide", amount: 2, unit: "mg", loggedOn: "2026-08-30" },
  ],
  weighIns: [],
};

function helperJsonBuffer(payload: unknown = RETA_MOTS_HELPER): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(payload)).buffer;
}

async function zipBuffer(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "arraybuffer" });
}

const WHOOP_CYCLES_CSV = `Recovery score %,Day Strain,Cycle start time
67,12.4,2026-08-25T04:12:00.000Z
`;

describe("parseHelixHelperFile", () => {
  it("imports a bare helix-helper-json the same way as parseHelixHelper", async () => {
    const text = JSON.stringify(RETA_MOTS_HELPER);
    const fromText = parseHelixHelper(text);
    const fromFile = await parseHelixHelperFile({
      name: "helix-restore-reta-mots.json",
      type: "application/json",
      buffer: helperJsonBuffer(),
    });
    expect(fromFile).toEqual(fromText);
    expect(fromFile.kind).toBe("ok");
    if (fromFile.kind !== "ok") return;
    expect(fromFile.records.source).toBe("helix");
    expect(fromFile.records.peptides.map((p) => p.name)).toEqual(["MOTS-C", "Retatrutide"]);
    expect(fromFile.records.vials).toHaveLength(2);
    expect(fromFile.records.doses).toHaveLength(2);
    expect(fromFile.records.weighIns).toEqual([]);
  });

  it("unwraps helix-restore-reta-mots.zip when it holds one helper JSON", async () => {
    const buffer = await zipBuffer({
      "helix-restore-reta-mots.json": JSON.stringify(RETA_MOTS_HELPER),
    });
    const parsed = await parseHelixHelperFile({
      name: "helix-restore-reta-mots.zip",
      type: "application/zip",
      buffer,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.source).toBe("helix");
    expect(parsed.records.peptides.map((p) => p.name)).toEqual(["MOTS-C", "Retatrutide"]);
    expect(parsed.records.vials.map((v) => v.peptideName)).toEqual(["MOTS-C", "Retatrutide"]);
    expect(parsed.records.doses).toHaveLength(2);
    expect(parsed.records.weighIns).toEqual([]);
  });

  it("picks the helix-helper-json among several json files in the zip", async () => {
    const buffer = await zipBuffer({
      "notes.json": JSON.stringify({ hello: "world" }),
      "dailies.json": JSON.stringify([{ calendarDate: "2026-08-26", bodyBatteryMostRecentValue: 72 }]),
      "nested/helix-restore-reta-mots.json": JSON.stringify(RETA_MOTS_HELPER),
    });
    const parsed = await parseHelixHelperFile({
      name: "mixed.zip",
      type: "application/zip",
      buffer,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.source).toBe("helix");
    expect(parsed.records.peptides.map((p) => p.name)).toEqual(["MOTS-C", "Retatrutide"]);
  });

  it("rejects a zip with json but no helix-helper-json kind", async () => {
    const buffer = await zipBuffer({
      "dailies.json": JSON.stringify([{ calendarDate: "2026-08-26", bodyBatteryMostRecentValue: 72 }]),
    });
    const parsed = await parseHelixHelperFile({
      name: "garmin-dailies.zip",
      type: "application/zip",
      buffer,
    });
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.error).toMatch(/kind helix-helper-json/);
    expect(parsed.error).not.toMatch(/peptide/i);
  });

  it("rejects a Whoop physiological_cycles zip on the helper path", async () => {
    const buffer = await zipBuffer({
      "physiological_cycles.csv": WHOOP_CYCLES_CSV,
      "workouts.csv": `Activity name,Duration (min),Activity Strain,Cycle start time
Zone 2,45,8.2,2026-08-25T15:00:00.000Z
`,
    });
    const helper = await parseHelixHelperFile({
      name: "whoop.zip",
      type: "application/zip",
      buffer,
    });
    expect(helper.kind).toBe("error");
    if (helper.kind !== "error") return;
    expect(helper.error).toMatch(/Whoop/);
    expect(helper.error).toMatch(/Vitals/);
    expect(helper.error).not.toMatch(/peptide/i);

    const vitals = await parseImportFile({
      name: "whoop.zip",
      type: "application/zip",
      buffer,
    });
    expect(vitals.kind).toBe("ok");
    if (vitals.kind !== "ok") return;
    expect(vitals.records.source).toBe("whoop");
    expect(vitals.records.healthDays[0]?.whoopRecovery).toBe(67);
  });

  it("still rejects token paste on a bare helper JSON", async () => {
    const parsed = await parseHelixHelperFile({
      name: "helper.json",
      type: "application/json",
      buffer: helperJsonBuffer({ ...RETA_MOTS_HELPER, accessToken: "abc" }),
    });
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.error).toMatch(/Token paste/);
  });
});
