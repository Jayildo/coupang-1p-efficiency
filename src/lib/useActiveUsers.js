import { useEffect, useState, useRef } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
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

    // Heartbeat: upsert current user
    const heartbeat = async () => {
      try {
        await supabase
          .from("active_users")
          .upsert({ fingerprint: fp, last_seen: new Date().toISOString() }, { onConflict: "fingerprint" });
      } catch {}
    };

    // Fetch count
    const fetchCount = async () => {
      try {
        const { data, error } = await supabase.rpc("get_active_user_count");
        if (!error && data !== null) setCount(data);
      } catch {}
    };

    // Initial
    heartbeat();
    fetchCount();

    // Interval
    intervalRef.current = setInterval(() => {
      heartbeat();
      fetchCount();
    }, HEARTBEAT_INTERVAL);

    // Cleanup on unmount (remove user)
    const cleanup = () => {
      supabase.from("active_users").delete().eq("fingerprint", fp).then(() => {});
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
