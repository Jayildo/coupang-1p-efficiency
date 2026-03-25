import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function filterPdfPages(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument(arrayBuffer.slice(0));
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pagesToKeep = [];
  let isKeeping = false;

  if (onProgress) {
    onProgress({ status: "scanning", current: 0, total: totalPages });
  }

  for (let index = 1; index <= totalPages; index += 1) {
    const page = await pdf.getPage(index);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    const normalized = pageText.toLowerCase().replace(/\s+/g, " ");

    const hasSubmissionCopy = normalized.includes("coupang submission copy");
    const hasStorageCopy = normalized.includes("vendor storage copy");

    if (hasSubmissionCopy) {
      isKeeping = true;
      pagesToKeep.push(index);
    } else if (hasStorageCopy) {
      isKeeping = false;
    } else if (isKeeping) {
      pagesToKeep.push(index);
    }

    if (onProgress) {
      onProgress({ status: "scanning", current: index, total: totalPages });
    }
  }

  if (pagesToKeep.length === 0) {
    throw new Error("추출 가능한 페이지를 찾지 못했습니다.");
  }

  if (onProgress) {
    onProgress({ status: "generating", current: 1, total: 1 });
  }

  const source = await PDFDocument.load(arrayBuffer);
  const nextDoc = await PDFDocument.create();
  const copiedPages = await nextDoc.copyPages(
    source,
    pagesToKeep.map((page) => page - 1)
  );

  copiedPages.forEach((page) => nextDoc.addPage(page));

  return {
    blob: new Blob([await nextDoc.save()], { type: "application/pdf" }),
    originalPages: totalPages,
    filteredPages: pagesToKeep.length
  };
}
