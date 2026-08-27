import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseImportFile } from "./index.js";
import { parseWhoop, parseWhoopCsvFiles, WHOOP_IMPORT_CAP } from "./whoop.js";

function addUtcDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("parseWhoop live headers", () => {
  it("parses Recovery score %, Day Strain, Asleep duration (min), Cycle start time", () => {
    const csv = `Recovery score %,Day Strain,Asleep duration (min),Cycle start time
67,12.4,420,2026-08-25T04:12:00.000Z
`;
    const parsed = parseWhoop(csv);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.source).toBe("whoop");
    expect(parsed.records.healthDays).toEqual([
      {
        loggedOn: "2026-08-25",
        whoopRecovery: 67,
        strain: 12.4,
        sleepHours: 7,
      },
    ]);
  });

  it("keeps old recovery_score / day_strain / sleep_hours / date aliases", () => {
    const csv = `date,recovery_score,day_strain,sleep_hours
2026-08-25,71,12.1,7.4
`;
    const parsed = parseWhoop(csv);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.healthDays[0]).toMatchObject({
      loggedOn: "2026-08-25",
      whoopRecovery: 71,
      strain: 12.1,
      sleepHours: 7.4,
    });
  });

  it("keeps recovery score, whoop_recovery, strain, and sleep_minutes aliases", () => {
    const csv = `day,recovery score,strain,sleep_minutes
2026-08-24,80,9.5,480
`;
    const parsed = parseWhoop(csv);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.healthDays[0]).toMatchObject({
      loggedOn: "2026-08-24",
      whoopRecovery: 80,
      strain: 9.5,
      sleepHours: 8,
    });

    const whoopCsv = `logged_on,whoop_recovery
2026-08-23,55
`;
    const whoopParsed = parseWhoop(whoopCsv);
    expect(whoopParsed.kind).toBe("ok");
    if (whoopParsed.kind !== "ok") return;
    expect(whoopParsed.records.healthDays[0]).toMatchObject({
      loggedOn: "2026-08-23",
      whoopRecovery: 55,
    });
  });

  it("keeps the newest 400 unique days when the export is over the cap", () => {
    const start = "2025-06-02";
    const dates = Array.from({ length: 450 }, (_, i) => addUtcDays(start, i));
    const header = "Recovery score %,Day Strain,Asleep duration (min),Cycle start time";
    const rows = dates.map(
      (loggedOn, i) => `${40 + (i % 50)},${(i % 20) + 1}.2,${300 + (i % 120)},${loggedOn}T04:00:00.000Z`,
    );
    const parsed = parseWhoop([header, ...rows].join("\n"));
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.healthDays).toHaveLength(WHOOP_IMPORT_CAP);
    const kept = parsed.records.healthDays.map((d) => d.loggedOn);
    expect(kept[0]).toBe(dates[dates.length - WHOOP_IMPORT_CAP]);
    expect(kept[kept.length - 1]).toBe(dates[dates.length - 1]);
    expect(kept).not.toContain(dates[0]);
    expect(new Set(kept).size).toBe(WHOOP_IMPORT_CAP);
  });

  it("drops workouts whose day fell outside the kept 400, then caps at 400 newest", () => {
    const start = "2025-06-02";
    const dates = Array.from({ length: 450 }, (_, i) => addUtcDays(start, i));
    const header = "Recovery score %,Day Strain,Activity name,Duration (min),Activity Strain,Cycle start time";
    const rows = dates.map(
      (loggedOn, i) =>
        `${50},${8.1},Ride ${i},40,${(i % 10) + 1},${loggedOn}T15:00:00.000Z`,
    );
    const parsed = parseWhoop([header, ...rows].join("\n"));
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.healthDays).toHaveLength(WHOOP_IMPORT_CAP);
    expect(parsed.records.workouts).toHaveLength(WHOOP_IMPORT_CAP);
    const workoutDays = parsed.records.workouts.map((w) => w.loggedOn);
    expect(workoutDays).not.toContain(dates[0]);
    expect(workoutDays[0]).toBe(dates[dates.length - WHOOP_IMPORT_CAP]);
    expect(workoutDays[workoutDays.length - 1]).toBe(dates[dates.length - 1]);
    expect(parsed.records.workouts[0]?.name).toBe(`Ride ${dates.length - WHOOP_IMPORT_CAP}`);
    expect(parsed.records.workouts.at(-1)?.name).toBe("Ride 449");
  });
});

describe("Whoop zip", () => {
  it("reads workouts.csv next to physiological_cycles.csv and ignores journal_entries.csv", async () => {
    const zip = new JSZip();
    zip.file(
      "physiological_cycles.csv",
      `Recovery score %,Day Strain,Cycle start time
67,12.4,2026-08-24T04:12:00.000Z
71,8.1,2026-08-25T04:00:00.000Z
`,
    );
    zip.file(
      "workouts.csv",
      `Activity name,Duration (min),Activity Strain,Cycle start time
Zone 2,45,8.2,2026-08-25T15:00:00.000Z
Lift,30,7.1,2026-08-24T18:00:00.000Z
`,
    );
    zip.file(
      "journal_entries.csv",
      `date,recovery_score,day_strain
2026-01-01,1,1
`,
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const parsed = await parseImportFile({
      name: "whoop.zip",
      type: "application/zip",
      buffer,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.healthDays).toHaveLength(2);
    expect(parsed.records.healthDays.map((d) => d.loggedOn)).toEqual(["2026-08-24", "2026-08-25"]);
    expect(parsed.records.healthDays.find((d) => d.loggedOn === "2026-08-25")).toMatchObject({
      whoopRecovery: 71,
      strain: 8.1,
    });
    expect(parsed.records.healthDays.map((d) => d.loggedOn)).not.toContain("2026-01-01");
    expect(parsed.records.workouts).toEqual([
      { loggedOn: "2026-08-25", name: "Zone 2", durationMin: 45, strain: 8.2 },
      { loggedOn: "2026-08-24", name: "Lift", durationMin: 30, strain: 7.1 },
    ]);
  });

  it("reads workout loggedOn from Start time", () => {
    const parsed = parseWhoopCsvFiles([
      {
        name: "physiological_cycles.csv",
        body: `Recovery score %,Cycle start time
70,2026-08-25T00:00:00.000Z
`,
      },
      {
        name: "workouts.csv",
        body: `Activity name,Duration (min),Activity Strain,Start time
Zone 2,45,8.2,2026-08-25T15:00:00.000Z
`,
      },
    ]);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.workouts).toEqual([
      { loggedOn: "2026-08-25", name: "Zone 2", durationMin: 45, strain: 8.2 },
    ]);
  });

  it("merges sleeps.csv asleep duration onto cycle days by loggedOn", async () => {
    const parsed = parseWhoopCsvFiles([
      {
        name: "physiological_cycles.csv",
        body: `Recovery score %,Day Strain,Cycle start time
67,12.4,2026-08-25T04:12:00.000Z
`,
      },
      {
        name: "sleeps.csv",
        body: `Asleep duration (min),Cycle start time
450,2026-08-25T04:12:00.000Z
`,
      },
    ]);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.records.healthDays).toEqual([
      {
        loggedOn: "2026-08-25",
        whoopRecovery: 67,
        strain: 12.4,
        sleepHours: 7.5,
      },
    ]);
  });
});
