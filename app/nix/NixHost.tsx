"use client";

// Starts "Run NIX on this PC" for the owner and admins in the desktop app,
// on every page (the worker itself is in ./worker). Shows nothing.

import { useEffect } from "react";
import { useAuth } from "../AuthProvider";
import { useIsRealAdmin } from "../useIsAdmin";
import { nixAllow } from "./worker";

export default function NixHost() {
  const { user } = useAuth();
  // The real role, not the Admin mode switch: NIX keeps running with it off.
  const isAdmin = useIsRealAdmin();
  useEffect(() => { nixAllow(!!user && isAdmin); }, [user, isAdmin]);
  return null;
}
