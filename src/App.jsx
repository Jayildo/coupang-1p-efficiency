import { useEffect, useState } from "react";
import { FileSpreadsheet, Files, Layers3, MessageSquarePlus } from "lucide-react";
import OrderWorkbench from "./components/OrderWorkbench";
import DocumentWorkbench from "./components/DocumentWorkbench";
import LoadingWorkbench from "./components/LoadingWorkbench";
import FeedbackWorkbench from "./components/FeedbackWorkbench";

const TABS = [
  {
    id: "orders",
    label: "발주서 정리",
    desc: "센터별 요약, CBM, 팔레트 예측",
    icon: FileSpreadsheet,
  },
  {
    id: "documents",
    label: "거래명세서",
    desc: "PDF 추출·ZIP",
    icon: Files,
  },
  {
    id: "loading",
    label: "적재리스트",
    desc: "박스·팔레트 배정",
    icon: Layers3,
  },
  {
    id: "feedback",
    label: "건의함",
    desc: "건의 및 공감",
    icon: MessageSquarePlus,
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("orders");
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
        {activeTab === "orders" && <OrderWorkbench />}
        {activeTab === "documents" && <DocumentWorkbench />}
        {activeTab === "loading" && <LoadingWorkbench />}
        {activeTab === "feedback" && <FeedbackWorkbench />}
      </main>
    </div>
  );
}
