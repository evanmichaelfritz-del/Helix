import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };

const CSP =
  "default-src 'self'; script-src 'self' 'sha256-NEPtdlZLfpQCsV5iZX6uEYvHTddXLrIJfSzKG+l48WQ='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function rules(): HeaderRule[] {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers: HeaderRule[] };
  return config.headers;
}

function bySource(source: string): Header[] {
  const rule = rules().find((item) => item.source === source);
  expect(rule).toBeTruthy();
  return rule?.headers ?? [];
}

function inlineScriptBody(): string {
  const html = readFileSync("index.html", "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
}

describe("vercel security headers", () => {
  it("sets the CSP, frame, sniff, referrer, and permissions headers on every path", () => {
    expect(bySource("/(.*)")).toEqual([
      { key: "Content-Security-Policy", value: CSP },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ]);
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(JSON.stringify(rules())).not.toContain("Strict-Transport-Security");
  });

  it("hashes the theme inline script instead of allowing unsafe-inline scripts", () => {
    const digest = createHash("sha256").update(inlineScriptBody()).digest("base64");
    expect(CSP).toContain(`'sha256-${digest}'`);
  });

  it("replaces the static wildcard CORS header and does not add one for the API", () => {
    expect(bySource("/((?!api/).*)")).toEqual([
      { key: "Access-Control-Allow-Origin", value: "https://helix-green-one.vercel.app" },
    ]);
    expect(bySource("/(.*)")).not.toContainEqual(
      expect.objectContaining({ key: "Access-Control-Allow-Origin" }),
    );
    const corsSources = rules()
      .filter((rule) => rule.headers.some((header) => header.key === "Access-Control-Allow-Origin"))
      .map((rule) => rule.source);
    expect(corsSources).toEqual(["/((?!api/).*)"]);
    expect(JSON.stringify(rules())).not.toContain('"value": "*"');
  });
});
