"use client";

// Whether the signed-in person has premium (Local Cuts, premium profile, the
// supporter badge). The owner always does; others pay through Stripe
// (/premium) or are given it in the control room (Owner → Premium).
// null while checking. stripe = their subscription's status when they pay;
// customer = they've been to Stripe's checkout before.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

type State = { premium: boolean | null; until: string | null; stripe: string | null; customer: boolean };

export function usePremium(): State & { reload: () => void } {
  const { user, loading } = useAuth();
  const [state, setState] = useState<State>({ premium: null, until: null, stripe: null, customer: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (loading) return;
    if (!user) { setState({ premium: false, until: null, stripe: null, customer: false }); return; }
    let live = true;
    supabase.rpc("rpc_my_premium").then(({ data }) => {
      if (!live) return;
      const d = data as { premium?: boolean; until?: string | null; stripe?: string | null; customer?: boolean } | null;
      setState({ premium: !!d?.premium, until: d?.until ?? null, stripe: d?.stripe ?? null, customer: !!d?.customer });
    });
    return () => { live = false; };
  }, [user?.id, loading, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
