import React, { useState, useMemo } from "react";
import { read, utils, writeFile } from "xlsx";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const PALLET_CBM = 1.65;

// ── Helpers ────────────────────────────────────────────────────────────

function excelDateToYYMMDD(serial) {
  if (!serial) return "N/A";
  if (typeof serial === "string" && serial.includes("-"))
    return serial.replace(/-/g, "").slice(2, 8);
  if (typeof serial === "string") {
    const d = serial.replace(/\D/g, "");
    if (d.length === 8) return d.slice(2, 8);
    return serial;
  }
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  const y = date.getFullYear().toString().slice(2);
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseNum(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  return parseFloat(String(val).replace(/,/g, "").trim()) || 0;
}

function getVal(row, keys) {
  for (const k of keys) if (row[k] !== undefined) return row[k];
  return undefined;
}

// ── Supabase ───────────────────────────────────────────────────────────

async function fetchCbmData(barcodes) {
  if (!isSupabaseConfigured || barcodes.length === 0) return {};
  const cbmMap = {};
  let dbCols = [];
  try {
    const { data: check, error } = await supabase.from("skulist").select("*").limit(5);
    if (error || !check?.length) return {};
    dbCols = Object.keys(check[0]);
  } catch { return {}; }

  const candidates = ["바코드", "barcode", "Barcode", "code", "SKU ID", "id"];
  const searchKey = candidates.find((k) => dbCols.includes(k)) || "바코드";

  for (let i = 0; i < barcodes.length; i += 200) {
    const chunk = barcodes.slice(i, i + 200);
    const { data, error } = await supabase.from("skulist").select("*").in(searchKey, chunk);
    if (error) return cbmMap;
    (data || []).forEach((item) => {
      const key = String(item[searchKey] || "").trim();
      let val = item.cbm || item.CBM || item.Cbm;
      if (val === undefined) {
        const ck = Object.keys(item).find((k) => k.toLowerCase().includes("cbm"));
        if (ck) val = item[ck];
      }
      cbmMap[key] = parseFloat(val) || 0;
    });
  }
  return cbmMap;
}

async function fetchTransportCosts() {
  if (!isSupabaseConfigured) return {};
  try {
    const { data, error } = await supabase.from("milk_run_costs").select("center_clean, cost_per_pallet");
    if (error) return {};
    const m = {};
    (data || []).forEach((r) => {
      const k = String(r.center_clean || "").replace(/\s+/g, "");
      if (k) m[k] = Number(r.cost_per_pallet) || 0;
    });
    return m;
  } catch { return {}; }
}

// ── Component ──────────────────────────────────────────────────────────

export default function OrderWorkbench() {
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [transportCosts, setTransportCosts] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [paletteCbm, setPaletteCbm] = useState(PALLET_CBM);

  // SKU 정보 업로드 state
  const [localCbmMap, setLocalCbmMap] = useState({});
  const [skuMessage, setSkuMessage] = useState("");

  // 밀크런 비용 입력 state (원본 MilkRunTab 방식: textarea 붙여넣기 → 파싱)
  const [milkRunText, setMilkRunText] = useState("");
  const [localCostRows, setLocalCostRows] = useState([]);
  const [milkRunMessage, setMilkRunMessage] = useState("");

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = read(ev.target.result, { type: "array" });
      const jsonData = utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      setData(jsonData);
      setSummary([]);
      setDashboardData(null);
      setMessage(`${jsonData.length.toLocaleString()}행 로드 완료`);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSkuUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = read(ev.target.result, { type: "array" });
        const jsonData = utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        if (jsonData.length === 0) { setSkuMessage("데이터 없음"); return; }

        const firstRow = jsonData[0];
        const cols = Object.keys(firstRow);

        const barcodeAliases = ["바코드", "barcode", "Barcode", "code", "SKU Barcode", "sku barcode"];
        const cbmAliases = ["cbm", "CBM", "Cbm", "씨비엠"];

        const barcodeCol = barcodeAliases.find((k) => cols.includes(k))
          || cols.find((c) => c.toLowerCase().includes("barcode") || c.toLowerCase().includes("바코드"));
        const cbmCol = cbmAliases.find((k) => cols.includes(k))
          || cols.find((c) => c.toLowerCase().includes("cbm"));

        if (!barcodeCol || !cbmCol) {
          setSkuMessage("바코드/CBM 컬럼을 찾을 수 없습니다");
          return;
        }

        const map = {};
        jsonData.forEach((row) => {
          const barcode = String(row[barcodeCol] || "").trim();
          const cbm = parseFloat(row[cbmCol]) || 0;
          if (barcode) map[barcode] = cbm;
        });

        setLocalCbmMap(map);
        setSkuMessage(`${Object.keys(map).length.toLocaleString()}건 로드됨`);
      } catch (err) {
        setSkuMessage("파일 읽기 오류: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseMilkRunData = () => {
    if (!milkRunText.trim()) {
      setMilkRunMessage("데이터를 입력해주세요.");
      return;
    }
    try {
      const lines = milkRunText.trim().split("\n").map((l) => l.split("\t"));

      // 1. 헤더 행: 첫 셀이 "출고지명"
      const headerIdx = lines.findIndex((l) => l[0]?.trim() === "출고지명");
      // 2. BASIC 행: 3번째 컬럼(index 2)이 "BASIC(1pt 당)"
      const basicIdx = lines.findIndex((l) => l[2]?.trim() === "BASIC(1pt 당)");

      if (headerIdx === -1 || basicIdx === -1) {
        setMilkRunMessage('"출고지명" 행과 계산단위 "BASIC(1pt 당)" 행이 필요합니다.');
        return;
      }

      // 3. 헤더에서 센터명 추출 (4번째 컬럼부터, "이용요금" 메타 텍스트 제외)
      const headerRow = lines[headerIdx];
      const centers = [];
      for (let i = 3; i < headerRow.length; i++) {
        const val = headerRow[i]?.trim();
        if (val && !val.includes("이용요금")) centers.push({ val, colIdx: i });
      }

      // 4. BASIC 행에서 같은 컬럼 인덱스의 비용 추출
      const basicRow = lines[basicIdx];
      const results = [];
      centers.forEach(({ val, colIdx }) => {
        const costRaw = basicRow[colIdx]?.trim()?.replace(/,/g, "");
        const cost = parseFloat(costRaw);
        if (!isNaN(cost) && cost > 0) {
          results.push({
            center_raw: val,
            center_clean: val.split("(")[0].trim(),
            cost_per_pallet: cost,
          });
        }
      });

      setLocalCostRows(results);
      setMilkRunMessage(`${results.length}개 센터 추출 완료`);
    } catch (e) {
      setMilkRunMessage("파싱 오류: " + e.message);
    }
  };

  const processOrderData = async () => {
    if (data.length === 0) return;
    setLoading(true);
    setMessage("처리 중...");
    setSelectedGroup(null);

    // Costs: local takes priority over Supabase
    const supabaseCosts = await fetchTransportCosts();
    const localCostMap = {};
    localCostRows.forEach((r) => {
      const key = (r.center_clean || "").replace(/\s+/g, "");
      if (key && r.cost_per_pallet > 0) localCostMap[key] = r.cost_per_pallet;
    });
    const mergedCostMap = { ...supabaseCosts, ...localCostMap };
    setTransportCosts(mergedCostMap);

    const norm = (v) => (v ? String(v).trim() : "");
    const barcodes = [...new Set(
      data.map((r) => norm(r["바코드"] || r["Barcode"] || r["barcode"] || r["code"] || r["SKU Barcode"] || r["sku barcode"])).filter(Boolean)
    )];

    // CBM: local takes priority over Supabase
    const supabaseCbm = await fetchCbmData(barcodes);
    const mergedCbmMap = { ...supabaseCbm, ...localCbmMap };
    let matchedCount = 0;

    try {
      const groups = {};
      data.forEach((row) => {
        const rawDate = getVal(row, ["입고예정일", "Entry Date", "date", "입고일"]);
        const displayDate = excelDateToYYMMDD(rawDate);
        const center = getVal(row, ["물류센터", "Logistics Center", "목적지", "Destination", "창고"]) || "Unknown";
        const orderNo = getVal(row, ["발주번호", "Order No", "No", "PO No", "Order Number"]) || "Unknown";
        const key = `${displayDate}_${center}`;

        if (!groups[key]) groups[key] = { date: displayDate, center, qty: 0, amount: 0, totalCbm: 0, orders: {} };
        if (!groups[key].orders[orderNo]) groups[key].orders[orderNo] = 0;

        const qty = parseNum(getVal(row, ["발주수량", "Order Qty", "수량", "Qty", "qty"]));
        let amount = parseNum(getVal(row, ["총발주매입금", "총발주 매입금", "총발주금액", "총 발주 금액", "합계금액", "합계", "Total Amount", "Amount", "발주금액"]));
        if (amount === 0) {
          const price = parseNum(getVal(row, ["발주단가", "발주 단가", "매입단가", "Price", "Cost", "단가"]));
          if (price > 0) amount = qty * price;
        }

        const barcode = norm(getVal(row, ["바코드", "Barcode", "barcode", "code", "SKU Barcode", "sku barcode"]));
        const itemCbm = mergedCbmMap[barcode];
        let rowCbm = 0;
        if (itemCbm !== undefined) { matchedCount++; rowCbm = qty * itemCbm; }

        groups[key].totalCbm += rowCbm;
        groups[key].orders[orderNo] += rowCbm;
        groups[key].qty += qty;
        groups[key].amount += amount;
      });

      const result = Object.values(groups)
        .map((g) => ({
          ...g,
          orderList: Object.entries(g.orders).map(([no, cbm]) => ({ no, cbm })).sort((a, b) => b.cbm - a.cbm),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setSummary(result);
      setDashboardData({
        groupCount: result.length,
        totalQty: result.reduce((s, r) => s + r.qty, 0),
        totalAmount: result.reduce((s, r) => s + r.amount, 0),
        totalCbm: result.reduce((s, r) => s + r.totalCbm, 0),
      });
      setMessage(`완료! (CBM 매칭: ${matchedCount}건)`);
    } catch (err) {
      setMessage("오류: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 팔레트 비용 합산
  const totalPaletteCost = useMemo(() => {
    let total = 0;
    summary.forEach((row) => {
      const rawP = paletteCbm > 0 ? row.totalCbm / paletteCbm : 0;
      const pCount = rawP >= 0.5 ? Math.ceil(rawP) : 0;
      const centerKey = row.center.replace(/\s+/g, "");
      total += pCount * (transportCosts[centerKey] || 0);
    });
    return total;
  }, [summary, transportCosts, paletteCbm]);

  // 입고예정일별 발주확정/신규 분류
  const dateStatusGroups = useMemo(() => {
    if (!dashboardData) return null;
    const groups = {};
    data.forEach((row) => {
      const rawDate = getVal(row, ["입고예정일", "Entry Date", "date", "입고일"]);
      const displayDate = excelDateToYYMMDD(rawDate);
      const status = getVal(row, ["발주현황", "Status"]);
      const isConfirmed = status === "발주확정";
      const qty = parseNum(getVal(row, ["발주수량", "Order Qty", "수량", "Qty", "qty"]));
      let amount = parseNum(getVal(row, ["총발주매입금", "총발주 매입금", "총발주금액", "총 발주 금액", "합계금액", "합계", "Total Amount", "Amount", "발주금액"]));
      if (amount === 0) {
        const price = parseNum(getVal(row, ["발주단가", "발주 단가", "매입단가", "Price", "Cost", "단가"]));
        if (price > 0) amount = qty * price;
      }
      if (!groups[displayDate]) groups[displayDate] = { confirmed: 0, newOrder: 0 };
      if (isConfirmed) groups[displayDate].confirmed += amount;
      else groups[displayDate].newOrder += amount;
    });
    return groups;
  }, [dashboardData, data]);

  const handleExport = () => {
    if (summary.length === 0) return;
    const rows = summary.map((g) => {
      const rawP = paletteCbm > 0 ? g.totalCbm / paletteCbm : 0;
      const pCount = rawP >= 0.5 ? Math.ceil(rawP) : 0;
      const centerKey = g.center.replace(/\s+/g, "");
      return {
        입고예정일: g.date, 물류센터: g.center,
        주문건수: g.orderList.length, 총수량: g.qty,
        총금액: Math.round(g.amount), 총CBM: Number(g.totalCbm.toFixed(3)),
        예상팔레트: pCount, 팔레트비용: pCount * (transportCosts[centerKey] || 0),
      };
    });
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.json_to_sheet(rows), "order_summary");
    writeFile(wb, "order-summary.xlsx");
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="p-4">
      {/* ── Row 1: 3 Upload Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Card 1: 발주서 업로드 (필수) */}
        <div className="ow-card">
          <h3 className="font-semibold mb-1">1. 발주서 업로드 <span style={{ color: "var(--hanomad-accent)", fontSize: "0.75rem" }}>필수</span></h3>
          <p className="ow-text-muted mb-3" style={{ fontSize: "0.78rem" }}>서플라이어허브 &gt; 물류 &gt; 발주skulist</p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="file-input mb-4" />
          {data.length > 0 && (
            <div className="mt-2">
              <button onClick={processOrderData} disabled={loading} className="ow-btn-primary px-6 py-2">
                {loading ? "계산 중..." : "데이터 변환 및 요약 계산"}
              </button>
              <p className="mt-2 ow-text-muted text-center">{message}</p>
            </div>
          )}
        </div>

        {/* Card 2: SKU 정보 업로드 (선택) */}
        <div className="ow-card">
          <h3 className="font-semibold mb-1">2. SKU 정보 업로드 <span className="ow-text-muted" style={{ fontSize: "0.75rem" }}>선택</span></h3>
          <p className="ow-text-muted mb-3" style={{ fontSize: "0.78rem" }}>서플라이어허브 &gt; 물류 &gt; 상품공급상태관리</p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleSkuUpload} className="file-input mb-3" />
          {skuMessage && (
            <p className={`text-sm mt-1 ${skuMessage.includes("오류") || skuMessage.includes("없습") ? "ow-text-muted" : "ow-text-secondary"}`}
              style={{ fontWeight: skuMessage.includes("건") ? 600 : 400 }}>
              {skuMessage}
            </p>
          )}
          {!skuMessage && (
            <p className="ow-text-placeholder" style={{ fontSize: "0.8rem" }}>업로드 시 Supabase보다 우선 적용됩니다.</p>
          )}
        </div>

        {/* Card 3: 밀크런 비용 입력 — 엑셀 복사/붙여넣기 방식 (선택) */}
        <div className="ow-card">
          <h3 className="font-semibold mb-2">3. 밀크런 비용 입력 <span className="ow-text-muted" style={{ fontSize: "0.75rem" }}>선택</span></h3>
          <p className="ow-text-muted" style={{ fontSize: "0.78rem", marginBottom: "8px" }}>
            서플라이어허브 &gt; 물류 &gt; 밀크런 &gt; 이용 &gt; 1.이용요금안내<br />
            (출고지명 ~ 오른쪽 하단 끝까지 선택 후 복사)
          </p>
          <textarea
            value={milkRunText}
            onChange={(e) => setMilkRunText(e.target.value)}
            placeholder={"출고지명\t주소\t계산단위\t안성4(14)\t...\n...\tBASIC(1pt 당)\t46,100\t..."}
            style={{
              width: "100%", minHeight: "80px", padding: "8px", fontSize: "0.78rem",
              fontFamily: "monospace", border: "1px solid var(--hanomad-border)",
              borderRadius: "6px", background: "var(--hanomad-input-bg)",
              color: "var(--hanomad-text-dark)", resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
            <button onClick={parseMilkRunData} className="ow-btn-primary" style={{ width: "auto", padding: "6px 14px", fontSize: "0.8rem" }}>
              데이터 변환
            </button>
            <button
              onClick={() => { setMilkRunText(""); setLocalCostRows([]); setMilkRunMessage(""); }}
              style={{
                padding: "6px 14px", fontSize: "0.8rem", borderRadius: "6px", border: "1px solid var(--hanomad-border)",
                background: "var(--hanomad-cream)", color: "var(--hanomad-text-light)", cursor: "pointer",
              }}
            >
              초기화
            </button>
          </div>
          {milkRunMessage && <p className="ow-text-muted" style={{ marginTop: "6px", fontSize: "0.8rem", fontWeight: 600 }}>{milkRunMessage}</p>}
          {localCostRows.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: "8px", maxHeight: "160px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr>
                    <th className="ow-text-muted" style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>센터명</th>
                    <th className="ow-text-muted" style={{ textAlign: "right", padding: "4px 6px", fontWeight: 600 }}>팔레트당 단가</th>
                  </tr>
                </thead>
                <tbody>
                  {localCostRows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--hanomad-border)" }}>
                      <td style={{ padding: "3px 6px", color: "var(--hanomad-brown)", fontWeight: 500 }}>{row.center_clean}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace" }}>{row.cost_per_pallet.toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: 요약 대시보드 + 입고예정일별 발주금액 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Card: 요약 대시보드 */}
        <div className="ow-card min-h-[100px] flex items-center justify-center">
          {!dashboardData ? (
            <div className="ow-text-placeholder">데이터 변환 버튼을 누르면 요약 대시보드가 표시됩니다.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 w-full text-center">
              <div className="ow-stat-cell">
                <div className="ow-stat-label">예정일&센터</div>
                <div className="ow-stat-value-neutral">{dashboardData.groupCount}</div>
              </div>
              <div className="ow-stat-cell">
                <div className="ow-stat-label">총 발주수량</div>
                <div className="ow-stat-value">{dashboardData.totalQty.toLocaleString()}</div>
              </div>
              <div className="ow-stat-cell">
                <div className="ow-stat-label">총 발주금액</div>
                <div className="ow-stat-value">{dashboardData.totalAmount.toLocaleString()}</div>
              </div>
              <div className="ow-stat-cell">
                <div className="ow-stat-label">총 CBM</div>
                <div className="ow-stat-value">{dashboardData.totalCbm.toFixed(1)}</div>
              </div>
              <div className="ow-highlight-cell">
                <div className="ow-stat-label">팔레트 CBM 기준</div>
                <input type="number" step="0.01" value={paletteCbm}
                  onChange={(e) => setPaletteCbm(parseFloat(e.target.value) || 0)}
                  className="ow-highlight-input" />
              </div>
              <div className="ow-summary-cell">
                <div className="ow-stat-label">총 팔레트 비용</div>
                <div className="ow-stat-value">{totalPaletteCost.toLocaleString()} 원</div>
              </div>
            </div>
          )}
        </div>

        {/* Card: 입고예정일별 발주금액 */}
        <div className="ow-card min-h-[100px] flex items-center justify-center">
          {!dateStatusGroups ? (
            <div className="ow-text-placeholder">입고예정일별 발주금액이 여기에 표시됩니다.</div>
          ) : (() => {
            const dates = Object.keys(dateStatusGroups).sort();
            if (dates.length === 0) return <div className="ow-text-placeholder">데이터 없음</div>;
            const totalConfirmed = dates.reduce((s, d) => s + dateStatusGroups[d].confirmed, 0);
            const totalNew = dates.reduce((s, d) => s + dateStatusGroups[d].newOrder, 0);
            return (
              <div className="w-full">
                <div className="ow-stat-label mb-3 font-semibold">입고예정일별 발주금액</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="ow-text-secondary text-xs border-b" style={{borderColor: "var(--hanomad-border)"}}>
                      <th className="text-left py-1.5 px-1">입고예정일</th>
                      <th className="text-right py-1.5 px-1">발주확정</th>
                      <th className="text-right py-1.5 px-1 ow-new-order">신규</th>
                      <th className="text-right py-1.5 px-1">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map((date) => {
                      const g = dateStatusGroups[date];
                      return (
                        <tr key={date} className="border-b" style={{borderColor: "var(--hanomad-border)"}}>
                          <td className="py-1.5 px-1 ow-text-secondary font-medium">{date}</td>
                          <td className="py-1.5 px-1 text-right ow-text-secondary">{g.confirmed > 0 ? g.confirmed.toLocaleString() : "-"}</td>
                          <td className="py-1.5 px-1 text-right ow-new-order">{g.newOrder > 0 ? g.newOrder.toLocaleString() : "-"}</td>
                          <td className="py-1.5 px-1 text-right font-bold ow-text-accent">{(g.confirmed + g.newOrder).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="ow-total-box">
                  <div className="flex justify-between items-center">
                    <span className="ow-text-primary text-sm font-bold">합계</span>
                    <div className="flex gap-4 items-baseline">
                      <span className="ow-text-secondary text-xs">{totalConfirmed.toLocaleString()}</span>
                      <span className="ow-new-order text-xs">{totalNew.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="text-right mt-1">
                    <span className="text-lg font-extrabold ow-text-accent">{(totalConfirmed + totalNew).toLocaleString()} 원</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── 요약 내보내기 ── */}
      {dashboardData && (
        <div className="mb-6 flex justify-end">
          <button onClick={handleExport} className="ow-btn-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            요약 내보내기
          </button>
        </div>
      )}

      {/* ── 결과 테이블 (날짜별 rowSpan + 소계) ── */}
      {summary.length > 0 && (
        <div className="ow-table-wrap">
          <table className="ow-table">
            <thead>
              <tr>
                <th className="px-6 py-3">입고예정일</th>
                <th className="px-6 py-3">물류센터</th>
                <th className="px-6 py-3">팔레트 비용</th>
                <th className="px-6 py-3 text-right">발주서</th>
                <th className="px-6 py-3 text-right">총 발주수량</th>
                <th className="px-6 py-3 text-right">총 발주금액</th>
                <th className="px-6 py-3 text-right">총 CBM</th>
                <th className="px-6 py-3 text-right">팔레트 수</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const dateGroups = {};
                summary.forEach((row) => {
                  if (!dateGroups[row.date]) {
                    dateGroups[row.date] = { date: row.date, rows: [], subTotalQty: 0, subTotalAmount: 0, subTotalCbm: 0, subTotalPallets: 0, subTotalOrders: 0 };
                  }
                  dateGroups[row.date].rows.push(row);
                  const orderCount = row.orderList ? row.orderList.length : 0;
                  dateGroups[row.date].subTotalQty += row.qty;
                  dateGroups[row.date].subTotalAmount += row.amount;
                  dateGroups[row.date].subTotalCbm += row.totalCbm;
                  dateGroups[row.date].subTotalOrders += orderCount;
                  const rawP = paletteCbm > 0 ? row.totalCbm / paletteCbm : 0;
                  if (rawP >= 0.5) dateGroups[row.date].subTotalPallets += Math.ceil(rawP);
                });

                const costs = Object.values(transportCosts);
                const minCost = costs.length > 0 ? Math.min(...costs) : 0;
                const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
                const costRange = maxCost - minCost;

                return Object.values(dateGroups).map((group, gi) => (
                  <React.Fragment key={gi}>
                    {group.rows.map((row, ri) => {
                      const rawP = paletteCbm > 0 ? row.totalCbm / paletteCbm : 0;
                      const displayP = rawP < 0.5 ? "" : Math.ceil(rawP);
                      const orderCount = row.orderList ? row.orderList.length : 0;
                      const centerKey = row.center.replace(/\s+/g, "");
                      const cost = transportCosts[centerKey] || 0;

                      let badgeClass = "ow-badge-neutral";
                      if (cost > 0 && maxCost > 0) {
                        if (costRange === 0) badgeClass = "ow-badge-neutral";
                        else {
                          const ratio = (cost - minCost) / costRange;
                          if (ratio < 0.33) badgeClass = "ow-badge-low";
                          else if (ratio < 0.66) badgeClass = "ow-badge-mid";
                          else badgeClass = "ow-badge-high";
                        }
                      }

                      const isFirst = ri === 0;
                      const trClass = isFirst && gi > 0 ? "ow-group-separator" : "";

                      return (
                        <tr key={`${gi}-${ri}`} className={trClass}>
                          {isFirst && (
                            <td className="ow-date-cell px-6 py-4"
                              rowSpan={group.rows.length + 1}>
                              {group.date}
                            </td>
                          )}
                          <td className="ow-center-cell px-6 py-4"
                            onClick={() => { setSelectedGroup(row); navigator.clipboard.writeText(row.center); }}
                            title="클릭: 상세 보기 및 센터명 복사">
                            {row.center}
                          </td>
                          <td className="px-6 py-4">
                            {cost > 0 ? (
                              <span className={`ow-badge ${badgeClass}`}>
                                {cost.toLocaleString()}원
                              </span>
                            ) : <span className="ow-text-placeholder">-</span>}
                          </td>
                          <td className="px-6 py-4 text-right font-medium ow-text-secondary">{orderCount}</td>
                          <td className="px-6 py-4 text-right">{row.qty.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right">{row.amount.toLocaleString()}</td>
                          <td className="ow-cbm-cell px-6 py-4 text-right">{row.totalCbm.toFixed(1)}</td>
                          <td className="ow-pallet-cell px-6 py-4 text-right">{displayP}</td>
                        </tr>
                      );
                    })}
                    {/* 소계 */}
                    <tr className="ow-subtotal-row">
                      <td className="px-6 py-3 text-center text-xs">소계</td>
                      <td className="px-6 py-3"></td>
                      <td className="px-6 py-3 text-right">{group.subTotalOrders.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right">{group.subTotalQty.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right">{group.subTotalAmount.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right">{group.subTotalCbm.toFixed(1)}</td>
                      <td className="px-6 py-3 text-right">{group.subTotalPallets > 0 ? group.subTotalPallets : ""}</td>
                    </tr>
                  </React.Fragment>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal ── */}
      {selectedGroup && (
        <div className="ow-modal-overlay" onClick={() => setSelectedGroup(null)}>
          <div className="ow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ow-modal-header">
              <h3>
                {selectedGroup.date} - {selectedGroup.center} 상세
              </h3>
              <button onClick={() => setSelectedGroup(null)} className="ow-modal-close">&times;</button>
            </div>
            <div className="ow-modal-body">
              <table className="w-full text-sm text-left">
                <thead className="ow-table-wrap text-xs uppercase sticky top-0" style={{background: "var(--hanomad-cream)"}}>
                  <tr>
                    <th className="px-6 py-3 font-semibold border-b" style={{borderColor: "var(--hanomad-border)"}}>발주번호</th>
                    <th className="px-6 py-3 font-semibold border-b text-right" style={{borderColor: "var(--hanomad-border)"}}>총 CBM</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedGroup.orderList.map((order, i) => (
                    <tr key={i} className="border-b last:border-0" style={{borderColor: "var(--hanomad-border)"}}>
                      <td className="px-6 py-3 ow-text-primary">{order.no}</td>
                      <td className="px-6 py-3 text-right font-medium ow-text-accent">{order.cbm.toFixed(2)}</td>
                    </tr>
                  ))}
                  {selectedGroup.orderList.length === 0 && (
                    <tr><td colSpan="2" className="px-6 py-8 text-center ow-text-placeholder">상세 내역이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="ow-modal-footer">
              <button onClick={() => setSelectedGroup(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
