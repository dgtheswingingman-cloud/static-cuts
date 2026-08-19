"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../../AuthProvider";

type CommentRow = {
  id: string;
  track_id: string;
  parent_comment_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
};

type SortMode = "top" | "newest";

export default function TrackComments({ trackId }: { trackId: string }) {
  const { user } = useAuth();
  const router = useRouter();

  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>("top");
  const [newBody, setNewBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  async function load() {
    const { data: commentRows, error: cErr } = await supabase
      .from("comments")
      .select("id, track_id, parent_comment_id, user_id, body, created_at")
      .eq("track_id", trackId)
      .order("created_at", { ascending: true });
    if (cErr) {
      console.error(cErr);
      return;
    }
    setComments(commentRows ?? []);

    const userIds = Array.from(new Set((commentRows ?? []).map((c) => c.user_id)));
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      const nameMap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => { nameMap[p.id] = p.display_name || "anonymous"; });
      setNames(nameMap);
    }

    const commentIds = (commentRows ?? []).map((c) => c.id);
    if (commentIds.length > 0) {
      const { data: votes } = await supabase
        .from("comment_votes")
        .select("comment_id, user_id")
        .in("comment_id", commentIds);
      const counts: Record<string, number> = {};
      const mine = new Set<string>();
      (votes ?? []).forEach((v: any) => {
        counts[v.comment_id] = (counts[v.comment_id] ?? 0) + 1;
        if (user && v.user_id === user.id) mine.add(v.comment_id);
      });
      setVoteCounts(counts);
      setMyVotes(mine);
    }
  }

  async function postComment(body: string, parentCommentId: string | null) {
    if (!user) { router.push("/login"); return; }
    const trimmed = body.trim();
    if (!trimmed) return;
    setPosting(true);
    const { error } = await supabase.from("comments").insert({
      track_id: trackId,
      parent_comment_id: parentCommentId,
      user_id: user.id,
      body: trimmed,
    });
    setPosting(false);
    if (error) { console.error(error); return; }
    if (parentCommentId) { setReplyBody(""); setReplyingTo(null); }
    else setNewBody("");
    load();
  }

  async function toggleVote(commentId: string) {
    if (!user) { router.push("/login"); return; }
    const hasVoted = myVotes.has(commentId);
    if (hasVoted) {
      await supabase.from("comment_votes").delete().eq("comment_id", commentId).eq("user_id", user.id);
      setMyVotes((prev) => { const n = new Set(prev); n.delete(commentId); return n; });
      setVoteCounts((prev) => ({ ...prev, [commentId]: Math.max(0, (prev[commentId] ?? 1) - 1) }));
    } else {
      await supabase.from("comment_votes").insert({ comment_id: commentId, user_id: user.id });
      setMyVotes((prev) => new Set(prev).add(commentId));
      setVoteCounts((prev) => ({ ...prev, [commentId]: (prev[commentId] ?? 0) + 1 }));
    }
  }

  if (comments === null) {
    return <div className="comments-panel"><div className="comments-count">loading comments…</div></div>;
  }

  const topLevel = comments.filter((c) => !c.parent_comment_id);
  const repliesOf = (id: string) =>
    comments.filter((c) => c.parent_comment_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));

  const sortedTopLevel = [...topLevel].sort((a, b) => {
    if (sort === "newest") return b.created_at.localeCompare(a.created_at);
    return (voteCounts[b.id] ?? 0) - (voteCounts[a.id] ?? 0);
  });

  function renderComment(c: CommentRow, depth: number) {
    const replies = repliesOf(c.id);
    const voted = myVotes.has(c.id);
    return (
      <div key={c.id} className={`comment-item ${depth > 0 ? "reply" : ""}`}>
        <div className="comment-meta">
          {names[c.user_id] ?? "anonymous"} · {new Date(c.created_at).toLocaleDateString()}
        </div>
        <div className="comment-body">{c.body}</div>
        <div className="comment-actions">
          <button
            className={`comment-action-btn ${voted ? "voted" : ""}`}
            onClick={() => toggleVote(c.id)}
          >
            ▲ {voteCounts[c.id] ?? 0}
          </button>
          <button
            className="comment-action-btn"
            onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}
          >
            reply
          </button>
        </div>
        {replyingTo === c.id && (
          <div style={{ marginTop: 8 }}>
            <textarea
              className="comment-textarea"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="write a reply…"
            />
            <button
              className="comment-post-btn"
              disabled={posting}
              onClick={() => postComment(replyBody, c.id)}
            >
              {posting ? "…" : "post reply"}
            </button>
          </div>
        )}
        {replies.map((r) => renderComment(r, depth + 1))}
      </div>
    );
  }

  return (
    <div className="comments-panel">
      <div className="comments-header">
        <div className="comments-count">{comments.length} comment{comments.length === 1 ? "" : "s"}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className={`tab ${sort === "top" ? "active" : ""}`}
            style={{ padding: "3px 9px", fontSize: "0.62rem" }}
            onClick={() => setSort("top")}
          >
            top
          </button>
          <button
            className={`tab ${sort === "newest" ? "active" : ""}`}
            style={{ padding: "3px 9px", fontSize: "0.62rem" }}
            onClick={() => setSort("newest")}
          >
            newest
          </button>
        </div>
      </div>

      {sortedTopLevel.map((c) => renderComment(c, 0))}
      {sortedTopLevel.length === 0 && (
        <div className="comments-count" style={{ marginBottom: 10 }}>
          No comments yet — be the first.
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <textarea
          className="comment-textarea"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder={user ? "add a comment…" : "log in to comment"}
          disabled={!user}
        />
        <button
          className="comment-post-btn"
          disabled={posting || !user}
          onClick={() => postComment(newBody, null)}
        >
          {posting ? "…" : "post comment"}
        </button>
      </div>
    </div>
  );
}
