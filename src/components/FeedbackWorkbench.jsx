import { useEffect, useState } from "react";
import { MessageCircle, MessageSquarePlus, Send, X } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const CATEGORIES = ["전체", "기능요청", "버그신고", "UI/UX", "기타"];

const REACTIONS = [
  { emoji: "👍", label: "좋아요" },
  { emoji: "🔥", label: "급해요" },
  { emoji: "💡", label: "좋은아이디어" },
];

function getOrCreateFingerprint() {
  const key = "c1p_fp";
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(key, fp);
  }
  return fp;
}

function relativeTime(timestamp) {
  const now = Date.now();
  const diff = Math.floor((now - new Date(timestamp).getTime()) / 1000);

  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}일 전`;
  return `${Math.floor(diff / 2592000)}달 전`;
}

const defaultForm = {
  nickname: "익명",
  category: "기능요청",
  title: "",
  content: "",
};

export default function FeedbackWorkbench() {
  const [suggestions, setSuggestions] = useState([]);
  const [userReactions, setUserReactions] = useState([]);
  const [activeCategory, setActiveCategory] = useState("전체");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const fp = getOrCreateFingerprint();

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [{ data: suggData, error: suggErr }, { data: reactData, error: reactErr }] =
        await Promise.all([
          supabase
            .from("suggestion_stats")
            .select("*")
            .order("total_reactions", { ascending: false })
            .order("created_at", { ascending: false }),
          supabase.from("reactions").select("*").eq("fingerprint", fp),
        ]);

      if (suggErr) throw suggErr;
      if (reactErr) throw reactErr;

      setSuggestions(suggData || []);
      setUserReactions(reactData || []);
    } catch (err) {
      setError(err.message || "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    fetchData();
  }, []);

  function hasReacted(suggestionId, emoji) {
    return userReactions.some(
      (r) => r.suggestion_id === suggestionId && r.emoji === emoji
    );
  }

  async function toggleReaction(suggestionId, emoji) {
    if (!isSupabaseConfigured) return;

    const alreadyReacted = hasReacted(suggestionId, emoji);

    // Optimistic update
    if (alreadyReacted) {
      setUserReactions((prev) =>
        prev.filter((r) => !(r.suggestion_id === suggestionId && r.emoji === emoji))
      );
      setSuggestions((prev) =>
        prev.map((s) => {
          if (s.id !== suggestionId) return s;
          const field = reactionField(emoji);
          return field ? { ...s, [field]: Math.max(0, (s[field] || 0) - 1) } : s;
        })
      );
    } else {
      setUserReactions((prev) => [...prev, { suggestion_id: suggestionId, emoji, fingerprint: fp }]);
      setSuggestions((prev) =>
        prev.map((s) => {
          if (s.id !== suggestionId) return s;
          const field = reactionField(emoji);
          return field ? { ...s, [field]: (s[field] || 0) + 1 } : s;
        })
      );
    }

    try {
      if (alreadyReacted) {
        const { error } = await supabase
          .from("reactions")
          .delete()
          .eq("suggestion_id", suggestionId)
          .eq("emoji", emoji)
          .eq("fingerprint", fp);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("reactions")
          .insert({ suggestion_id: suggestionId, emoji, fingerprint: fp });
        if (error) throw error;
      }
    } catch {
      // Revert optimistic update on failure
      fetchData();
    }
  }

  function reactionField(emoji) {
    if (emoji === "👍") return "thumbs_up";
    if (emoji === "🔥") return "fire";
    if (emoji === "💡") return "idea";
    return null;
  }

  function reactionCount(suggestion, emoji) {
    const field = reactionField(emoji);
    return field ? (suggestion[field] || 0) : 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from("suggestions").insert({
        nickname: form.nickname.trim() || "익명",
        category: form.category,
        title: form.title.trim(),
        content: form.content.trim(),
      });
      if (error) throw error;

      setForm(defaultForm);
      setFormOpen(false);
      await fetchData();
    } catch (err) {
      setError(err.message || "건의 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const filteredSuggestions =
    activeCategory === "전체"
      ? suggestions
      : suggestions.filter((s) => s.category === activeCategory);

  if (!isSupabaseConfigured) {
    return (
      <div className="workspace-stack">
        <div className="glass-card" style={{ textAlign: "center", padding: "2rem" }}>
          <MessageCircle size={40} style={{ margin: "0 auto 1rem", opacity: 0.4 }} />
          <p style={{ opacity: 0.6 }}>건의함 기능은 Supabase 연결이 필요합니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-stack">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button
          className="btn-primary"
          onClick={() => setFormOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
        >
          {formOpen ? <X size={16} /> : <MessageSquarePlus size={16} />}
          {formOpen ? "닫기" : "새 건의"}
        </button>
      </div>

      {/* New suggestion form */}
      {formOpen && (
        <div className="glass-card" style={{ padding: "1.25rem" }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: "0.8rem", opacity: 0.7, display: "block", marginBottom: "0.25rem" }}>
                  닉네임
                </label>
                <input
                  className="input-field"
                  type="text"
                  value={form.nickname}
                  onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
                  placeholder="익명"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: "0.8rem", opacity: 0.7, display: "block", marginBottom: "0.25rem" }}>
                  카테고리
                </label>
                <select
                  className="input-field"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.filter((c) => c !== "전체").map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", opacity: 0.7, display: "block", marginBottom: "0.25rem" }}>
                제목 <span style={{ color: "tomato" }}>*</span>
              </label>
              <input
                className="input-field"
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="건의 제목을 입력하세요"
                required
              />
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", opacity: 0.7, display: "block", marginBottom: "0.25rem" }}>
                내용 <span style={{ color: "tomato" }}>*</span>
              </label>
              <textarea
                className="input-field"
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="건의 내용을 자세히 작성해 주세요"
                rows={4}
                required
                style={{ resize: "vertical" }}
              />
            </div>

            {error && (
              <p style={{ color: "tomato", fontSize: "0.85rem", margin: 0 }}>{error}</p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setFormOpen(false); setForm(defaultForm); setError(null); }}
              >
                취소
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || !form.title.trim() || !form.content.trim()}
                style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
              >
                <Send size={14} />
                {submitting ? "등록 중..." : "등록"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Category filter tabs */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: "0.3rem 0.8rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: activeCategory === cat ? 700 : 400,
              background: activeCategory === cat ? "var(--accent, #9b5d33)" : "rgba(255,255,255,0.1)",
              color: activeCategory === cat ? "#fff" : "inherit",
              transition: "background 0.15s",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Suggestion list */}
      {loading ? (
        <div className="glass-card" style={{ textAlign: "center", padding: "2rem", opacity: 0.6 }}>
          불러오는 중...
        </div>
      ) : filteredSuggestions.length === 0 ? (
        <div className="glass-card" style={{ textAlign: "center", padding: "2.5rem" }}>
          <MessageCircle size={36} style={{ margin: "0 auto 0.75rem", opacity: 0.3 }} />
          <p style={{ opacity: 0.5, margin: 0 }}>건의 사항이 없습니다.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filteredSuggestions.map((s) => (
            <div key={s.id} className="glass-card" style={{ padding: "1rem 1.25rem" }}>
              {/* Card header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  marginBottom: "0.4rem",
                  gap: "0.5rem",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: "1rem", flex: 1 }}>{s.title}</span>
                <span
                  style={{
                    fontSize: "0.72rem",
                    padding: "0.15rem 0.55rem",
                    borderRadius: "999px",
                    background: "var(--accent-soft, rgba(155,93,51,0.12))",
                    color: "var(--accent, #9b5d33)",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                  }}
                >
                  {s.category}
                </span>
              </div>

              {/* Content */}
              <p
                style={{
                  margin: "0 0 0.6rem",
                  fontSize: "0.9rem",
                  opacity: 0.8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {s.content}
              </p>

              {/* Meta */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <span style={{ fontSize: "0.78rem", opacity: 0.5 }}>
                  {s.nickname || "익명"} · {relativeTime(s.created_at)}
                </span>

                {/* Reaction buttons */}
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {REACTIONS.map(({ emoji, label }) => {
                    const active = hasReacted(s.id, emoji);
                    const count = reactionCount(s, emoji);
                    return (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(s.id, emoji)}
                        title={label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          padding: "0.2rem 0.6rem",
                          borderRadius: "999px",
                          border: active
                            ? "1.5px solid var(--accent, #9b5d33)"
                            : "1.5px solid var(--line, rgba(55,38,25,0.1))",
                          background: active
                            ? "var(--accent-soft, rgba(155,93,51,0.12))"
                            : "transparent",
                          cursor: "pointer",
                          fontSize: "0.82rem",
                          fontWeight: active ? 700 : 400,
                          color: "inherit",
                          transition: "all 0.15s",
                        }}
                      >
                        <span>{emoji}</span>
                        <span style={{ minWidth: "1ch" }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
