"use client";

// New accounts are sent to the welcome (pick artists, profile, music) once,
// right after signing up. Done when profiles.onboarded_at is set (finishing
// or skipping the last step). Existing accounts were marked done.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../useIsAdmin";

const FREE = ["/welcome", "/start", "/collection/import", "/login", "/reset-password", "/spotify-callback", "/legal", "/faq"];

export async function finishWelcome(userId: string) {
  await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", userId);
}

export default function OnboardingGate() {
  const user = usePersonalUser();
  const path = usePathname() ?? "/";
  const router = useRouter();

  useEffect(() => {
    if (!user || FREE.some((p) => path === p || path.startsWith(p + "/"))) return;
    let cancelled = false;
    supabase.from("profiles").select("onboarded_at").eq("id", user.id).maybeSingle().then(({ data, error }) => {
      // No profile row yet, or the column isn't there: leave them be.
      if (cancelled || error || !data || data.onboarded_at) return;
      router.replace("/welcome");
    });
    return () => { cancelled = true; };
  }, [user, path, router]);

  return null;
}
