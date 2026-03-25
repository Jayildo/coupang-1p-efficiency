import { useMemo, useState } from "react";
import { Download, FileUp, RefreshCcw } from "lucide-react";
import { utils, writeFile } from "xlsx";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  findValue,
  parseDateLabel,
  parseNumber,
  readSpreadsheet,
  unique
} from "../utils/data";

const aliases = {
  barcode: ["바코드", "barcode", "skubarcode", "code"],
  qty: ["발주수량", "수량", "qty", "orderqty", "confirmedqty"],
  amount: ["총발주금액", "합계금액", "amount", "totalamount"],
  price: ["발주단가", "매입가", "price", "cost"],
  center: ["물류센터", "센터", "logisticscenter", "destination", "center"],
  date: ["입고예정일", "date", "duedate", "entrydate"],
  orderNo: ["발주번호", "orderno", "pono", "ordernumber"]
};

async function fetchCbmMap(barcodes) {
  if (!isSupabaseConfigured || barcodes.length === 0) {
    return {};
  }

  const result = {};
  const chunkSize = 100;

  for (let index = 0; index < barcodes.length; index += chunkSize) {
    const batch = barcodes.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("skulist")
      .select("*")
      .in("바코드", batch);

    if (error) {
      console.warn("skulist 조회 실패 (테이블 미존재 가능):", error.message);
      return result;
    }

    (data || []).forEach((row) => {
      const barcode = row["바코드"] || row.barcode;
      const cbm = row.cbm || row.CBM || row.Cbm || 0;
      if (barcode) {
        result[String(barcode).trim()] = Number(cbm) || 0;
      }
    });
  }

  return result;
}

async function fetchTransportCosts() {
  if (!isSupabaseConfigured) {
    return {};
  }
  const { data, error } = await supabase
    .from("milk_run_costs")
    .select("center_clean, cost_per_pallet");

  if (error) {
    console.warn("milk_run_costs 조회 실패 (테이블 미존재 가능):", error.message);
    return {};
  }

  const result = {};
  (data || []).forEach((row) => {
    const key = String(row.center_clean || "").replace(/\s+/g, "");
    if (key) {
      result[key] = Number(row.cost_per_pallet) || 0;
    }
  });
  return result;
}

