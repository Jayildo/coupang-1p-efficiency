import { useEffect, useState, useRef } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";

const HEARTBEAT_INTERVAL = 30000;
const FP_KEY = "c1p_fp";

function getFingerprint() {
  let fp = localStorage.getItem(FP_KEY);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(FP_KEY, fp);
  }
  return fp;
}

export function useActiveUsers() {
  const [count, setCount] = useState(null);
  const [totalVisitors, setTotalVisitors] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const fp = getFingerprint();

    const heartbeat = async () => {
      try {
        await supabase
          .from("active_users")
          .upsert({ fingerprint: fp, last_seen: new Date().toISOString() }, { onConflict: "fingerprint" });
      } catch (e) {
        // heartbeat 실패는 UX에 영향 없으므로 무시
      }
    };

    const fetchCount = async () => {
      try {
        const { data, error } = await supabase.rpc("get_active_user_count");
        if (!error && data !== null) setCount(data);
      } catch (e) {
        // count 조회 실패 시 기존 값 유지
      }
    };

    // 누적 방문자: 첫 방문 시 기록, 총 카운트 조회
    const recordVisit = async () => {
      try {
        await supabase
          .from("visitors")
          .upsert({ fingerprint: fp, first_seen: new Date().toISOString() }, { onConflict: "fingerprint", ignoreDuplicates: true });
        const { count: total, error } = await supabase
          .from("visitors")
          .select("*", { count: "exact", head: true });
        if (!error && total !== null) setTotalVisitors(total);
      } catch (e) {
        // 방문자 기록 실패 무시
      }
    };

    heartbeat();
    fetchCount();
    recordVisit();

    intervalRef.current = setInterval(() => {
      heartbeat();
      fetchCount();
    }, HEARTBEAT_INTERVAL);

    const cleanup = () => {
      supabase.from("active_users").delete().eq("fingerprint", fp).catch(() => {});
    };

    window.addEventListener("beforeunload", cleanup);

    return () => {
      clearInterval(intervalRef.current);
      window.removeEventListener("beforeunload", cleanup);
      cleanup();
    };
  }, []);

  return { activeCount: count, totalVisitors };
}
