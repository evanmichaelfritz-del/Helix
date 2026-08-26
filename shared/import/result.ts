import type { ImportRecords } from "../types.ts";

export type ParseOk = { kind: "ok"; records: ImportRecords };
export type ParseFail = { kind: "error"; error: string };
export type ParseResult = ParseOk | ParseFail;
