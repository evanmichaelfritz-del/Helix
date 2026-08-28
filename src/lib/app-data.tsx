import { useEffect } from "react";
import { pickHealthDay, todaysWorkouts } from "@shared/health.ts";
import { todayLocal } from "@shared/types.ts";
import { ApiError, client } from "./api.ts";
import { useAppState } from "./state.tsx";

export function AppDataLoader() {
  const {
    user,
    gen,
    setPeptides,
    setVials,
    setDoses,
    setHealthDays,
    setHealthWeighIns,
    setHealthWorkouts,
    setTodayPayload,
    setTodayDay,
    setTodayWorkouts,
    setTodayError,
    setAppDataReady,
  } = useAppState();
  const on = todayLocal();

  useEffect(() => {
    if (!user) {
      setPeptides([]);
      setVials([]);
      setDoses([]);
      setHealthDays([]);
      setHealthWeighIns([]);
      setHealthWorkouts([]);
      setTodayPayload(null);
      setTodayDay(null);
      setTodayWorkouts([]);
      setTodayError(null);
      setAppDataReady(false);
      return;
    }

    let cancelled = false;
    void Promise.all([
      client.today(on),
      client.health(),
      client.workouts(on),
      client.peptides(),
      client.vials(),
      client.doses(),
    ])
      .then(([today, health, listed, peptideRes, vialRes, doseRes]) => {
        if (cancelled) return;
        setTodayPayload(today);
        setTodayError(null);
        const matched = pickHealthDay(health.days, on);
        setTodayDay(matched ?? (today.day?.loggedOn === on ? today.day : null));
        setHealthDays(health.days);
        setHealthWeighIns(health.weighIns.length > 0 ? health.weighIns : today.weighIns);
        setHealthWorkouts(health.workouts);
        const fromList = todaysWorkouts(listed.workouts, on);
        const fromToday = todaysWorkouts(today.workouts, on);
        setTodayWorkouts(fromList.length > 0 ? fromList : fromToday);
        setPeptides(peptideRes.peptides);
        setVials(vialRes.vials);
        setDoses(doseRes.doses);
        setAppDataReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTodayError(err instanceof ApiError ? err.message : "Could not load today.");
        setAppDataReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    user,
    gen,
    on,
    setPeptides,
    setVials,
    setDoses,
    setHealthDays,
    setHealthWeighIns,
    setHealthWorkouts,
    setTodayPayload,
    setTodayDay,
    setTodayWorkouts,
    setTodayError,
    setAppDataReady,
  ]);

  return null;
}
