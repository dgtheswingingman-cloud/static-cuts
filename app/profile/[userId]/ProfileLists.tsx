"use client";

// Someone's public lists, on their profile.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ListRowView, type ListRow } from "../../lists/ListRow";

export default function ProfileLists({ userId }: { userId: string }) {
  const [lists, setLists] = useState<ListRow[]>([]);
  useEffect(() => {
    supabase.rpc("rpc_browse_lists", { p_kind: "user", p_user: userId }).then(({ data }) => setLists((data as ListRow[]) ?? []));
  }, [userId]);
  if (lists.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-label">Lists ({lists.length})</div>
      {lists.map((l) => <ListRowView key={l.id} l={l} />)}
    </div>
  );
}
