import { useMemo, useState } from "react";
import {
  FileSpreadsheet,
  Files,
  Layers3,
  MessageSquarePlus
} from "lucide-react";
import OrderWorkbench from "./components/OrderWorkbench";
import DocumentWorkbench from "./components/DocumentWorkbench";
import LoadingWorkbench from "./components/LoadingWorkbench";
import FeedbackWorkbench from "./components/FeedbackWorkbench";

const views = [
  {
    id: "orders",
    label: "발주서 정리",
    title: "발주서 정리",
    description: "센터별 요약, CBM, 팔레트 예측"
  },
  {
    id: "documents",
    label: "거래명세서",
    title: "거래명세서",
    description: "PDF 추출 및 ZIP 정리"
  },
  {
    id: "loading",
    label: "적재리스트",
    title: "적재리스트",
    description: "박스·팔레트 배정과 내보내기"
  },
  {
    id: "feedback",
    label: "건의함",
    title: "건의함",
    description: "개선 건의 및 공감"
  }
];

export default function App() {
  const [activeView, setActiveView] = useState("orders");

  const activeMeta = useMemo(
    () => views.find((view) => view.id === activeView) ?? views[0],
    [activeView]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">C1P</div>
          <div>
            <p className="brand-kicker">효율화 프로젝트</p>
            <h2>쿠팡 1p</h2>
          </div>
        </div>

        <nav className="nav-list">
          {views.map((view) => (
            <button
              key={view.id}
              className={view.id === activeView ? "nav-item active" : "nav-item"}
              onClick={() => setActiveView(view.id)}
            >
              <strong>{view.label}</strong>
              <span>{view.description}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note glass-card">
          쿠팡 1p 셀러를 위한 발주·문서·적재 워크스페이스입니다.
        </div>
      </aside>

      <main className="main-panel">
        <header className="page-header glass-card">
          <div>
            <div className="section-label">{activeMeta.title}</div>
            <h1>{activeMeta.label}</h1>
            <p>{activeMeta.description}</p>
          </div>
        </header>

        {activeView === "orders" && <OrderWorkbench />}
        {activeView === "documents" && <DocumentWorkbench />}
        {activeView === "loading" && <LoadingWorkbench />}
        {activeView === "feedback" && <FeedbackWorkbench />}
      </main>
    </div>
  );
}