export default function OrderWorkbench() {
  const [rows, setRows] = useState([]);
  const [groups, setGroups] = useState([]);
  const [transportCosts, setTransportCosts] = useState({});
  const [message, setMessage] = useState("샘플 또는 발주 파일을 업로드하세요.");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextRows = await readSpreadsheet(file);
    setRows(nextRows);
    setGroups([]);
    setMessage(`${nextRows.length.toLocaleString()}행을 불러왔습니다.`);
  };

  const handleProcess = async () => {
    if (rows.length === 0) {
      setMessage("먼저 발주 파일을 업로드하세요.");
      return;
    }

    setIsProcessing(true);
    setMessage("발주 데이터를 정리하는 중입니다.");

    try {
      const barcodes = unique(
        rows.map((row) => String(findValue(row, aliases.barcode) || "").trim())
      );
      const [cbmMap, costMap] = await Promise.all([
        fetchCbmMap(barcodes),
        fetchTransportCosts()
      ]);

      const grouped = new Map();

      rows.forEach((row) => {
        const date = parseDateLabel(findValue(row, aliases.date));
        const center = String(findValue(row, aliases.center) || "미지정 센터").trim();
        const orderNo = String(findValue(row, aliases.orderNo) || "미지정 발주").trim();
        const barcode = String(findValue(row, aliases.barcode) || "").trim();
        const qty = parseNumber(findValue(row, aliases.qty));
        const amount =
          parseNumber(findValue(row, aliases.amount)) ||
          qty * parseNumber(findValue(row, aliases.price));
        const cbm = (cbmMap[barcode] || 0) * qty;
        const key = `${date}__${center}`;

        if (!grouped.has(key)) {
          grouped.set(key, {
            date,
            center,
            orderCount: 0,
            qty: 0,
            amount: 0,
            totalCbm: 0,
            orders: new Set()
          });
        }

        const current = grouped.get(key);
        current.qty += qty;
        current.amount += amount;
        current.totalCbm += cbm;
        current.orders.add(orderNo);
        current.orderCount = current.orders.size;
      });

      const normalizedGroups = [...grouped.values()]
        .map((group) => {
          const centerKey = group.center.replace(/\s+/g, "");
          const estimatedPallets =
            group.totalCbm >= 0.5 ? Math.ceil(group.totalCbm / 1.65) : 0;
          return {
            ...group,
            estimatedPallets,
            transportCost:
              estimatedPallets > 0 ? (costMap[centerKey] || 0) * estimatedPallets : 0
          };
        })
        .sort((left, right) => left.date.localeCompare(right.date));

      setTransportCosts(costMap);
      setGroups(normalizedGroups);
      setMessage(
        `${normalizedGroups.length.toLocaleString()}개 그룹으로 정리했습니다.`
      );
    } catch (error) {
      setMessage(`정리 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const dashboard = useMemo(() => {
    return groups.reduce(
      (acc, group) => {
        acc.groupCount += 1;
        acc.totalQty += group.qty;
        acc.totalAmount += group.amount;
        acc.totalCbm += group.totalCbm;
        acc.totalPallets += group.estimatedPallets;
        return acc;
      },
      { groupCount: 0, totalQty: 0, totalAmount: 0, totalCbm: 0, totalPallets: 0 }
    );
  }, [groups]);

  const handleExport = () => {
    if (groups.length === 0) return;
    const worksheet = utils.json_to_sheet(
      groups.map((group) => ({
        입고예정일: group.date,
        물류센터: group.center,
        주문건수: group.orderCount,
        총수량: group.qty,
        총금액: group.amount,
        총CBM: Number(group.totalCbm.toFixed(3)),
        예상팔레트: group.estimatedPallets,
        추정운송비: group.transportCost
      }))
    );
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "order_summary");
    writeFile(workbook, "order-summary.xlsx");
  };

  return (
    <div className="workspace-stack">
      <div className="action-row">
          <label className="file-button">
            <FileUp size={16} />
            발주 파일 업로드
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} />
          </label>
          <button className="secondary-button" onClick={handleProcess}>
            <RefreshCcw size={16} />
            {isProcessing ? "정리 중..." : "지표 생성"}
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
          <p>날짜 + 센터 기준</p>
        </article>
        <article className="glass-card stat-card">
          <span>총 수량</span>
          <strong>{dashboard.totalQty.toLocaleString()}</strong>
          <p>발주 합계 수량</p>
        </article>
        <article className="glass-card stat-card">
          <span>총 금액</span>
          <strong>₩{dashboard.totalAmount.toLocaleString()}</strong>
          <p>합산 발주 금액</p>
        </article>
        <article className="glass-card stat-card">
          <span>예상 팔레트</span>
          <strong>{dashboard.totalPallets}</strong>
          <p>CBM 1.65 기준 추정</p>
        </article>
      </section>

      <section className="glass-card table-card">
        <div className="table-header-line">
          <div>
            <div className="section-label">Center Summary</div>
            <h2>센터별 발주 정리 결과</h2>
          </div>
          <div className="table-chip">
            등록된 운송비 센터 {Object.keys(transportCosts).length}개
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>입고예정일</th>
                <th>물류센터</th>
                <th>주문건수</th>
                <th>총수량</th>
                <th>총금액</th>
                <th>총CBM</th>
                <th>예상팔레트</th>
                <th>추정운송비</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan="8" className="empty-state">
                    업로드 후 지표 생성을 실행하면 이곳에 결과가 표시됩니다.
                  </td>
                </tr>
              ) : (
                groups.map((group) => (
                  <tr key={`${group.date}-${group.center}`}>
                    <td>{group.date}</td>
                    <td>{group.center}</td>
                    <td>{group.orderCount}</td>
                    <td>{group.qty.toLocaleString()}</td>
                    <td>₩{Math.round(group.amount).toLocaleString()}</td>
                    <td>{group.totalCbm.toFixed(2)}</td>
                    <td>{group.estimatedPallets}</td>
                    <td>
                      {group.transportCost
                        ? `₩${group.transportCost.toLocaleString()}`
                        : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
