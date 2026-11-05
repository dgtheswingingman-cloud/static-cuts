"use client";

// Messages: your chats with friends (people who follow you back). On
// computers the list sits on the left and a chat opens on the right.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { usePersonalUser } from "../useIsAdmin";
import ChatList from "./ChatList";

export default function MessagesPage() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  return (
    <div className="wrap ms-wrap">
      <div className="ms-shell">
        <ChatList userId={user?.id ?? null} />
        <section className="ms-pane ms-pick" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" /></svg>
          <strong>Pick a chat//</strong>
          <span>Or message a friend from the list.</span>
        </section>
      </div>
    </div>
  );
}
