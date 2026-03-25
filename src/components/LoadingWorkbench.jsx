import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileUp, Printer, Scissors, Undo2 } from "lucide-react";
import { utils, writeFile } from "xlsx";
import {
  findValue,
  parseDateLabel,
  parseNumber,
  readSpreadsheet,
  unique
} from "../utils/data";

// ── Constants ──────────────────────────────────────────────────────────────
const SUB_TABS = [
  { id: "upload", label: "업로드" },
  { id: "pallet", label: "팔레트" },
  { id: "box", label: "박스" }
];

const PALLET_ROWS_BASE = 15;
const BOX_ROWS_PER_PAGE = 25;

const aliases = {
  sku: ["skuid", "sku", "skuno", "상품번호", "sku id"],
  barcode: ["바코드", "barcode", "skubarcode", "상품바코드"],
  name: ["상품이름", "상품명", "productname", "name", "품명", "skuname", "sku이름", "skuname"],
  center: ["물류센터", "센터", "center", "logisticscenter"],
  qty: ["발주수량", "수량", "qty", "confirmedqty", "확정수량", "quantity"],
  date: ["입고예정일", "날짜", "date", "expecteddate", "duedate", "expected_date"],
  orderNo: ["발주번호", "주문번호", "orderno", "pono", "po", "po no", "po_no", "order no"],
  expiry: ["유통기한", "expirydate", "expiry", "유통(소비)기한", "expiry_date"]
};

const PRINT_CSS = `
  @page { size: A4 landscape; margin: 5mm; }
  body { margin: 0; font-family: sans-serif; }
  .print-page { page-break-after: always; padding: 5mm 8mm; }
  .print-page:last-child { page-break-after: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #000; padding: 4px 5px; text-align: center; }
  th { background: #f3f4f6; font-weight: bold; }
  td { height: 26px; }
  td.left { text-align: left; }
  .header-info { font-size: 22px; line-height: 1.8; margin-bottom: 6px; }
  .title { text-align: center; font-weight: bold; font-size: 30px; text-decoration: underline; margin-bottom: 10px; }
`;

