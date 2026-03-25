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

  const processOrderData = async () => {
    if (data.length === 0) return;
    setLoading(true);
    setMessage("처리 중...");
    setSelectedGroup(null);

    const costMap = await fetchTransportCosts();
    setTransportCosts(costMap);

    const norm = (v) => (v ? String(v).trim() : "");
    const barcodes = [...new Set(
      data.map((r) => norm(r["바코드"] || r["Barcode"] || r["barcode"] || r["code"] || r["SKU Barcode"] || r["sku barcode"])).filter(Boolean)
    )];
    const cbmMap = await fetchCbmData(barcodes);
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
        const itemCbm = cbmMap[barcode];
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
      {/* ── 3-Column Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Card 1: 파일 업로드 */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <h3 className="font-semibold mb-2">1. 발주서 파일 업로드</h3>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="file-input mb-4" />
          {data.length > 0 && (
            <div className="mt-2">
              <button onClick={processOrderData} disabled={loading}
                className="w-full bg-stone-700 text-white px-6 py-2 rounded-lg shadow hover:bg-stone-800 disabled:bg-slate-400 font-bold transition-all">
                {loading ? "계산 중..." : "데이터 변환 및 요약 계산"}
              </button>
              <p className="mt-2 text-sm text-slate-600 text-center">{message}</p>
            </div>
          )}
        </div>

        {/* Card 2: 요약 대시보드 */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 min-h-[100px] flex items-center justify-center">
          {!dashboardData ? (
            <div className="text-slate-400 text-sm">데이터 변환 버튼을 누르면 요약 대시보드가 표시됩니다.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 w-full text-center">
              <div className="p-2 bg-slate-50 rounded-lg">
                <div className="text-xs text-slate-500 mb-1">예정일&센터</div>
                <div className="text-lg font-bold text-slate-800">{dashboardData.groupCount}</div>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <div className="text-xs text-slate-500 mb-1">총 발주수량</div>
                <div className="text-lg font-bold text-amber-800">{dashboardData.totalQty.toLocaleString()}</div>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <div className="text-xs text-slate-500 mb-1">총 발주금액</div>
                <div className="text-lg font-bold text-amber-800">{dashboardData.totalAmount.toLocaleString()}</div>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <div className="text-xs text-slate-500 mb-1">총 CBM</div>
                <div className="text-lg font-bold text-amber-800">{dashboardData.totalCbm.toFixed(1)}</div>
              </div>
              <div className="p-2 bg-orange-50 rounded-lg border border-orange-100">
                <div className="text-xs text-slate-500 mb-1">팔레트 CBM 기준</div>
                <input type="number" step="0.01" value={paletteCbm}
                  onChange={(e) => setPaletteCbm(parseFloat(e.target.value) || 0)}
                  className="w-full text-center text-lg font-bold text-orange-700 bg-transparent outline-none border-b border-orange-200 focus:border-orange-500" />
              </div>
              <div className="p-2 bg-amber-50 rounded-lg border border-amber-200">
                <div className="text-xs text-slate-500 mb-1">총 팔레트 비용</div>
                <div className="text-lg font-bold text-amber-800">{totalPaletteCost.toLocaleString()} 원</div>
              </div>
            </div>
          )}
        </div>

        {/* Card 3: 입고예정일별 발주금액 */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 min-h-[100px] flex items-center justify-center">
          {!dateStatusGroups ? (
            <div className="text-slate-400 text-sm">입고예정일별 발주금액이 여기에 표시됩니다.</div>
          ) : (() => {
            const dates = Object.keys(dateStatusGroups).sort();
            if (dates.length === 0) return <div className="text-slate-400 text-sm">데이터 없음</div>;
            const totalConfirmed = dates.reduce((s, d) => s + dateStatusGroups[d].confirmed, 0);
            const totalNew = dates.reduce((s, d) => s + dateStatusGroups[d].newOrder, 0);
            return (
              <div className="w-full">
                <div className="text-xs text-slate-500 mb-3 font-semibold">입고예정일별 발주금액</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-200">
                      <th className="text-left py-1.5 px-1">입고예정일</th>
                      <th className="text-right py-1.5 px-1">발주확정</th>
                      <th className="text-right py-1.5 px-1 text-rose-500">신규</th>
                      <th className="text-right py-1.5 px-1">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map((date) => {
                      const g = dateStatusGroups[date];
                      return (
                        <tr key={date} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-1.5 px-1 text-slate-600 font-medium">{date}</td>
                          <td className="py-1.5 px-1 text-right text-slate-500">{g.confirmed > 0 ? g.confirmed.toLocaleString() : "-"}</td>
                          <td className="py-1.5 px-1 text-right text-rose-600 font-semibold">{g.newOrder > 0 ? g.newOrder.toLocaleString() : "-"}</td>
                          <td className="py-1.5 px-1 text-right font-bold text-amber-800">{(g.confirmed + g.newOrder).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2 py-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-700 text-sm font-bold">합계</span>
                    <div className="flex gap-4 items-baseline">
                      <span className="text-slate-400 text-xs">{totalConfirmed.toLocaleString()}</span>
                      <span className="text-rose-500 text-xs">{totalNew.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="text-right mt-1">
                    <span className="text-lg font-extrabold text-amber-800">{(totalConfirmed + totalNew).toLocaleString()} 원</span>
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
          <button onClick={handleExport}
            className="bg-stone-700 text-white px-4 py-2 rounded-lg shadow hover:bg-stone-800 font-bold flex items-center gap-2 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            요약 내보내기
          </button>
        </div>
      )}

      {/* ── 결과 테이블 (날짜별 rowSpan + 소계) ── */}
      {summary.length > 0 && (
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200">
          <table className="w-full text-sm text-left text-slate-500">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b">
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

                      let badgeColor = "bg-slate-100 text-slate-600";
                      if (cost > 0 && maxCost > 0) {
                        if (costRange === 0) {
                          badgeColor = "bg-slate-100 text-slate-800";
                        } else {
                          const ratio = (cost - minCost) / costRange;
                          if (ratio < 0.33) badgeColor = "bg-amber-100 text-amber-700 border border-amber-200";
                          else if (ratio < 0.66) badgeColor = "bg-orange-100 text-orange-700 border border-orange-200";
                          else badgeColor = "bg-rose-100 text-rose-700 border border-rose-200";
                        }
                      }

                      const isFirst = ri === 0;
                      const trClass = isFirst && gi > 0
                        ? "bg-white border-b border-t-2 border-t-slate-300 hover:bg-slate-50"
                        : "bg-white border-b hover:bg-slate-50";

                      return (
                        <tr key={`${gi}-${ri}`} className={trClass}>
                          {isFirst && (
                            <td className="px-6 py-4 font-bold text-slate-900 align-top border-r border-slate-100 bg-slate-50"
                              rowSpan={group.rows.length + 1}>
                              {group.date}
                            </td>
                          )}
                          <td className="px-6 py-4 text-amber-800 cursor-pointer hover:underline transition-colors"
                            onClick={() => { setSelectedGroup(row); navigator.clipboard.writeText(row.center); }}
                            title="클릭: 상세 보기 및 센터명 복사">
                            {row.center}
                          </td>
                          <td className="px-6 py-4">
                            {cost > 0 ? (
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
                                {cost.toLocaleString()}원
                              </span>
                            ) : <span className="text-slate-400 text-xs">-</span>}
                          </td>
                          <td className="px-6 py-4 text-right font-medium text-slate-600">{orderCount}</td>
                          <td className="px-6 py-4 text-right">{row.qty.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right">{row.amount.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right text-amber-800 font-bold">{row.totalCbm.toFixed(1)}</td>
                          <td className="px-6 py-4 text-right text-orange-600 font-bold">{displayP}</td>
                        </tr>
                      );
                    })}
                    {/* 소계 */}
                    <tr className="bg-amber-50 border-b border-amber-200 font-bold text-amber-800">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setSelectedGroup(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-slate-50 px-6 py-4 border-b flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800">
                {selectedGroup.date} - {selectedGroup.center} 상세
              </h3>
              <button onClick={() => setSelectedGroup(null)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-0 max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-6 py-3 font-semibold border-b">발주번호</th>
                    <th className="px-6 py-3 font-semibold border-b text-right">총 CBM</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedGroup.orderList.map((order, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="px-6 py-3 text-slate-700">{order.no}</td>
                      <td className="px-6 py-3 text-right font-medium text-amber-800">{order.cbm.toFixed(2)}</td>
                    </tr>
                  ))}
                  {selectedGroup.orderList.length === 0 && (
                    <tr><td colSpan="2" className="px-6 py-8 text-center text-slate-400">상세 내역이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-slate-50 px-6 py-3 border-t text-right">
              <button onClick={() => setSelectedGroup(null)} className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-100">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
