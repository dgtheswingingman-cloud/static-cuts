"use client";

// Whether the signed-in person has premium (Local Cuts). The owner always
// does; others are given it in the control room (Owner → Premium) until
// payments are set up. null while checking.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

export function usePremium(): { premium: boolean | null; until: string | null } {
  const { user, loading } = useAuth();
  const [state, setState] = useState<{ premium: boolean | null; until: string | null }>({ premium: null, until: null });
  useEffect(() => {
    if (loading) return;
    if (!user) { setState({ premium: false, until: null }); return; }
    let live = true;
    supabase.rpc("rpc_my_premium").then(({ data }) => {
      if (!live) return;
      const d = data as { premium?: boolean; until?: string | null } | null;
      setState({ premium: !!d?.premium, until: d?.until ?? null });
    });
    return () => { live = false; };
  }, [user?.id, loading]);
  return state;
}
