// A user's list: /list/<id>. Loaded in the browser (owners can edit it);
// the title and link preview are filled in here so shared links look right.

import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import ListView from "./ListView";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "List not found · Static Cuts//" };
  const { data } = await supabase.rpc("rpc_list_page", { p_id: id });
  const l = data as { list?: { title: string; description: string | null }; owner?: { name: string }; items?: unknown[] } | null;
  if (!l?.list) return { title: "List · Static Cuts//" };
  const title = `${l.list.title} · a list by ${l.owner?.name ?? "someone"} · Static Cuts//`;
  const description = l.list.description || `${l.items?.length ?? 0} songs, picked by ${l.owner?.name ?? "someone"} on Static Cuts//.`;
  return { title, description, openGraph: { title, description } };
}

export default async function ListPage({ params }: Props) {
  const { id } = await params;
  return <ListView id={id} />;
}
