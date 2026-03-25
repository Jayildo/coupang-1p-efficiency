import { useCallback, useState } from "react";
import JSZip from "jszip";
import {
  Archive,
  Download,
  FileText,
  Play,
  Trash2,
  Upload
} from "lucide-react";
import { filterPdfPages } from "../utils/pdfProcessor";

function createFileEntry(file) {
  return {
    id: crypto.randomUUID(),
    file,
    status: "pending",
    progress: null,
    result: null,
    stats: null,
    error: null
  };
}

export default function DocumentWorkbench() {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const addFiles = useCallback((candidateFiles) => {
    const pdfFiles = candidateFiles.filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfFiles.length === 0) return;
    setFiles((current) => [...current, ...pdfFiles.map(createFileEntry)]);
  }, []);

  const handleChange = (event) => {
    addFiles(Array.from(event.target.files || []));
  };

  const processOne = async (entry) => {
    setFiles((current) =>
      current.map((file) =>
        file.id === entry.id
          ? {
              ...file,
              status: "processing",
              progress: { status: "scanning", current: 0, total: 0 }
            }
          : file
      )
    );

    try {
      const result = await filterPdfPages(entry.file, (progress) => {
        setFiles((current) =>
          current.map((file) =>
            file.id === entry.id ? { ...file, progress } : file
          )
        );
      });

      setFiles((current) =>
        current.map((file) =>
          file.id === entry.id
            ? {
                ...file,
                status: "done",
                result: result.blob,
                stats: {
                  originalPages: result.originalPages,
                  filteredPages: result.filteredPages
                }
              }
            : file
        )
      );
    } catch (error) {
      setFiles((current) =>
        current.map((file) =>
          file.id === entry.id
            ? { ...file, status: "error", error: error.message }
            : file
        )
      );
    }
  };

  const processAll = async () => {
    setIsProcessing(true);
    const queue = files.filter(
      (file) => file.status === "pending" || file.status === "error"
    );
    for (const entry of queue) {
      // eslint-disable-next-line no-await-in-loop
      await processOne(entry);
    }
    setIsProcessing(false);
  };

  const downloadFile = (entry) => {
    if (!entry.result) return;
    const url = URL.createObjectURL(entry.result);
    const link = document.createElement("a");
    link.href = url;
    link.download = `filtered-${entry.file.name}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadZip = async () => {
    const completed = files.filter((file) => file.status === "done" && file.result);
    if (completed.length === 0) return;
    const zip = new JSZip();
    completed.forEach((entry) => {
      zip.file(`filtered-${entry.file.name}`, entry.result);
    });
    const output = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(output);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hanomad-documents.zip";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="workspace-stack">
      <section className="glass-card workspace-intro">
        <div>
          <div className="section-label">Document Studio</div>
          <h2>거래명세서에서 필요한 PDF 페이지만 자동 추출합니다.</h2>
          <p>
            기존 `PdfFilter` 로직을 유지하되, 업로드와 처리 상태를 서비스형 화면에
            맞게 재정리했습니다.
          </p>
        </div>
        <div className="action-row">
          <label className="file-button">
            <Upload size={16} />
            PDF 추가
            <input type="file" accept=".pdf" multiple onChange={handleChange} />
          </label>
          <button className="secondary-button" onClick={processAll}>
            <Play size={16} />
            {isProcessing ? "처리 중..." : "전체 처리"}
          </button>
          <button className="secondary-button" onClick={downloadZip}>
            <Archive size={16} />
            ZIP 다운로드
          </button>
        </div>
      </section>

      <section
        className={isDragging ? "glass-card dropzone active" : "glass-card dropzone"}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(Array.from(event.dataTransfer.files || []));
        }}
      >
        <FileText size={22} />
        <div>
          <strong>PDF를 드래그해서 올리거나 파일 선택 버튼을 사용하세요.</strong>
          <p>
            `Coupang Submission Copy`부터 `Vendor Storage Copy` 직전까지의
            페이지만 남깁니다.
          </p>
        </div>
      </section>

      <section className="glass-card table-card">
        <div className="table-header-line">
          <div>
            <div className="section-label">Processing Queue</div>
            <h2>문서 처리 목록</h2>
          </div>
          <button className="subtle-button" onClick={() => setFiles([])}>
            <Trash2 size={16} />
            전체 비우기
          </button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>파일명</th>
                <th>용량</th>
                <th>상태</th>
                <th>결과</th>
                <th>동작</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-state">
                    처리할 PDF가 아직 없습니다.
                  </td>
                </tr>
              ) : (
                files.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.file.name}</td>
                    <td>{(entry.file.size / 1024 / 1024).toFixed(2)} MB</td>
                    <td>
                      {entry.status === "pending" && "대기"}
                      {entry.status === "processing" &&
                        `스캔 ${entry.progress?.current ?? 0}/${entry.progress?.total ?? 0}`}
                      {entry.status === "done" && "완료"}
                      {entry.status === "error" && `오류: ${entry.error}`}
                    </td>
                    <td>
                      {entry.stats
                        ? `${entry.stats.originalPages}p -> ${entry.stats.filteredPages}p`
                        : "-"}
                    </td>
                    <td>
                      {entry.status === "done" ? (
                        <button
                          className="table-button"
                          onClick={() => downloadFile(entry)}
                        >
                          <Download size={14} />
                          다운로드
                        </button>
                      ) : (
                        <button
                          className="table-button"
                          onClick={() =>
                            setFiles((current) =>
                              current.filter((file) => file.id !== entry.id)
                            )
                          }
                        >
                          <Trash2 size={14} />
                          제거
                        </button>
                      )}
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
