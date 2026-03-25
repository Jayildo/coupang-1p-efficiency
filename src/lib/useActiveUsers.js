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
        // heartbeat 실패는 UX에 영향 없으므로 무시 (네트워크 일시 불량 등)
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

    heartbeat();
    fetchCount();

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

  return count;
}
