import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  Dose,
  HealthDay,
  Peptide,
  RunwayTone,
  TodayPayload,
  UserPublic,
  Vial,
  WeighIn,
  Workout,
} from "@shared/types.ts";

export type VialWithRunway = Vial & {
  remainingInjections: number;
  runwayTone: RunwayTone;
};

export type Sheet =
  | { kind: "log-dose"; peptideId?: string }
  | { kind: "log-weight" }
  | { kind: "add-peptide"; returnTo?: "log-dose" }
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
  vials: VialWithRunway[];
  setVials: (vials: VialWithRunway[]) => void;
  doses: Dose[];
  setDoses: (doses: Dose[]) => void;
  healthDays: HealthDay[];
  setHealthDays: (days: HealthDay[]) => void;
  healthWeighIns: WeighIn[];
  setHealthWeighIns: (weighIns: WeighIn[]) => void;
  healthWorkouts: Workout[];
  setHealthWorkouts: (workouts: Workout[]) => void;
  todayPayload: TodayPayload | null;
  setTodayPayload: (payload: TodayPayload | null) => void;
  todayDay: HealthDay | null;
  setTodayDay: (day: HealthDay | null) => void;
  todayWorkouts: Workout[];
  setTodayWorkouts: (workouts: Workout[]) => void;
  todayError: string | null;
  setTodayError: (error: string | null) => void;
  appDataReady: boolean;
  setAppDataReady: (ready: boolean) => void;
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
  const [vials, setVials] = useState<VialWithRunway[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [healthDays, setHealthDays] = useState<HealthDay[]>([]);
  const [healthWeighIns, setHealthWeighIns] = useState<WeighIn[]>([]);
  const [healthWorkouts, setHealthWorkouts] = useState<Workout[]>([]);
  const [todayPayload, setTodayPayload] = useState<TodayPayload | null>(null);
  const [todayDay, setTodayDay] = useState<HealthDay | null>(null);
  const [todayWorkouts, setTodayWorkouts] = useState<Workout[]>([]);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [appDataReady, setAppDataReady] = useState(false);
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
      vials,
      setVials,
      doses,
      setDoses,
      healthDays,
      setHealthDays,
      healthWeighIns,
      setHealthWeighIns,
      healthWorkouts,
      setHealthWorkouts,
      todayPayload,
      setTodayPayload,
      todayDay,
      setTodayDay,
      todayWorkouts,
      setTodayWorkouts,
      todayError,
      setTodayError,
      appDataReady,
      setAppDataReady,
      toast,
      showToast: (t: Toast) => {
        setToast(t);
        window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 5000);
      },
      clearToast: () => setToast(null),
    }),
    [
      user,
      gen,
      bump,
      sheet,
      peptides,
      vials,
      doses,
      healthDays,
      healthWeighIns,
      healthWorkouts,
      todayPayload,
      todayDay,
      todayWorkouts,
      todayError,
      appDataReady,
      toast,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState outside provider");
  return ctx;
}
