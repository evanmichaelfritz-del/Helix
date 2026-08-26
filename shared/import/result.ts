import type { ImportRecords } from "../types.js";

export type ParseOk = { kind: "ok"; records: ImportRecords };
export type ParseFail = { kind: "error"; error: string };
export type ParseResult = ParseOk | ParseFail;
