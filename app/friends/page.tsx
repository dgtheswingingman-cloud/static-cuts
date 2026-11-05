"use client";

// Friends now live on your profile's Network tab (friends, follow back,
// friend activity and people to follow). Old links land there.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";

export default function FriendsPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(user ? `/profile/${user.id}#network` : "/login");
  }, [loading, user, router]);
  return <div className="wrap"><div className="empty-state">loading…</div></div>;
}
