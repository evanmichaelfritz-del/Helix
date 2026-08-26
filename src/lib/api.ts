import type { TodayPayload, UserPublic } from "@shared/types.ts";
import { todayLocal } from "@shared/types.ts";

export class ApiError {
  readonly kind = "api-error";
  status: number;
  message: string;
  constructor(status: number, message: string) {
    this.status = status;
    this.message = message;
  }
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("X-Local-Date", todayLocal());
  let body = init?.body;
  if (init && "json" in init && init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: "include" });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const client = {
  signup: (email: string, password: string) =>
    api<{ user: UserPublic }>("/api/auth/signup", { method: "POST", json: { email, password } }),
  login: (email: string, password: string) =>
    api<{ user: UserPublic }>("/api/auth/login", { method: "POST", json: { email, password } }),
  logout: () => api<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => api<{ user: UserPublic }>("/api/me"),
  patchMe: (body: {
    displayName?: string | null;
    settings?: Partial<UserPublic["settings"]>;
  }) => api<{ user: UserPublic }>("/api/me", { method: "PATCH", json: body }),
  today: (on = todayLocal()) => api<TodayPayload>(`/api/today?on=${on}`),
  peptides: () => api<{ peptides: import("@shared/types.ts").Peptide[] }>("/api/peptides"),
  createPeptide: (body: { name: string; unit: import("@shared/types.ts").PeptideUnit; color?: string }) =>
    api<{ peptide: import("@shared/types.ts").Peptide }>("/api/peptides", { method: "POST", json: body }),
  vials: () =>
    api<{
      vials: Array<
        import("@shared/types.ts").Vial & {
          remainingInjections: number;
          runwayTone: import("@shared/types.ts").RunwayTone;
        }
      >;
    }>("/api/vials"),
  createVial: (body: {
    peptideId: string;
    label?: string | null;
    totalAmount: number;
    dose: number;
    remainingAmount?: number;
  }) => api("/api/vials", { method: "POST", json: body }),
  doses: (on?: string) =>
    api<{ doses: import("@shared/types.ts").Dose[] }>(`/api/doses${on ? `?on=${on}` : ""}`),
  logDose: (body: {
    peptideId: string;
    amount: number;
    vialId?: string | null;
    loggedOn: string;
  }) => api<{ dose: import("@shared/types.ts").Dose }>("/api/doses", { method: "POST", json: body }),
  undoDose: (id: string) =>
    api<{ dose: import("@shared/types.ts").Dose }>(`/api/doses/${id}/undo`, { method: "POST" }),
  weighIns: () => api<{ weighIns: import("@shared/types.ts").WeighIn[] }>("/api/weigh-ins"),
  logWeight: (body: { kg: number; loggedOn: string }) =>
    api<{ weighIn: import("@shared/types.ts").WeighIn }>("/api/weigh-ins", {
      method: "POST",
      json: body,
    }),
  health: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const s = q.toString();
    return api<{
      days: import("@shared/types.ts").HealthDay[];
      weighIns: import("@shared/types.ts").WeighIn[];
      workouts: import("@shared/types.ts").Workout[];
    }>(`/api/health${s ? `?${s}` : ""}`);
  },
  importRecords: (body: import("@shared/types.ts").ImportRecords) =>
    api<import("@shared/types.ts").ImportResult>("/api/import/records", { method: "POST", json: body }),
};
