import { useEffect, useRef } from "react";

export default function AdBanner({ slot = "", format = "auto", style = {} }) {
  const adRef = useRef(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      if (window.adsbygoogle && adRef.current) {
        window.adsbygoogle.push({});
        pushed.current = true;
      }
    } catch (e) {
      // AdSense not loaded or ad blocked
    }
  }, []);

  const adClient = import.meta.env.VITE_GOOGLE_ADSENSE_ID || "ca-pub-XXXXXXXXXX";

  return (
    <div style={{ textAlign: "center", margin: "8px 0", minHeight: 0, ...style }}>
      <ins
        className="adsbygoogle"
        ref={adRef}
        style={{ display: "block" }}
        data-ad-client={adClient}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
