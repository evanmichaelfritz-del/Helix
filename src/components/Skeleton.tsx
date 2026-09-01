import { useEffect, useState } from "react";
import { cn } from "@shared/cn.ts";

const SKELETON_DELAY_MS = 150;

export function useDelayedFlag(active: boolean, ms = SKELETON_DELAY_MS): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) {
      setOn(false);
      return;
    }
    const id = window.setTimeout(() => setOn(true), ms);
    return () => window.clearTimeout(id);
  }, [active, ms]);
  return on;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function SkeletonCards({ count = 2 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="card skeleton-card" />
      ))}
    </>
  );
}
