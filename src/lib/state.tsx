import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Peptide, UserPublic } from "@shared/types.ts";

export type Sheet =
  | { kind: "log-dose"; peptideId?: string }
  | { kind: "log-weight" }
  | { kind: "add-peptide" }
  | { kind: "add-vial"; peptideId?: string };

type Toast = { message: string; undo?: () => Promise<void> };

type AppState = {
  user: UserPublic | null;
  setUser: (user: UserPublic | null) => void;
  gen: number;
  bump: () => void;
  sheet: Sheet | null;
  openSheet: (sheet: Sheet) => void;
  closeSheet: () => void;
  peptides: Peptide[];
  setPeptides: (peptides: Peptide[]) => void;
  toast: Toast | null;
  showToast: (toast: Toast) => void;
  clearToast: () => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [gen, setGen] = useState(0);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [peptides, setPeptides] = useState<Peptide[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const bump = useCallback(() => setGen((n) => n + 1), []);
  const value = useMemo(
    () => ({
      user,
      setUser,
      gen,
      bump,
      sheet,
      openSheet: setSheet,
      closeSheet: () => setSheet(null),
      peptides,
      setPeptides,
      toast,
      showToast: (t: Toast) => {
        setToast(t);
        window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 5000);
      },
      clearToast: () => setToast(null),
    }),
    [user, gen, bump, sheet, peptides, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState outside provider");
  return ctx;
}
