import { useEffect, useState } from "react";
import { FileSpreadsheet, Files, Layers3, MessageSquarePlus } from "lucide-react";
import OrderWorkbench from "./components/OrderWorkbench";
import DocumentWorkbench from "./components/DocumentWorkbench";
import LoadingWorkbench from "./components/LoadingWorkbench";
import FeedbackWorkbench from "./components/FeedbackWorkbench";
import AdBanner from "./components/AdBanner";
import { useActiveUsers } from "./lib/useActiveUsers";

const TABS = [
  {
    id: "orders",
    label: "발주서 정리",
    desc: "센터별 요약, CBM, 팔레트 예측",
    detail: "발주 엑셀을 업로드하면 입고예정일·물류센터별로 수량, 금액, CBM, 예상 팔레트 수를 자동 계산합니다. 밀크런 운송비 견적에 활용할 수 있습니다.",
    icon: FileSpreadsheet,
  },
  {
    id: "documents",
    label: "거래명세서",
    desc: "PDF 추출·ZIP",
    detail: "쿠팡 거래명세서 PDF에서 제출용 페이지만 자동 추출합니다. 여러 파일을 한 번에 처리하고 ZIP으로 묶어 다운로드할 수 있습니다.",
    icon: Files,
  },
  {
    id: "loading",
    label: "적재리스트",
    desc: "박스·팔레트 배정",
    detail: "발주skulist를 업로드하면 품목별로 집계하고, 박스·팔레트 번호를 배정하여 입고용 적재리스트를 인쇄하거나 엑셀로 내보낼 수 있습니다.",
    icon: Layers3,
  },
  {
    id: "feedback",
    label: "건의함",
    desc: "건의 및 공감",
    detail: "사용 중 불편한 점이나 추가되었으면 하는 기능을 남겨주세요. 다른 사용자의 건의에 공감을 표시할 수도 있습니다.",
    icon: MessageSquarePlus,
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("orders");
  const activeUsers = useActiveUsers();
  const [theme, setTheme] = useState(
    () => localStorage.getItem("c1p-theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("c1p-theme", theme);
  }, [theme]);

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-h">C</span>
          <span className="logo-text">1P</span>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`nav-item${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="nav-icon">
                  <Icon size={20} />
                </span>
                <span className="nav-text">{tab.label}</span>
                <span className="nav-tooltip">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {activeUsers !== null && (
          <div className="sidebar-live">
            <span className="live-dot" />
            <span className="live-text">{activeUsers}명 접속 중</span>
          </div>
        )}

        <div className="sidebar-footer">
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            <span>{theme === "light" ? "🌙" : "☀️"}</span>
            <span className="toggle-text">
              {theme === "light" ? "다크 모드" : "라이트 모드"}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <h1 className="page-title">{TABS.find((t) => t.id === activeTab)?.label}</h1>
        <p className="page-desc">{TABS.find((t) => t.id === activeTab)?.detail}</p>
        <AdBanner slot="top-banner" format="horizontal" style={{ marginBottom: 8 }} />
        {activeTab === "orders" && <OrderWorkbench />}
        {activeTab === "documents" && <DocumentWorkbench />}
        {activeTab === "loading" && <LoadingWorkbench />}
        {activeTab === "feedback" && <FeedbackWorkbench />}
        <AdBanner slot="bottom-banner" format="horizontal" style={{ marginTop: 24 }} />
      </main>
    </div>
  );
}