// ── Helpers ────────────────────────────────────────────────────────────────
function numSort(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

function calcPalletRows(poStr) {
  if (!poStr) return PALLET_ROWS_BASE;
  const lines = Math.ceil(poStr.length / 50);
  if (lines <= 1) return PALLET_ROWS_BASE;
  return Math.max(10, PALLET_ROWS_BASE - (lines - 1) * 2);
}

function computeBoxGroups(pageItems) {
  const groups = {};
  let gi = 0;
  while (gi < pageItems.length) {
    const cur = pageItems[gi];
    const groupKey = `${cur.sku}||${cur.barcode}||${cur.name}||${cur.poNos ? [...cur.poNos].join(",") : cur.orderNo}`;
    let ge = gi + 1;
    while (ge < pageItems.length) {
      const next = pageItems[ge];
      const nextKey = `${next.sku}||${next.barcode}||${next.name}||${next.poNos ? [...next.poNos].join(",") : next.orderNo}`;
      if (nextKey === groupKey) ge++;
      else break;
    }
    const span = ge - gi;
    const uniqueBoxes = new Set(
      pageItems.slice(gi, ge).map((it) => it.box).filter(Boolean)
    ).size;
    for (let k = gi; k < ge; k++) {
      groups[k] = { show: k === gi, rowSpan: span, boxCount: uniqueBoxes };
    }
    gi = ge;
  }
  return groups;
}

function openPrintWindow(html) {
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function LoadingWorkbench() {
  const [subTab, setSubTab] = useState("upload");
  const [aggregated, setAggregated] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [splits, setSplits] = useState({});
  const [splitPromptIdx, setSplitPromptIdx] = useState(null);
  const splitPerBoxRef = useRef("");

  const [selectedCenter, setSelectedCenter] = useState("");
  const [selectedPallet, setSelectedPallet] = useState("");
  const [selectedBox, setSelectedBox] = useState("");
  const [uploadCenterFilter, setUploadCenterFilter] = useState("");
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const [message, setMessage] = useState("");

  // ── Upload & Aggregate ─────────────────────────────────────────────────
  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const sourceRows = await readSpreadsheet(file);
    const map = new Map();

    sourceRows.forEach((row) => {
      const sku = String(findValue(row, aliases.sku) || "").trim();
      const barcode = String(findValue(row, aliases.barcode) || "").trim();
      const name = String(findValue(row, aliases.name) || "").trim();
      const center = String(findValue(row, aliases.center) || "미지정 센터").trim();
      const qty = parseNumber(findValue(row, aliases.qty));
      const date = parseDateLabel(findValue(row, aliases.date));
      const expiry = String(findValue(row, aliases.expiry) || "").trim();
      const orderNo = String(findValue(row, aliases.orderNo) || "").trim();

      if (!sku && !barcode && !name) return;

      const key = `${sku}||${barcode}||${name}||${center}`;
      if (map.has(key)) {
        const ex = map.get(key);
        ex.qty += qty;
        if (!ex.date && date) ex.date = date;
        if (!ex.expiry && expiry) ex.expiry = expiry;
        if (orderNo) ex.poNos.add(orderNo);
      } else {
        map.set(key, {
          sku,
          barcode,
          name,
          center,
          qty,
          date,
          expiry,
          poNos: new Set(orderNo ? [orderNo] : [])
        });
      }
    });

    const result = Array.from(map.values()).sort((a, b) => {
      const bc = a.barcode.localeCompare(b.barcode);
      return bc !== 0 ? bc : b.qty - a.qty;
    });

    setAggregated(result);
    setAssignments({});
    setSplits({});
    setSplitPromptIdx(null);
    splitPerBoxRef.current = "";
    setSelectedCenter("");
    setSelectedPallet("");
    setSelectedBox("");
    setUploadCenterFilter("");
    setBarcodeSearch("");
    setVisibleCount(50);
    setMessage(`${result.length}개 품목을 집계했습니다.`);
  };

  // ── Assignment helpers ─────────────────────────────────────────────────
  const getA = (key) => assignments[key] || { box: "", pallet: "" };

  const setA = useCallback((key, field, value) => {
    setAssignments((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { box: "", pallet: "" }), [field]: value }
    }));
  }, []);

  const getCenterForKey = useCallback(
    (key) => {
      const aggIdx = parseInt(key.split("-")[0], 10);
      return aggregated[aggIdx]?.center || "";
    },
    [aggregated]
  );

  const onBoxBlur = useCallback(
    (key) => {
      setAssignments((prev) => {
        const boxVal = prev[key]?.box;
        if (!boxVal) return prev;
        const myCenter = getCenterForKey(key);

        const crossEntry = Object.entries(prev).find(
          ([k, a]) => k !== key && a.box === boxVal && getCenterForKey(k) !== myCenter
        );
        if (crossEntry) {
          alert(
            `타 센터에서 입력한 박스번호입니다. (박스 ${boxVal} → ${getCenterForKey(crossEntry[0])} 센터)`
          );
          return { ...prev, [key]: { ...prev[key], box: "" } };
        }

        const existingPallet = Object.values(prev).find(
          (a) => a.box === boxVal && a.pallet
        )?.pallet;
        if (existingPallet && prev[key]?.pallet !== existingPallet) {
          return { ...prev, [key]: { ...prev[key], pallet: existingPallet } };
        }
        return prev;
      });
    },
    [getCenterForKey]
  );

  const onPalletBlur = useCallback((key) => {
    setAssignments((prev) => {
      const thisBox = prev[key]?.box;
      const thisPallet = prev[key]?.pallet;
      if (!thisBox || !thisPallet) return prev;

      const conflict = Object.entries(prev).find(
        ([k, a]) => k !== key && a.box === thisBox && a.pallet && a.pallet !== thisPallet
      );
      if (conflict) {
        alert(
          `박스 ${thisBox}은(는) 이미 팔레트 ${conflict[1].pallet}에 배정되어 있습니다.`
        );
        return { ...prev, [key]: { ...prev[key], pallet: "" } };
      }

      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (next[k].box === thisBox) {
          next[k] = { ...next[k], pallet: thisPallet };
        }
      });
      return next;
    });
  }, []);

  // ── Split handlers ─────────────────────────────────────────────────────
  const doSplit = (aggIndex, perBox) => {
    const total = aggregated[aggIndex].qty;
    const pb = Math.max(1, Math.floor(perBox));
    const count = Math.ceil(total / pb);
    const newSplits = [];
    for (let s = 0; s < count; s++) {
      const q = s < count - 1 ? pb : total - pb * (count - 1);
      newSplits.push({ qty: q, key: `${aggIndex}-${s}` });
    }
    setSplits((prev) => ({ ...prev, [aggIndex]: newSplits }));
    setSplitPromptIdx(null);
    splitPerBoxRef.current = "";
  };

  const undoSplit = (aggIndex) => {
    setSplits((prev) => {
      const next = { ...prev };
      delete next[aggIndex];
      return next;
    });
    setAssignments((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k.startsWith(`${aggIndex}-`)) delete next[k];
      });
      return next;
    });
  };

  const updateSplitQty = (aggIndex, splitIndex, newQty) => {
    setSplits((prev) => {
      const arr = [...(prev[aggIndex] || [])];
      arr[splitIndex] = { ...arr[splitIndex], qty: Number(newQty) || 0 };
      return { ...prev, [aggIndex]: arr };
    });
  };

  // ── Tab key navigation ─────────────────────────────────────────────────
  const handleTabNav = (e, colClass) => {
    if (e.key !== "Tab") return;
    const allInputs = [...document.querySelectorAll(`input.${colClass}`)];
    const cur = allInputs.indexOf(e.target);
    if (cur < 0) return;
    const next = e.shiftKey ? cur - 1 : cur + 1;
    if (next >= 0 && next < allInputs.length) {
      e.preventDefault();
      allInputs[next].focus();
    }
  };

  // ── Display rows (pallet/box views) ────────────────────────────────────
  const displayRows = useMemo(() => {
    const result = [];
    aggregated.forEach((r, i) => {
      if (splits[i]) {
        splits[i].forEach((s) => {
          result.push({
            ...r,
            qty: s.qty,
            box: getA(s.key).box,
            pallet: getA(s.key).pallet
          });
        });
      } else {
        result.push({ ...r, box: getA(String(i)).box, pallet: getA(String(i)).pallet });
      }
    });
    return result;
  }, [aggregated, splits, assignments]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived lists ──────────────────────────────────────────────────────
  const uploadCenterList = useMemo(
    () => unique(aggregated.map((r) => r.center)).sort(),
    [aggregated]
  );

  const filteredAggregated = useMemo(() => {
    return aggregated
      .map((row, idx) => ({ ...row, _aggIndex: idx }))
      .filter((row) => {
        if (uploadCenterFilter && row.center !== uploadCenterFilter) return false;
        if (
          barcodeSearch &&
          !row.barcode.includes(barcodeSearch) &&
          !row.sku.includes(barcodeSearch)
        )
          return false;
        return true;
      });
  }, [aggregated, uploadCenterFilter, barcodeSearch]);

  const centerList = useMemo(
    () => unique(displayRows.map((r) => r.center)).sort(),
    [displayRows]
  );

  const centerStats = useMemo(() => {
    const stats = {};
    centerList.forEach((c) => {
      const cr = displayRows.filter((r) => r.center === c);
      stats[c] = {
        pallets: new Set(cr.filter((r) => r.pallet).map((r) => r.pallet)).size,
        boxes: new Set(cr.filter((r) => r.box).map((r) => r.box)).size
      };
    });
    return stats;
  }, [centerList, displayRows]);

  const palletListForCenter = useMemo(
    () =>
      unique(
        displayRows.filter((r) => r.center === selectedCenter && r.pallet).map((r) => r.pallet)
      ).sort(numSort),
    [displayRows, selectedCenter]
  );

  const boxListForCenter = useMemo(() => {
    const items = displayRows.filter((r) => r.center === selectedCenter && r.box);
    const countMap = new Map();
    items.forEach((r) => countMap.set(r.box, (countMap.get(r.box) || 0) + 1));
    return Array.from(countMap.entries())
      .filter(([, cnt]) => cnt >= 1)
      .map(([b]) => b)
      .sort(numSort);
  }, [displayRows, selectedCenter]);

  const filteredPalletItems = useMemo(
    () =>
      !selectedCenter || !selectedPallet
        ? []
        : displayRows.filter(
            (r) => r.center === selectedCenter && r.pallet === selectedPallet
          ),
    [displayRows, selectedCenter, selectedPallet]
  );

  const filteredBoxItems = useMemo(
    () =>
      !selectedCenter || !selectedBox
        ? []
        : displayRows.filter((r) => r.center === selectedCenter && r.box === selectedBox),
    [displayRows, selectedCenter, selectedBox]
  );

  const palletPoStr = useMemo(
    () =>
      unique(filteredPalletItems.flatMap((i) => (i.poNos ? [...i.poNos] : []))).join(", "),
    [filteredPalletItems]
  );

  const palletRowsPerPage = useMemo(() => calcPalletRows(palletPoStr), [palletPoStr]);

  const palletPages = useMemo(() => {
    const pages = [];
    for (let i = 0; i < filteredPalletItems.length; i += palletRowsPerPage) {
      pages.push(filteredPalletItems.slice(i, i + palletRowsPerPage));
    }
    return pages.length ? pages : [[]];
  }, [filteredPalletItems, palletRowsPerPage]);

  const boxPages = useMemo(() => {
    const pages = [];
    for (let i = 0; i < filteredBoxItems.length; i += BOX_ROWS_PER_PAGE) {
      pages.push(filteredBoxItems.slice(i, i + BOX_ROWS_PER_PAGE));
    }
    return pages.length ? pages : [[]];
  }, [filteredBoxItems]);

  // ── XLSX export ────────────────────────────────────────────────────────
  const downloadPalletXlsx = () => {
    if (!filteredPalletItems.length) return;
    const wb = utils.book_new();
    const totalP = palletListForCenter.length;
    const ub = new Set(filteredPalletItems.map((i) => i.box).filter(Boolean)).size;
    const po = unique(filteredPalletItems.flatMap((i) => (i.poNos ? [...i.poNos] : []))).join(", ");

    palletPages.forEach((pg, pi) => {
      const sd = [
        ["쿠팡 팔레트 적재리스트"],
        [],
        [
          "총 팔레트 수", totalP, "", "해당 팔레트 번호", selectedPallet, "",
          "박스수량", `${ub} BOX`
        ],
        [
          "입고예정일자", pg[0]?.date || "", "", "납품센터명", selectedCenter, "",
          "업체명", "아노마드"
        ],
        ["입고요청서번호", po],
        [],
        ["NO", "거래명세서의 상품번호", "물류 입고용 상품명 + 옵션명", "총 박스 수량", "BOX 번호", "수량", "유통기한/제조일자"]
      ];
      const bg = computeBoxGroups(pg);
      pg.forEach((it, idx) =>
        sd.push([
          pi * palletRowsPerPage + idx + 1,
          it.sku,
          it.name,
          bg[idx]?.show ? bg[idx].boxCount : "",
          it.box || "",
          it.qty,
          it.expiry || ""
        ])
      );
      const ws = utils.aoa_to_sheet(sd);
      ws["!cols"] = [
        { wch: 5 }, { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 18 }
      ];
      utils.book_append_sheet(
        wb,
        ws,
        `팔레트${selectedPallet}${palletPages.length > 1 ? "_p" + (pi + 1) : ""}`.slice(0, 31)
      );
    });
    writeFile(wb, `팔레트_적재리스트_${selectedPallet}.xlsx`);
  };

  const downloadAllPalletXlsx = () => {
    if (!selectedCenter || !palletListForCenter.length) return;
    const tp = palletListForCenter.length;
    const wb = utils.book_new();
    palletListForCenter.forEach((pNo) => {
      const items = displayRows.filter((r) => r.center === selectedCenter && r.pallet === pNo);
      const ub = new Set(items.map((i) => i.box).filter(Boolean)).size;
      const po = unique(items.flatMap((i) => (i.poNos ? [...i.poNos] : []))).join(", ");
      const sd = [
        ["쿠팡 팔레트 적재리스트"],
        [],
        [
          "총 팔레트 수", tp, "", "해당 팔레트 번호", pNo, "",
          "박스수량", `${ub} BOX`
        ],
        [
          "입고예정일자", items[0]?.date || "", "", "납품센터명", selectedCenter, "",
          "업체명", "아노마드"
        ],
        ["입고요청서번호", po],
        [],
        ["NO", "거래명세서의 상품번호", "물류 입고용 상품명 + 옵션명", "총 박스 수량", "BOX 번호", "수량", "유통기한/제조일자"]
      ];
      const bg = computeBoxGroups(items);
      items.forEach((it, idx) =>
        sd.push([
          idx + 1,
          it.sku,
          it.name,
          bg[idx]?.show ? bg[idx].boxCount : "",
          it.box || "",
          it.qty,
          it.expiry || ""
        ])
      );
      const ws = utils.aoa_to_sheet(sd);
      ws["!cols"] = [
        { wch: 5 }, { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 18 }
      ];
      utils.book_append_sheet(wb, ws, `팔레트${pNo}`.slice(0, 31));
    });
    writeFile(wb, `팔레트_적재리스트_${selectedCenter}_전체.xlsx`);
  };

  const downloadBoxXlsx = () => {
    if (!filteredBoxItems.length) return;
    const wb = utils.book_new();
    boxPages.forEach((pg, pi) => {
      const sd = [
        ["쿠팡 박스 적재리스트"],
        [],
        ["박스번호", selectedBox],
        ["입고일+센터명", `${pg[0]?.date || ""} ${selectedCenter}`.trim()],
        ["입고예정일", pg[0]?.date || ""],
        ["업체명", "아노마드"],
        [],
        ["번호", "SKU No", "SKU NAME", "바코드", "수량"]
      ];
      pg.forEach((it, idx) =>
        sd.push([pi * BOX_ROWS_PER_PAGE + idx + 1, it.sku, it.name, it.barcode, it.qty])
      );
      const ws = utils.aoa_to_sheet(sd);
      ws["!cols"] = [{ wch: 5 }, { wch: 18 }, { wch: 40 }, { wch: 18 }, { wch: 8 }];
      utils.book_append_sheet(
        wb,
        ws,
        `박스${selectedBox}${boxPages.length > 1 ? "_p" + (pi + 1) : ""}`.slice(0, 31)
      );
    });
    writeFile(wb, `박스_적재리스트_${selectedBox}.xlsx`);
  };

  const downloadAllBoxXlsx = () => {
    if (!selectedCenter || !boxListForCenter.length) return;
    const wb = utils.book_new();
    boxListForCenter.forEach((bNo) => {
      const items = displayRows.filter((r) => r.center === selectedCenter && r.box === bNo);
      const sd = [
        ["쿠팡 박스 적재리스트"],
        [],
        ["박스번호", bNo],
        ["입고일+센터명", `${items[0]?.date || ""} ${selectedCenter}`.trim()],
        ["입고예정일", items[0]?.date || ""],
        ["업체명", "아노마드"],
        [],
        ["번호", "SKU No", "SKU NAME", "바코드", "수량"]
      ];
      items.forEach((it, idx) =>
        sd.push([idx + 1, it.sku, it.name, it.barcode, it.qty])
      );
      const ws = utils.aoa_to_sheet(sd);
      ws["!cols"] = [{ wch: 5 }, { wch: 18 }, { wch: 40 }, { wch: 18 }, { wch: 8 }];
      utils.book_append_sheet(wb, ws, `박스${bNo}`.slice(0, 31));
    });
    writeFile(wb, `박스_적재리스트_${selectedCenter}_전체.xlsx`);
  };

  // ── Print helpers ──────────────────────────────────────────────────────
  const handlePrint = (printAreaId) => {
    const area = document.getElementById(printAreaId);
    if (!area) return;
    openPrintWindow(
      `<!DOCTYPE html><html><head><title>인쇄</title><style>${PRINT_CSS}</style></head><body>${area.innerHTML}</body></html>`
    );
  };

  const handlePrintAllPallets = () => {
    if (!selectedCenter || !palletListForCenter.length) return;
    const tp = palletListForCenter.length;
    let body = "";
    palletListForCenter.forEach((pNo) => {
      const items = displayRows.filter((r) => r.center === selectedCenter && r.pallet === pNo);
      const ub = new Set(items.map((i) => i.box).filter(Boolean)).size;
      const po = unique(items.flatMap((i) => (i.poNos ? [...i.poNos] : []))).join(", ");
      const rpp = calcPalletRows(po);
      const pageCount = Math.max(1, Math.ceil(items.length / rpp));
      for (let p = 0; p < pageCount; p++) {
        const pg = items.slice(p * rpp, (p + 1) * rpp);
        const bg = computeBoxGroups(pg);
        let rows = "";
        pg.forEach((it, idx) => {
          const boxCell = bg[idx]?.show
            ? `<td rowspan="${bg[idx].rowSpan}" style="vertical-align:middle;font-weight:600">${bg[idx].boxCount}</td>`
            : "";
          rows += `<tr><td>${p * rpp + idx + 1}</td><td>${it.sku}</td><td class="left">${it.name}</td>${boxCell}<td>${it.box || ""}</td><td>${it.qty.toLocaleString()}</td><td>${it.expiry || ""}</td></tr>`;
        });
        for (let e = pg.length; e < rpp; e++) {
          rows += `<tr><td>${p * rpp + e + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
        }
        body += `<div class="print-page">
          <div class="title">쿠팡 팔레트 적재리스트</div>
          <div class="header-info">
            <div style="display:flex;justify-content:space-between"><span>총 팔레트 수 <b>${tp}</b> - 해당 팔레트 번호 <b>${pNo}</b></span><span>박스수량. [ <b>${ub}</b> BOX]</span></div>
            <div style="display:flex">
              <span style="flex:1"><b>입고예정일자.</b> [ ${items[0]?.date || ""} ]</span>
              <span style="flex:1"><b>납품센터명.</b> [ ${selectedCenter} 센터]</span>
              <span style="flex:1"><b>업체명.</b> [ <b>아노마드</b> ]</span>
            </div>
            <div><b>입고요청서번호.</b> [ <span style="font-size:14px">${po || "____"}</span> ]</div>
          </div>
          <table><thead><tr>
            <th>NO</th><th>거래명세서의 상품번호</th><th>물류 입고용 상품명 + 옵션명</th><th>총 박스<br>수량</th><th>BOX 번호</th><th>수량</th><th>유통기한/제조일자</th>
          </tr></thead><tbody>${rows}</tbody></table>
        </div>`;
      }
    });
    openPrintWindow(
      `<!DOCTYPE html><html><head><title>전체 팔레트 인쇄</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`
    );
  };

  const handlePrintAllBoxes = () => {
    if (!selectedCenter || !boxListForCenter.length) return;
    let body = "";
    boxListForCenter.forEach((bNo) => {
      const items = displayRows.filter((r) => r.center === selectedCenter && r.box === bNo);
      const pageCount = Math.max(1, Math.ceil(items.length / BOX_ROWS_PER_PAGE));
      for (let p = 0; p < pageCount; p++) {
        const pg = items.slice(p * BOX_ROWS_PER_PAGE, (p + 1) * BOX_ROWS_PER_PAGE);
        let rows = "";
        pg.forEach(
          (it, idx) =>
            (rows += `<tr><td>${p * BOX_ROWS_PER_PAGE + idx + 1}</td><td>${it.sku}</td><td class="left">${it.name}</td><td>${it.barcode}</td><td>${it.qty.toLocaleString()}</td></tr>`)
        );
        body += `<div class="print-page">
          <div class="title">쿠팡 박스 적재리스트</div>
          <div class="header-info">
            <div><b>박스번호.</b> [ <b>${bNo}</b> ]</div>
            <div style="display:flex">
              <span style="flex:1"><b>입고예정일자.</b> [ ${items[0]?.date || ""} ]</span>
              <span style="flex:1"><b>납품센터명.</b> [ ${selectedCenter} 센터]</span>
              <span style="flex:1"><b>업체명.</b> [ <b>아노마드</b> ]</span>
            </div>
          </div>
          <table><thead><tr><th>번호</th><th>SKU No</th><th>SKU NAME</th><th>바코드</th><th>수량</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
      }
    });
    openPrintWindow(
      `<!DOCTYPE html><html><head><title>전체 박스 인쇄</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`
    );
  };

  // ── A4 preview style ───────────────────────────────────────────────────
  const a4Style = {
    width: "297mm",
    minHeight: "210mm",
    padding: "5mm 8mm",
    background: "var(--card-bg, #fff)",
    border: "1px solid var(--border, #e0e0e0)",
    marginBottom: "16px",
    boxSizing: "border-box",
    fontSize: "11px"
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="workspace-stack">
      {/* Sub-tab navigation */}
      <div style={{ display: "flex", gap: "4px", borderBottom: "2px solid var(--border, #e0e0e0)", marginBottom: "0" }}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            style={{
              padding: "8px 20px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: "14px",
              marginBottom: "-2px",
              borderBottom:
                subTab === tab.id
                  ? "2px solid var(--accent, #5D4037)"
                  : "2px solid transparent",
              color:
                subTab === tab.id
                  ? "var(--accent, #5D4037)"
                  : "var(--text-muted, #8D6E63)",
              fontWeight: subTab === tab.id ? "600" : "400"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ 업로드 탭 ═══ */}
      {subTab === "upload" && (
        <section className="glass-card">
          {/* Header / upload controls */}
          <div className="table-header-line">
            <div>
              <div className="section-label">Loading Planner</div>
              <h2>발주서를 업로드하고 박스·팔레트를 배정합니다.</h2>
            </div>
            <div className="action-row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <label className="file-button">
                <FileUp size={16} />
                발주서 업로드
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} />
              </label>
              {aggregated.length > 0 && (
                <>
                  <select
                    className="select-control"
                    value={uploadCenterFilter}
                    onChange={(e) => setUploadCenterFilter(e.target.value)}
                  >
                    <option value="">전체 센터</option>
                    {uploadCenterList.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="table-input"
                    style={{ width: "150px", padding: "6px 10px" }}
                    placeholder="바코드/SKU 검색"
                    value={barcodeSearch}
                    onChange={(e) => setBarcodeSearch(e.target.value)}
                  />
                </>
              )}
            </div>
          </div>

          {message && (
            <div style={{ padding: "8px 12px", background: "var(--accent-light, #fdf6f0)", borderRadius: "6px", fontSize: "13px", color: "var(--accent, #5D4037)", marginBottom: "8px" }}>
              {message}
            </div>
          )}

          {aggregated.length === 0 ? (
            <div className="empty-state">
              .xlsx / .xls / .csv 파일을 업로드하세요.<br />
              필수 컬럼: SKU, 바코드, 상품명, 물류센터, 발주수량
            </div>
          ) : (
            <>
              <div style={{ fontSize: "13px", color: "var(--text-muted, #888)", marginBottom: "8px" }}>
                집계 결과: {filteredAggregated.length} / {aggregated.length}개 품목
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>발주번호</th>
                      <th>SKU</th>
                      <th>바코드</th>
                      <th>상품명</th>
                      <th>센터</th>
                      <th style={{ width: "44px" }}></th>
                      <th>합계수량</th>
                      <th>박스번호</th>
                      <th>팔레트번호</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAggregated.slice(0, visibleCount).map((row) => {
                      const i = row._aggIndex;
                      const isSplit = !!splits[i];
                      const poArr = row.poNos ? [...row.poNos] : [];
                      const poStr =
                        poArr.length <= 2
                          ? poArr.join(", ")
                          : `${poArr.slice(0, 2).join(", ")} (총 ${poArr.length}개)`;

                      return (
                        <>
                          {/* Parent row */}
                          <tr key={`row-${i}`}>
                            <td style={{ textAlign: "center", fontSize: "12px" }}>{poStr || "-"}</td>
                            <td style={{ textAlign: "center" }}>{row.sku}</td>
                            <td style={{ textAlign: "center" }}>{row.barcode}</td>
                            <td style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</td>
                            <td style={{ textAlign: "center" }}>{row.center}</td>
                            <td style={{ textAlign: "center", padding: "2px" }}>
                              {!isSplit ? (
                                <button
                                  title="쪼개기"
                                  onClick={() => { splitPerBoxRef.current = ""; setSplitPromptIdx(i); }}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent, #795548)", padding: "2px 4px" }}
                                >
                                  <Scissors size={14} />
                                </button>
                              ) : (
                                <button
                                  title="합치기"
                                  onClick={() => undoSplit(i)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: "2px 4px" }}
                                >
                                  <Undo2 size={14} />
                                </button>
                              )}
                            </td>
                            <td style={{ textAlign: "center", fontWeight: "600" }}>
                              {row.qty.toLocaleString()}
                              {isSplit && (() => {
                                const splitSum = splits[i].reduce((s, x) => s + x.qty, 0);
                                if (splitSum !== row.qty)
                                  return (
                                    <div style={{ fontSize: "10px", color: "#dc2626", fontWeight: 400 }}>
                                      합계 {splitSum} ({splitSum > row.qty ? "+" : ""}{splitSum - row.qty})
                                    </div>
                                  );
                                return null;
                              })()}
                            </td>
                            <td style={{ padding: "3px 4px", textAlign: "center" }}>
                              {!isSplit && (
                                <input
                                  type="text"
                                  className="table-input col-box"
                                  maxLength={5}
                                  value={getA(String(i)).box}
                                  onChange={(e) => setA(String(i), "box", e.target.value)}
                                  onBlur={() => onBoxBlur(String(i))}
                                  onKeyDown={(e) => handleTabNav(e, "col-box")}
                                  placeholder="박스"
                                  style={{ width: "60px", textAlign: "center" }}
                                />
                              )}
                            </td>
                            <td style={{ padding: "3px 4px", textAlign: "center" }}>
                              {!isSplit && (
                                <input
                                  type="text"
                                  className="table-input col-pallet"
                                  value={getA(String(i)).pallet}
                                  onChange={(e) => setA(String(i), "pallet", e.target.value)}
                                  onBlur={() => onPalletBlur(String(i))}
                                  onKeyDown={(e) => handleTabNav(e, "col-pallet")}
                                  placeholder="팔레트"
                                  style={{ width: "60px", textAlign: "center" }}
                                />
                              )}
                            </td>
                          </tr>

                          {/* Split prompt row */}
                          {splitPromptIdx === i && (
                            <tr key={`split-prompt-${i}`} style={{ background: "var(--row-stripe, #fafafa)" }}>
                              <td colSpan={9} style={{ padding: "8px 12px" }}>
                                <span style={{ fontSize: "13px", marginRight: "8px" }}>
                                  박스당 수량 (총 {row.qty.toLocaleString()}개):
                                </span>
                                <input
                                  type="number"
                                  autoFocus
                                  defaultValue=""
                                  ref={(el) => {
                                    if (el && !el.dataset.init) {
                                      el.dataset.init = "1";
                                      el.oninput = () => {
                                        splitPerBoxRef.current = el.value;
                                        const info = el.parentElement.querySelector(".split-info");
                                        if (info)
                                          info.textContent = `→ ${el.value ? Math.ceil(row.qty / Math.max(1, Number(el.value))) : "?"}행 생성`;
                                      };
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && splitPerBoxRef.current)
                                      doSplit(i, Number(splitPerBoxRef.current));
                                  }}
                                  className="table-input"
                                  style={{ width: "80px", textAlign: "center", marginRight: "8px" }}
                                />
                                <button
                                  className="primary-button"
                                  style={{ fontSize: "12px", padding: "4px 12px", marginRight: "6px" }}
                                  onClick={() => {
                                    if (splitPerBoxRef.current) doSplit(i, Number(splitPerBoxRef.current));
                                  }}
                                >
                                  확인
                                </button>
                                <button
                                  className="secondary-button"
                                  style={{ fontSize: "12px", padding: "4px 10px" }}
                                  onClick={() => setSplitPromptIdx(null)}
                                >
                                  취소
                                </button>
                                <span className="split-info" style={{ fontSize: "12px", marginLeft: "10px", color: "var(--text-muted, #888)" }}>→ ?행 생성</span>
                              </td>
                            </tr>
                          )}

                          {/* Split child rows */}
                          {isSplit &&
                            splits[i].map((s, si) => (
                              <tr key={s.key} style={{ background: "var(--row-stripe, #fafafa)" }}>
                                <td style={{ textAlign: "center", fontSize: "11px", color: "#92400e" }}></td>
                                <td style={{ textAlign: "center", fontSize: "12px", color: "#92400e", paddingLeft: "16px" }}>↳ {row.sku}</td>
                                <td style={{ textAlign: "center", fontSize: "12px", color: "#92400e" }}>{row.barcode}</td>
                                <td style={{ fontSize: "12px", color: "#92400e", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</td>
                                <td style={{ textAlign: "center", fontSize: "12px", color: "#92400e" }}>{row.center}</td>
                                <td></td>
                                <td style={{ textAlign: "center", padding: "3px 4px" }}>
                                  <input
                                    type="number"
                                    className="table-input"
                                    value={s.qty}
                                    onChange={(e) => updateSplitQty(i, si, e.target.value)}
                                    style={{ width: "60px", textAlign: "center" }}
                                  />
                                </td>
                                <td style={{ padding: "3px 4px", textAlign: "center" }}>
                                  <input
                                    type="text"
                                    className="table-input col-box"
                                    maxLength={5}
                                    value={getA(s.key).box}
                                    onChange={(e) => setA(s.key, "box", e.target.value)}
                                    onBlur={() => onBoxBlur(s.key)}
                                    onKeyDown={(e) => handleTabNav(e, "col-box")}
                                    placeholder="박스"
                                    style={{ width: "60px", textAlign: "center" }}
                                  />
                                </td>
                                <td style={{ padding: "3px 4px", textAlign: "center" }}>
                                  <input
                                    type="text"
                                    className="table-input col-pallet"
                                    value={getA(s.key).pallet}
                                    onChange={(e) => setA(s.key, "pallet", e.target.value)}
                                    onBlur={() => onPalletBlur(s.key)}
                                    onKeyDown={(e) => handleTabNav(e, "col-pallet")}
                                    placeholder="팔레트"
                                    style={{ width: "60px", textAlign: "center" }}
                                  />
                                </td>
                              </tr>
                            ))}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredAggregated.length > visibleCount && (
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <button
                    className="secondary-button"
                    onClick={() => setVisibleCount((prev) => prev + 50)}
                  >
                    더 보기 ({visibleCount}/{filteredAggregated.length})
                  </button>
                </div>
              )}
              <p style={{ fontSize: "12px", color: "var(--text-muted, #888)", marginTop: "8px" }}>
                박스/팔레트 번호 입력 후 상단의 <b>팔레트</b> 또는 <b>박스</b> 탭에서 적재리스트를 확인하세요.
              </p>
            </>
          )}
        </section>
      )}

      {/* ═══ 팔레트 탭 ═══ */}
      {subTab === "pallet" && (
        <section className="glass-card">
          <div className="table-header-line">
            <div>
              <div className="section-label">Pallet View</div>
              <h2>팔레트별 적재리스트</h2>
            </div>
          </div>

          {aggregated.length === 0 ? (
            <div className="empty-state">
              먼저 <b>업로드</b> 탭에서 발주서를 업로드하고 팔레트번호를 입력하세요.
            </div>
          ) : (
            <>
              <div className="action-row" style={{ marginBottom: "12px", flexWrap: "wrap" }}>
                <select
                  className="select-control"
                  value={selectedCenter}
                  onChange={(e) => { setSelectedCenter(e.target.value); setSelectedPallet(""); }}
                >
                  <option value="">-- 물류센터 선택 --</option>
                  {centerList.map((c) => (
                    <option key={c} value={c}>
                      {c}{centerStats[c]?.pallets ? ` (팔레트 ${centerStats[c].pallets}개)` : ""}
                    </option>
                  ))}
                </select>
                {selectedCenter && palletListForCenter.length > 0 && (
                  <>
                    <button className="primary-button" onClick={handlePrintAllPallets}>
                      <Printer size={14} />
                      전체 팔레트 인쇄 ({palletListForCenter.length}개)
                    </button>
                    <button className="secondary-button" onClick={downloadAllPalletXlsx}>
                      <Download size={14} />
                      전체 다운로드
                    </button>
                  </>
                )}
              </div>

              {selectedCenter && palletListForCenter.length === 0 && (
                <p style={{ fontSize: "13px", color: "#dc2626", marginBottom: "12px" }}>
                  이 센터에 팔레트번호가 입력된 항목이 없습니다.
                </p>
              )}

              {selectedCenter && palletListForCenter.length > 0 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", flex: 1 }}>
                    {palletListForCenter.map((p) => (
                      <button
                        key={p}
                        onClick={() => setSelectedPallet(p)}
                        className={selectedPallet === p ? "primary-button" : "secondary-button"}
                        style={{ padding: "6px 14px", fontSize: "13px" }}
                      >
                        팔레트 {p}
                      </button>
                    ))}
                  </div>
                  {selectedPallet && (
                    <div className="action-row" style={{ flexShrink: 0 }}>
                      <button className="primary-button" onClick={() => handlePrint("pallet-print-area")}>
                        <Printer size={14} /> 인쇄
                      </button>
                      <button className="secondary-button" onClick={downloadPalletXlsx}>
                        <Download size={14} /> 다운로드
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selectedPallet && filteredPalletItems.length > 0 && (
                <div id="pallet-print-area">
                  {palletPages.map((pg, pi) => {
                    const po = unique(
                      filteredPalletItems.flatMap((i) => (i.poNos ? [...i.poNos] : []))
                    ).join(", ");
                    const ub = new Set(filteredPalletItems.map((i) => i.box).filter(Boolean)).size;
                    const bg = computeBoxGroups(pg);
                    return (
                      <div key={pi} className="print-page" style={a4Style}>
                        <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "24px", textDecoration: "underline", marginBottom: "8px" }}>
                          쿠팡 팔레트 적재리스트
                        </div>
                        <div style={{ marginBottom: "6px", fontSize: "16px", lineHeight: "1.8" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>총 팔레트 수 <b>{palletListForCenter.length}</b> - 해당 팔레트 번호 <b>{selectedPallet}</b></span>
                            <span>박스수량. [ <b>{ub}</b> BOX]</span>
                          </div>
                          <div style={{ display: "flex" }}>
                            <span style={{ flex: 1 }}><b>입고예정일자.</b> [ {pg[0]?.date || ""} ]</span>
                            <span style={{ flex: 1 }}><b>납품센터명.</b> [ {selectedCenter} 센터]</span>
                            <span style={{ flex: 1 }}><b>업체명.</b> [ <b>아노마드</b> ]</span>
                          </div>
                          <div>
                            <b>입고요청서번호.</b> [ <span style={{ fontSize: "12px" }}>{po || "____"}</span> ]
                          </div>
                        </div>
                        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "13px" }}>
                          <thead>
                            <tr>
                              {["NO", "거래명세서의\n상품번호", "물류 입고용\n상품명 + 옵션명", "총 박스\n수량", "BOX\n번호", "수량", "유통기한\n/제조일자"].map((h) => (
                                <th key={h} style={{ border: "1px solid #000", padding: "3px 5px", background: "#f3f4f6", whiteSpace: "pre-line", textAlign: "center", fontWeight: "bold" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pg.map((it, idx) => (
                              <tr key={idx} style={{ height: "26px" }}>
                                <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "30px" }}>{pi * palletRowsPerPage + idx + 1}</td>
                                <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "90px" }}>{it.sku}</td>
                                <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "left" }}>{it.name}</td>
                                {bg[idx]?.show && (
                                  <td rowSpan={bg[idx].rowSpan} style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "65px", verticalAlign: "middle", fontWeight: 600 }}>
                                    {bg[idx].boxCount}
                                  </td>
                                )}
                                <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "55px" }}>{it.box || ""}</td>
                                <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "50px" }}>{it.qty.toLocaleString()}</td>
                                <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "80px" }}>{it.expiry || ""}</td>
                              </tr>
                            ))}
                            {Array.from({ length: Math.max(0, palletRowsPerPage - pg.length) }).map((_, idx) => (
                              <tr key={`e-${idx}`} style={{ height: "26px" }}>
                                <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center" }}>{pi * palletRowsPerPage + pg.length + idx + 1}</td>
                                {[...Array(6)].map((__, ci) => <td key={ci} style={{ border: "1px solid #000", padding: "3px 5px" }}></td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {palletPages.length > 1 && (
                          <div style={{ textAlign: "right", fontSize: "10px", color: "#6b7280", marginTop: "4px" }}>
                            Page {pi + 1} / {palletPages.length}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ═══ 박스 탭 ═══ */}
      {subTab === "box" && (
        <section className="glass-card">
          <div className="table-header-line">
            <div>
              <div className="section-label">Box View</div>
              <h2>박스별 적재리스트</h2>
            </div>
          </div>

          {aggregated.length === 0 ? (
            <div className="empty-state">
              먼저 <b>업로드</b> 탭에서 발주서를 업로드하고 박스번호를 입력하세요.
            </div>
          ) : (
            <>
              <div className="action-row" style={{ marginBottom: "12px", flexWrap: "wrap" }}>
                <select
                  className="select-control"
                  value={selectedCenter}
                  onChange={(e) => { setSelectedCenter(e.target.value); setSelectedBox(""); }}
                >
                  <option value="">-- 물류센터 선택 --</option>
                  {centerList.map((c) => (
                    <option key={c} value={c}>
                      {c}{centerStats[c]?.boxes ? ` (박스 ${centerStats[c].boxes}개)` : ""}
                    </option>
                  ))}
                </select>
                {selectedCenter && boxListForCenter.length > 0 && (
                  <>
                    <button className="primary-button" onClick={handlePrintAllBoxes}>
                      <Printer size={14} />
                      전체 박스 인쇄 ({boxListForCenter.length}개)
                    </button>
                    <button className="secondary-button" onClick={downloadAllBoxXlsx}>
                      <Download size={14} />
                      전체 다운로드
                    </button>
                  </>
                )}
              </div>

              {selectedCenter && boxListForCenter.length === 0 && (
                <p style={{ fontSize: "13px", color: "#dc2626", marginBottom: "12px" }}>
                  이 센터에 박스번호가 입력된 항목이 없습니다.
                </p>
              )}

              {selectedCenter && boxListForCenter.length > 0 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", flex: 1 }}>
                    {boxListForCenter.map((b) => (
                      <button
                        key={b}
                        onClick={() => setSelectedBox(b)}
                        className={selectedBox === b ? "primary-button" : "secondary-button"}
                        style={{ padding: "6px 14px", fontSize: "13px" }}
                      >
                        박스 {b}
                      </button>
                    ))}
                  </div>
                  {selectedBox && (
                    <div className="action-row" style={{ flexShrink: 0 }}>
                      <button className="primary-button" onClick={() => handlePrint("box-print-area")}>
                        <Printer size={14} /> 인쇄
                      </button>
                      <button className="secondary-button" onClick={downloadBoxXlsx}>
                        <Download size={14} /> 다운로드
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selectedBox && filteredBoxItems.length > 0 && (
                <div id="box-print-area">
                  {boxPages.map((pg, pi) => (
                    <div key={pi} className="print-page" style={a4Style}>
                      <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "24px", textDecoration: "underline", marginBottom: "8px" }}>
                        쿠팡 박스 적재리스트
                      </div>
                      <div style={{ marginBottom: "6px", fontSize: "16px", lineHeight: "1.8" }}>
                        <div><b>박스번호.</b> [ <b>{selectedBox}</b> ]</div>
                        <div style={{ display: "flex" }}>
                          <span style={{ flex: 1 }}><b>입고예정일자.</b> [ {pg[0]?.date || ""} ]</span>
                          <span style={{ flex: 1 }}><b>납품센터명.</b> [ {selectedCenter} 센터]</span>
                          <span style={{ flex: 1 }}><b>업체명.</b> [ <b>아노마드</b> ]</span>
                        </div>
                      </div>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "13px" }}>
                        <thead>
                          <tr>
                            {["번호", "SKU No", "SKU NAME", "바코드", "수량"].map((h) => (
                              <th key={h} style={{ border: "1px solid #000", padding: "3px 5px", background: "#f3f4f6", textAlign: "center", fontWeight: "bold" }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pg.map((it, idx) => (
                            <tr key={idx} style={{ height: "26px" }}>
                              <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "30px" }}>{pi * BOX_ROWS_PER_PAGE + idx + 1}</td>
                              <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "100px" }}>{it.sku}</td>
                              <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "left" }}>{it.name}</td>
                              <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "120px" }}>{it.barcode}</td>
                              <td style={{ border: "1px solid #000", padding: "3px 5px", textAlign: "center", width: "55px" }}>{it.qty.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {boxPages.length > 1 && (
                        <div style={{ textAlign: "right", fontSize: "10px", color: "#6b7280", marginTop: "4px" }}>
                          Page {pi + 1} / {boxPages.length}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
