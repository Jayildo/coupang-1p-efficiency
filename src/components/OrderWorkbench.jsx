import { useMemo, useState } from "react";
import { Download, FileUp, RefreshCcw } from "lucide-react";
import { read, utils, writeFile } from "xlsx";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const paletteCbm = 1.65;

// ── Helpers (원본 로직 그대로) ──────────────────────────────────────────

function excelDateToYYMMDD(serial) {
  if (!serial) return "N/A";
  if (typeof serial === "string" && serial.includes("-"))
    return serial.replace(/-/g, "").slice(2, 8);
  if (typeof serial === "string") {
    const digits = serial.replace(/\D/g, "");
    if (digits.length === 8) return digits.slice(2, 8);
    return serial;
  }
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const d = new Date(utcValue * 1000);
  const y = d.getFullYear().toString().slice(2);
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseNum(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  const str = String(val).replace(/,/g, "").trim();
  return parseFloat(str) || 0;
}

function getVal(row, keys) {
  for (const k of keys) if (row[k] !== undefined) return row[k];
  return undefined;
}

// ── Supabase fetch (graceful fallback) ─────────────────────────────────

async function fetchCbmData(barcodes) {
  if (!isSupabaseConfigured || barcodes.length === 0) return {};

  const cbmMap = {};
  let dbCols = [];

  // DB 컬럼 탐색
  try {
    const { data: checkData, error: checkError } = await supabase
      .from("skulist")
      .select("*")
      .limit(5);
    if (checkError || !checkData || checkData.length === 0) return {};
    dbCols = Object.keys(checkData[0]);
  } catch {
    return {};
  }

  const candidates = ["바코드", "barcode", "Barcode", "code", "SKU ID", "id"];
  const searchKey = candidates.find((k) => dbCols.includes(k)) || "바코드";
  const CHUNK = 200;

  for (let i = 0; i < barcodes.length; i += CHUNK) {
    const chunk = barcodes.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("skulist")
      .select("*")
      .in(searchKey, chunk);

    if (error) {
      console.warn("skulist 조회 실패:", error.message);
      return cbmMap;
    }

    (data || []).forEach((item) => {
      const key = String(item[searchKey] || "").trim();
      let val = item.cbm || item.CBM || item.Cbm;
      if (val === undefined) {
        const cbmKey = Object.keys(item).find((k) =>
          k.toLowerCase().includes("cbm")
        );
        if (cbmKey) val = item[cbmKey];
      }
      cbmMap[key] = parseFloat(val) || 0;
    });
  }

  return cbmMap;
}

async function fetchTransportCosts() {
  if (!isSupabaseConfigured) return {};
  try {
    const { data, error } = await supabase
      .from("milk_run_costs")
      .select("center_clean, cost_per_pallet");
    if (error) return {};
    const result = {};
    (data || []).forEach((item) => {
      const key = String(item.center_clean || "").replace(/\s+/g, "");
      if (key) result[key] = Number(item.cost_per_pallet) || 0;
    });
    return result;
  } catch {
    return {};
  }
}

// ── Component ──────────────────────────────────────────────────────────

export default function OrderWorkbench() {
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState([]);
  const [transportCosts, setTransportCosts] = useState({});
  const [message, setMessage] = useState("발주 파일을 업로드하세요.");
  const [loading, setLoading] = useState(false);

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = read(ev.target.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = utils.sheet_to_json(ws);
      setData(jsonData);
      setSummary([]);
      setMessage(`${jsonData.length.toLocaleString()}행을 불러왔습니다.`);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleProcess = async () => {
    if (data.length === 0) {
      setMessage("먼저 발주 파일을 업로드하세요.");
      return;
    }
    setLoading(true);
    setMessage("처리 중...");

    // 1. Transport costs
    const costMap = await fetchTransportCosts();
    setTransportCosts(costMap);

    // 2. Barcodes 추출
    const normalizeStr = (val) => (val ? String(val).trim() : "");
    const barcodes = [
      ...new Set(
        data
          .map((row) => {
            const code =
              row["바코드"] || row["Barcode"] || row["barcode"] ||
              row["code"] || row["SKU Barcode"] || row["sku barcode"];
            return normalizeStr(code);
          })
          .filter(Boolean)
      ),
    ];

    // 3. CBM fetch
    const cbmMap = await fetchCbmData(barcodes);
    let matchedCount = 0;

    try {
      // 4. Grouping (원본 로직)
      const groups = {};

      data.forEach((row) => {
        const rawDate = getVal(row, ["입고예정일", "Entry Date", "date", "입고일"]);
        const displayDate = excelDateToYYMMDD(rawDate);
        const center =
          getVal(row, ["물류센터", "Logistics Center", "목적지", "Destination", "창고"]) || "Unknown";
        const orderNo =
          getVal(row, ["발주번호", "Order No", "No", "PO No", "Order Number"]) || "Unknown";

        const key = `${displayDate}_${center}`;

        if (!groups[key]) {
          groups[key] = {
            date: displayDate,
            center,
            qty: 0,
            amount: 0,
            totalCbm: 0,
            orders: {},
          };
        }

        if (!groups[key].orders[orderNo]) {
          groups[key].orders[orderNo] = 0;
        }

        const qty = parseNum(
          getVal(row, ["발주수량", "Order Qty", "수량", "Qty", "qty"])
        );
        let amount = parseNum(
          getVal(row, [
            "총발주매입금", "총발주 매입금", "총발주금액", "총 발주 금액",
            "합계금액", "합계", "Total Amount", "Amount", "발주금액",
          ])
        );
        if (amount === 0) {
          const price = parseNum(
            getVal(row, ["발주단가", "발주 단가", "매입단가", "Price", "Cost", "단가"])
          );
          if (price > 0) amount = qty * price;
        }

        const codeRaw = getVal(row, [
          "바코드", "Barcode", "barcode", "code", "SKU Barcode", "sku barcode",
        ]);
        const barcode = normalizeStr(codeRaw);
        const itemCbm = cbmMap[barcode];

        let rowCbm = 0;
        if (itemCbm !== undefined) {
          matchedCount++;
          rowCbm = qty * itemCbm;
        }

        groups[key].totalCbm += rowCbm;
        groups[key].orders[orderNo] += rowCbm;
        groups[key].qty += qty;
        groups[key].amount += amount;
      });

      // 5. Result array
      const resultArray = Object.values(groups)
        .map((g) => {
          const orderList = Object.entries(g.orders)
            .map(([no, cbm]) => ({ no, cbm }))
            .sort((a, b) => b.cbm - a.cbm);
          return { ...g, orderList, orderCount: orderList.length };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      setSummary(resultArray);
      setMessage(`완료! (CBM 매칭: ${matchedCount}건)`);
    } catch (err) {
      console.error(err);
      setMessage("오류: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const dashboard = useMemo(() => {
    return summary.reduce(
      (acc, g) => {
        acc.groupCount += 1;
        acc.totalQty += g.qty;
        acc.totalAmount += g.amount;
        acc.totalCbm += g.totalCbm;

        const rawP = paletteCbm > 0 ? g.totalCbm / paletteCbm : 0;
        const pCount = rawP >= 0.5 ? Math.ceil(rawP) : 0;
        acc.totalPallets += pCount;

        const centerKey = g.center.replace(/\s+/g, "");
        acc.totalPaletteCost += pCount * (transportCosts[centerKey] || 0);

        return acc;
      },
      { groupCount: 0, totalQty: 0, totalAmount: 0, totalCbm: 0, totalPallets: 0, totalPaletteCost: 0 }
    );
  }, [summary, transportCosts]);

  const handleExport = () => {
    if (summary.length === 0) return;
    const rows = summary.map((g) => {
      const rawP = paletteCbm > 0 ? g.totalCbm / paletteCbm : 0;
      const pCount = rawP >= 0.5 ? Math.ceil(rawP) : 0;
      const centerKey = g.center.replace(/\s+/g, "");
      return {
        입고예정일: g.date,
        물류센터: g.center,
        주문건수: g.orderCount,
        총수량: g.qty,
        총금액: Math.round(g.amount),
        총CBM: Number(g.totalCbm.toFixed(3)),
        예상팔레트: pCount,
        팔레트비용: pCount * (transportCosts[centerKey] || 0),
      };
    });
    const ws = utils.json_to_sheet(rows);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "order_summary");
    writeFile(wb, "order-summary.xlsx");
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="workspace-stack">
      <div className="action-row">
        <label className="file-button">
          <FileUp size={16} />
          발주 파일 업로드
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} />
        </label>
        <button className="secondary-button" onClick={handleProcess} disabled={loading}>
          <RefreshCcw size={16} />
          {loading ? "정리 중..." : "지표 생성"}
        </button>
        <button className="secondary-button" onClick={handleExport}>
          <Download size={16} />
          요약 내보내기
        </button>
      </div>
      {message && <p className="workspace-message">{message}</p>}

      <section className="stats-grid">
        <article className="glass-card stat-card">
          <span>그룹 수</span>
          <strong>{dashboard.groupCount}</strong>
        </article>
        <article className="glass-card stat-card">
          <span>총 수량</span>
          <strong>{dashboard.totalQty.toLocaleString()}</strong>
        </article>
        <article className="glass-card stat-card">
          <span>총 금액</span>
          <strong>₩{dashboard.totalAmount.toLocaleString()}</strong>
        </article>
        <article className="glass-card stat-card">
          <span>총 CBM</span>
          <strong>{dashboard.totalCbm.toFixed(1)}</strong>
        </article>
        <article className="glass-card stat-card">
          <span>예상 팔레트</span>
          <strong>{dashboard.totalPallets}</strong>
        </article>
        <article className="glass-card stat-card">
          <span>팔레트 비용</span>
          <strong>₩{dashboard.totalPaletteCost.toLocaleString()}</strong>
        </article>
      </section>

      <section className="glass-card table-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>입고예정일</th>
                <th>물류센터</th>
                <th>팔레트 비용</th>
                <th>주문건수</th>
                <th>총수량</th>
                <th>총금액</th>
                <th>총CBM</th>
                <th>팔레트 수</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 ? (
                <tr>
                  <td colSpan="8" className="empty-state">
                    업로드 후 지표 생성을 실행하면 이곳에 결과가 표시됩니다.
                  </td>
                </tr>
              ) : (
                summary.map((g) => {
                  const rawP = paletteCbm > 0 ? g.totalCbm / paletteCbm : 0;
                  const pCount = rawP >= 0.5 ? Math.ceil(rawP) : 0;
                  const centerKey = g.center.replace(/\s+/g, "");
                  const cost = pCount * (transportCosts[centerKey] || 0);
                  return (
                    <tr key={`${g.date}-${g.center}`}>
                      <td>{g.date}</td>
                      <td>{g.center}</td>
                      <td>{cost ? `₩${cost.toLocaleString()}` : "-"}</td>
                      <td>{g.orderCount}</td>
                      <td>{g.qty.toLocaleString()}</td>
                      <td>₩{Math.round(g.amount).toLocaleString()}</td>
                      <td>{g.totalCbm.toFixed(1)}</td>
                      <td>{pCount || ""}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
