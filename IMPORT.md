# Import

Helix does not pull live data from wearables or from grok.me. You drop a file. Nothing is posted back.

Do not paste tokens. Same-email accounts on grok.me are not migrated silently. This app never fetches `https://helix-peptides.grok.me` RPCs.

## grok.me helper JSON

You → Continue on grok.me opens https://helix-peptides.grok.me in a new tab. If the same-origin helper is not live, export or build a helper JSON and drop that file — or a zip that contains it — on You. Wearable zips (Whoop, Garmin, Apple Health) stay on Vitals.

```json
{
  "kind": "helix-helper-json",
  "version": 1,
  "exportedAt": "2026-08-26T00:00:00Z",
  "peptides": [{ "name": "Tesamorelin", "unit": "mcg", "color": "#7EE0C8", "lastAmount": 250 }],
  "vials": [{ "peptideName": "Tesamorelin", "label": "vial 1", "totalAmount": 2500, "remainingAmount": 2000, "dose": 250 }],
  "doses": [{ "peptideName": "Tesamorelin", "amount": 250, "unit": "mcg", "loggedOn": "2026-08-26" }],
  "weighIns": [{ "loggedOn": "2026-08-26", "kg": 82.4 }],
  "healthDays": [{ "loggedOn": "2026-08-26", "whoopRecovery": 71, "sleepHours": 7.4, "strain": 12.1 }],
  "workouts": [{ "loggedOn": "2026-08-26", "name": "Zone 2", "durationMin": 45 }]
}
```

Existing peptide names are skipped, not overwritten. Duplicate doses on the same day are skipped.

## Whoop

CSV with a date column plus some of: `recovery_score`, `day_strain`, `sleep_hours` or `total_sleep_time_milli`, `steps`. A Whoop data-export zip that contains that CSV also works.

## Garmin

Body battery needs a **JSON dailies zip** (Garmin Connect full data export, or any zip of daily JSON that includes `bodyBatteryMostRecentValue` / `bodyBattery` plus `calendarDate`). Connect **Activities CSV is rejected**.

## Apple Health

`export.xml` or the Health export zip that contains it. Helix reads BodyMass, StepCount, SleepAnalysis, and Workout records.
