import { useEffect, useRef, useState } from "react";

export default function AdBanner({ slot = "", format = "auto", style = {} }) {
  const adRef = useRef(null);
  const pushed = useRef(false);
  const [adLoaded, setAdLoaded] = useState(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      if (window.adsbygoogle && adRef.current) {
        window.adsbygoogle.push({});
        pushed.current = true;
        setAdLoaded(true);
      }
    } catch (e) {
      // AdSense not loaded or ad blocked
    }
  }, []);

  const adClient = import.meta.env.VITE_GOOGLE_ADSENSE_ID || "ca-pub-XXXXXXXXXX";

  // AdSense 미활성 시 빈 공간 차지하지 않음
  if (adClient === "ca-pub-XXXXXXXXXX" && !adLoaded) return null;

  return (
    <div style={{ textAlign: "center", ...style }}>
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
