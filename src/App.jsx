// App_Step7_v19.jsx
// 트랙 1 단계 3·4: PDF 학습에 출처 메타 보존 추가
//
// 주요 변경 (v18 → v19):
//   - 신규 헬퍼: extractPdfOutline (목차 파싱) / parseChapterFromAnalysis (Vision 응답에서 챕터 추출) / buildSourceMeta
//   - saveToSheet / saveToSheetSingle / saveCommonKnowledge: 4번째 인자 sourceMeta 받음 (하위 호환)
//   - Vision 프롬프트에 [챕터/섹션] 블록 추가
//   - TabDocument PDF Vision 모드: 페이지별 N개 row 저장 (종합 요약 row 없음), 페이지별 카드 UI
//   - TabDocument PDF 텍스트 모드: 4블록 형식 적용 (챕터 정보 추출)
//   - startSync (폴더 동기화) PDF Vision 모드: 페이지별 N개 row, 첫 페이지로 카테고리 결정
//   - startRelearn (재학습) PDF Vision 모드: 페이지별 N개 row, 카테고리는 기존 유지
//   - 챕터 결정 순서: 목차 매핑 → Vision 응답 → 직전 페이지 상속 → 빈 칸
//   - source_url: 자동학습 PDF는 driveUrl#page=N, 직접 업로드 PDF는 페이지별 이미지 URL
//
// 호환성: 기존 학습 데이터는 영향 없음 (sourceMeta 안 보내면 Apps Script v9가 빈 칸으로 저장)

import { useState, useRef, useEffect, useMemo } from "react";

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE9ZyopUTxEEXpt3UjWjfgDljEiGodgbunj_UnXYc-1RlrXgNiDzAiikXoEP4g9_E/exec";

const ROLE_CONFIG = {
  Cell_PE: { label: "생산 엔지니어", line: "Cell", color: "#3b82f6", bg: "rgba(59,130,246,0.12)", icon: "🔵",
    focus: "Cell 라인 생산 목표 달성, 납기, 공정 안정화, OEE 관리" },
  Cell_ME: { label: "설비 엔지니어", line: "Cell", color: "#f97316", bg: "rgba(249,115,22,0.12)", icon: "🟠",
    focus: "Cell 설비 가동률, 예방보전, 고장 원인, MTBF/MTTR 관리" },
  Cell_TE: { label: "기술 엔지니어", line: "Cell", color: "#22d3ee", bg: "rgba(34,211,238,0.12)", icon: "🟢",
    focus: "Cell 공정 기술, 품질 원인 분석, 조건 최적화, 재발 방지" },
  Elec_PE: { label: "생산 엔지니어", line: "Elec", color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "🟣",
    focus: "Elec 라인 생산 목표 달성, 납기, 공정 안정화, OEE 관리" },
  Elec_ME: { label: "설비 엔지니어", line: "Elec", color: "#f43f5e", bg: "rgba(244,63,94,0.12)", icon: "🔴",
    focus: "Elec 설비 가동률, 예방보전, 고장 원인, MTBF/MTTR 관리" },
  Elec_TE: { label: "기술 엔지니어", line: "Elec", color: "#34d399", bg: "rgba(52,211,153,0.12)", icon: "🟩",
    focus: "Elec 공정 기술, 품질 원인 분석, 조건 최적화, 재발 방지" },
  FA: { label: "FA 엔지니어", line: "공통", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: "🟡",
    focus: "공정 간 자동 반송 시스템 (C/V, Stocker, OHT, AGV) 운영·정비, WIP 흐름 관리" },
  Vision: { label: "비전 엔지니어", line: "공통", color: "#ec4899", bg: "rgba(236,72,153,0.12)", icon: "🩷",
    focus: "외관 검사 시스템, 불량 이미지 분석, 비전 알고리즘, 검사 기준 관리" },
  Cell_PLC: { label: "PLC 엔지니어", line: "Cell", color: "#84cc16", bg: "rgba(132,204,22,0.12)", icon: "🎛️",
    focus: "Cell 라인 PLC 프로그램·시퀀스·통신, 알람 분석, I/O 디버깅" },
  Elec_PLC: { label: "PLC 엔지니어", line: "Elec", color: "#65a30d", bg: "rgba(101,163,13,0.12)", icon: "🎛️",
    focus: "Elec 라인 PLC 프로그램·시퀀스·통신, 알람 분석, I/O 디버깅" },
  FA_PLC: { label: "PLC 엔지니어", line: "공통", color: "#4d7c0f", bg: "rgba(77,124,15,0.12)", icon: "🎛️",
    focus: "물류 자동화(C/V, Stocker, OHT) PLC 프로그램·시퀀스·통신, 알람 분석" },
};

// 대시보드용 8개 에이전트 메타
const DASHBOARD_AGENT_META = {
  Cell_PE: { line: "Cell", role: "생산", color: "#3b82f6" },
  Cell_ME: { line: "Cell", role: "설비", color: "#f97316" },
  Cell_TE: { line: "Cell", role: "기술", color: "#22d3ee" },
  Elec_PE: { line: "Elec", role: "생산", color: "#a78bfa" },
  Elec_ME: { line: "Elec", role: "설비", color: "#f43f5e" },
  Elec_TE: { line: "Elec", role: "기술", color: "#34d399" },
  FA: { line: "공통", role: "FA", color: "#f59e0b" },
  Vision: { line: "공통", role: "비전", color: "#ec4899" },
  Cell_PLC: { line: "Cell", role: "PLC", color: "#84cc16" },
  Elec_PLC: { line: "Elec", role: "PLC", color: "#65a30d" },
  FA_PLC: { line: "공통", role: "PLC", color: "#4d7c0f" },
};

const LINE_COLORS = {
  Cell: "#0ea5e9",
  Elec: "#f43f5e",
  공통: "#10b981",
};

// 학습 수준 평가 - 절대평가 목표값 (보수적 기준, 2달 학습 가정)
// 각 지표별로 이 목표값에 도달하면 100점
const TARGET_VALUES = {
  itemCount: 300,        // 학습 항목 수 (row)
  contentLength: 80000,  // 학습 내용 총 글자수
  categoryCount: 5,      // 카테고리 다양성 (전체 5종 모두 사용)
  correctionCount: 60,   // 교정 사례 수
  recentRate: 70,        // 최신성 (최근 7일 내 업데이트 비율 70%)
};

// URL 파라미터에서 role 읽기
function getRole() {
  // search 방식과 hash 방식 모두 지원
  const search = window.location.search || window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(search);
  const r = params.get("role")?.toUpperCase();
  // Cell_PE 형식 처리 (대소문자 혼용)
  const roleKey = Object.keys(ROLE_CONFIG).find(k => k.toUpperCase() === r);
  return roleKey || null;
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function callClaude(system, userMsg) {
  const res = await fetch("/.netlify/functions/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userMsg, max_tokens: 1000 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.content || []).map(i => i.text || "").join("").trim();
}

// Vision API 호출
async function callClaudeVision(system, userMsg, imageBase64, mediaType) {
  const res = await fetch("/.netlify/functions/claude-vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userMsg, imageBase64, mediaType }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.content || []).map(i => i.text || "").join("").trim();
}

// 파일을 Base64로 변환 (이미지인 경우 자동 압축)
// 긴 변이 1600px 넘으면 비율 유지하며 축소, JPEG 90% 품질로 재인코딩
function fileToBase64(file) {
  // 이미지가 아니면 원본 그대로 base64 변환
  if (!file.type.startsWith("image/")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 이미지 압축 처리
  return new Promise((resolve, reject) => {
    const MAX_DIMENSION = 1600;
    const QUALITY = 0.9;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          const longSide = Math.max(width, height);

          // 긴 변이 MAX 초과 시 축소
          if (longSide > MAX_DIMENSION) {
            const scale = MAX_DIMENSION / longSide;
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          // JPEG로 재인코딩 (PNG도 JPEG로 변환되어 용량 줄어듦)
          const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
          resolve(dataUrl.split(",")[1]);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("이미지 로드 실패"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
}

// 압축 후 base64 데이터 크기를 KB로 추정 (UI 표시용)
function estimateBase64Size(base64) {
  return Math.round((base64.length * 3 / 4) / 1024);
}

// PDF 텍스트 추출 (간단 방식)
async function extractTextFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => resolve("");
    reader.readAsText(file, "utf-8");
  });
}

// ─── PDF 처리 (Step 5-B) ────────────────────────────────────────────────────────
// pdfjs를 CDN에서 동적 로드 (package.json 의존성 없이)
// 한 번만 로드하고 캐시
let _pdfjsLib = null;
async function loadPdfjs() {
  if (_pdfjsLib) return _pdfjsLib;
  // 이미 로드되어 있으면 사용
  if (window.pdfjsLib) {
    _pdfjsLib = window.pdfjsLib;
    return _pdfjsLib;
  }
  // CDN에서 로드
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      // worker도 CDN으로 설정
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      _pdfjsLib = window.pdfjsLib;
      resolve(_pdfjsLib);
    };
    script.onerror = () => reject(new Error("pdfjs 로드 실패"));
    document.head.appendChild(script);
  });
}

// PDF 파일에서 페이지 수 + PDF 객체 반환
async function loadPdfDocument(file) {
  const pdfjs = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  return pdf; // pdf.numPages, pdf.getPage(n)
}

// PDF에서 모든 페이지 텍스트 추출
async function extractPdfText(pdf) {
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(" ");
    texts.push(pageText);
  }
  return texts.join("\n\n"); // 페이지 사이 빈 줄
}

// PDF의 특정 페이지를 base64 이미지로 변환 (1600px 기준)
async function pdfPageToBase64(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const MAX_DIMENSION = 1600;

  // 원본 viewport (scale 1)
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  // 1600px에 맞도록 스케일 계산
  const scale = longSide > MAX_DIMENSION ? (MAX_DIMENSION / longSide) : 1;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");

  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return dataUrl.split(",")[1]; // base64 부분만
}

// ─── 트랙 1: PDF 출처 메타 보존 헬퍼 (v19) ─────────────────────────────────
// pdf.js outline API로 PDF 목차 파싱 → 페이지별 챕터 매핑 (Dense)
// 반환: { 1: "1. 개요", 2: "1. 개요", ..., 40: "2. 안전 인터록", 42: "2. 안전 인터록 > 2.1 도어 인터록", ... }
// 목차 없거나 추출 실패 시 빈 객체 {} 반환 (Vision fallback으로 동작)
async function extractPdfOutline(pdf) {
  try {
    const outline = await pdf.getOutline();
    if (!outline || outline.length === 0) return {};

    // 1단계: 모든 outline 항목을 평탄화 + 페이지 번호 추출
    const entries = [];
    const walk = async (items, depth, ancestors) => {
      for (const item of items) {
        let pageNum = null;
        try {
          if (item.dest) {
            const dest = typeof item.dest === "string"
              ? await pdf.getDestination(item.dest)
              : item.dest;
            if (dest && dest[0]) {
              const ref = dest[0];
              const idx = await pdf.getPageIndex(ref);
              pageNum = idx + 1; // 1-based
            }
          }
        } catch { /* 페이지 매핑 실패 — 이 항목 스킵 */ }

        if (pageNum) {
          entries.push({
            pageNum,
            depth,
            title: (item.title || "").trim(),
            ancestors: [...ancestors],
          });
        }
        if (item.items && item.items.length > 0) {
          await walk(item.items, depth + 1, [...ancestors, (item.title || "").trim()]);
        }
      }
    };
    await walk(outline, 0, []);

    if (entries.length === 0) return {};

    // 2단계: 페이지 순으로 정렬
    entries.sort((a, b) => a.pageNum - b.pageNum);

    // 3단계: Dense 매핑 — 1페이지부터 마지막 페이지까지 챕터 채우기
    // - 챕터 깊이는 1단계+2단계까지 결합
    // - 형식: "1단계 > 2단계" (둘 다 있을 때) 또는 "1단계" (1단계만)
    const totalPages = pdf.numPages;
    const mapping = {};

    let currentL0 = ""; // 1단계 챕터
    let currentL1 = ""; // 2단계 챕터
    let entryIdx = 0;

    for (let p = 1; p <= totalPages; p++) {
      while (entryIdx < entries.length && entries[entryIdx].pageNum <= p) {
        const e = entries[entryIdx];
        if (e.depth === 0) {
          currentL0 = e.title;
          currentL1 = ""; // 1단계 바뀌면 2단계 초기화
        } else if (e.depth === 1) {
          currentL1 = e.title;
        }
        entryIdx++;
      }

      if (currentL0 && currentL1) {
        mapping[p] = `${currentL0} > ${currentL1}`;
      } else if (currentL0) {
        mapping[p] = currentL0;
      }
    }

    return mapping;
  } catch (e) {
    console.warn("[PDF 목차 파싱 실패]", e.message);
    return {};
  }
}

// Vision 응답 텍스트에서 [챕터/섹션] 블록 내용 추출
// - 블록 없음 → 빈 문자열
// - 블록 있고 "없음" / "해당 없음" / "N/A" 류 → 빈 문자열
// - 블록 있고 내용 있음 → trim해서 반환
function parseChapterFromAnalysis(text) {
  if (!text) return "";
  const match = text.match(/\[챕터\/섹션\]\s*\n?([^\n\[]*)/);
  if (!match) return "";
  const value = (match[1] || "").trim();
  if (!value) return "";
  const negativePatterns = /^(없음|해당\s*없음|N\/A|n\/a|null|undefined|-)$/i;
  if (negativePatterns.test(value)) return "";
  return value;
}

// sourceMeta 객체 빌더 — 4개 필드 명시적 생성
function buildSourceMeta(file, page, section, url) {
  return {
    file: file || "",
    page: page || "",
    section: section || "",
    url: url || "",
  };
}

// 비용 계산 (PDF 처리)
const PDF_COST = {
  visionPerPage: 0.02,  // Vision API 페이지당 $0.02
  textPerKToken: 0.003, // Claude 텍스트 input 1K token당 $0.003
  outputPerKToken: 0.015,
  usdToKrw: 1400,       // 어림 환율
};

// 텍스트 추출 비용 계산
function calcTextExtractCost(pageCount) {
  // 페이지당 약 500 토큰 가정 + 출력 500 토큰
  const inputTokens = pageCount * 500;
  const outputTokens = 500;
  const usd = (inputTokens / 1000) * PDF_COST.textPerKToken
            + (outputTokens / 1000) * PDF_COST.outputPerKToken;
  const krw = Math.round(usd * PDF_COST.usdToKrw);
  return { usd: Math.max(usd, 0.001), krw, label: `약 $${usd.toFixed(3)} (₩${krw.toLocaleString()})` };
}

// 그림 분석 비용 계산
function calcVisionCost(pageCount) {
  const usd = pageCount * PDF_COST.visionPerPage;
  const krw = Math.round(usd * PDF_COST.usdToKrw);
  return { usd, krw, label: `약 $${usd.toFixed(2)} (₩${krw.toLocaleString()})` };
}

// 처리 시간 예상
function estimateTime(pageCount, mode) {
  if (mode === "text") return Math.max(5, Math.round(pageCount * 0.3)) + "초";
  // vision: 페이지당 약 5~6초
  const seconds = pageCount * 5;
  if (seconds < 60) return `약 ${seconds}초`;
  return `약 ${Math.round(seconds / 60)}분`;
}

// ─── 청크 분할 헬퍼 (Step 7-10A) ────────────────────────────────────────────
// 긴 학습 항목을 단락 경계로 분할하여 채팅 컨텍스트 점유와 시트 가독성 개선.
// - 2,500자 초과 시 분할 (그 미만은 분할 안 함)
// - 청크당 목표 2,000자, 단락 경계 우선
// - content 앞에 (1/N) 형태 라벨 추가 → 자동 점검에서 같은 출처로 인식
const CHUNK_THRESHOLD = 2500;
const CHUNK_TARGET = 2000;

function splitContentIntoChunks(content) {
  if (!content || content.length <= CHUNK_THRESHOLD) return [content];

  // 단락 경계 후보 (우선순위 높은 순): \n\n > \n > . / 。 / 다. > 공백
  const chunks = [];
  let remaining = content;

  while (remaining.length > CHUNK_TARGET) {
    let cut = CHUNK_TARGET;
    // 목표 길이 근처에서 가장 가까운 경계 탐색 (목표 ±20% 범위)
    const minCut = Math.floor(CHUNK_TARGET * 0.7);
    const maxCut = Math.min(remaining.length, Math.floor(CHUNK_TARGET * 1.2));
    const window = remaining.slice(minCut, maxCut);

    // 단락 (\n\n) → 문장 (. ! ? 다.) → 줄바꿈 (\n) → 공백 → 마지막에 강제 컷
    const breakPatterns = [
      /\n\n/g,        // 단락 경계
      /[\.!?]\s/g,    // 영문 문장
      /다\.\s/g,      // 한글 문장
      /\n/g,          // 줄바꿈
      /\s\/\s/g,      // " / " 구분자 (이 앱에서 자주 씀)
      /,\s/g,         // 컴마
      /\s/g,          // 공백
    ];

    let breakAt = -1;
    for (const pat of breakPatterns) {
      const matches = [...window.matchAll(pat)];
      if (matches.length > 0) {
        // 가장 끝쪽 경계 사용 (chunk를 가능한 크게 유지)
        breakAt = matches[matches.length - 1].index + matches[matches.length - 1][0].length;
        break;
      }
    }

    if (breakAt > 0) {
      cut = minCut + breakAt;
    }
    // 경계 못 찾으면 강제 컷

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

// 청크 라벨 추가: 원본 prefix(예: "[외부학습 v12]") 다음에 "(1/3)" 삽입
// prefix가 없으면 content 앞에 "(1/3) " 추가
function applyChunkLabel(chunk, idx, total) {
  if (total === 1) return chunk;
  // 대괄호로 시작하는 prefix 패턴 ("[외부학습 v12] ..." 또는 "[파일: xxx] ...")
  const prefixMatch = chunk.match(/^(\[[^\]]+\])\s*/);
  if (prefixMatch) {
    return `${prefixMatch[1]} (${idx + 1}/${total}) ${chunk.slice(prefixMatch[0].length)}`;
  }
  return `(${idx + 1}/${total}) ${chunk}`;
}

async function saveToSheet(role, category, content, sourceMeta) {
  // 청크 분할 적용 (긴 항목은 자동 다중 행 저장)
  // v19: sourceMeta가 있으면 모든 청크에 동일하게 전달 (같은 출처 보존)
  const chunks = splitContentIntoChunks(content);
  if (chunks.length === 1) {
    return saveToSheetSingle(role, category, content, sourceMeta);
  }
  // 다중 청크 저장 — 직렬 처리 (Apps Script 일괄 호출 회피)
  let ok = true;
  for (let i = 0; i < chunks.length; i++) {
    const labeled = applyChunkLabel(chunks[i], i, chunks.length);
    const r = await saveToSheetSingle(role, category, labeled, sourceMeta);
    if (!r) ok = false;
  }
  return ok;
}

async function saveToSheetSingle(role, category, content, sourceMeta) {
  try {
    // v19: sourceMeta는 선택적 (Apps Script v9가 없으면 빈 칸으로 처리, 하위 호환)
    const payload = { action: "save_knowledge", role, category, content };
    if (sourceMeta) payload.sourceMeta = sourceMeta;
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    invalidateCache(role); // Step 7-12: 쓰기 후 캐시 무효화
    return true;
  } catch { return false; }
}

// ─── 캐시 시스템 (Step 7-12) ────────────────────────────────────────────
// loadFromSheet 결과를 React 메모리 + localStorage에 캐싱
// - TTL 10분: 그 안에는 fresh fetch 안 함
// - 쓰기 작업(save/delete/replace) 시 즉시 무효화
// - 첫 진입 시 캐시 있으면 즉시 표시 + 백그라운드에서 신선한 데이터 fetch
// 효과: 채팅 시 매번 호출되는 loadFromSheet의 API 호출 95%+ 감소
const KNOWLEDGE_CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const KNOWLEDGE_CACHE_PREFIX = "kb_cache_v1_";

// 메모리 캐시 (세션 내 빠른 접근)
const _memoryCache = {};

// localStorage 키 빌더
function cacheKey(role) { return `${KNOWLEDGE_CACHE_PREFIX}${role}`; }

// 캐시 읽기 — TTL 검사 포함
function readCache(role) {
  // 메모리 캐시 먼저
  if (_memoryCache[role]) {
    const entry = _memoryCache[role];
    if (Date.now() - entry.ts < KNOWLEDGE_CACHE_TTL_MS) {
      return { data: entry.data, fresh: false };
    }
  }
  // localStorage fallback
  try {
    const raw = localStorage.getItem(cacheKey(role));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts < KNOWLEDGE_CACHE_TTL_MS) {
      _memoryCache[role] = entry; // 메모리에도 동기화
      return { data: entry.data, fresh: false };
    }
  } catch {}
  return null;
}

// 캐시 쓰기 — 메모리 + localStorage 동기
function writeCache(role, data) {
  const entry = { ts: Date.now(), data };
  _memoryCache[role] = entry;
  try {
    localStorage.setItem(cacheKey(role), JSON.stringify(entry));
  } catch (e) {
    // localStorage 가득 차거나 차단된 경우 - 메모리만 사용
    console.warn("[캐시] localStorage 쓰기 실패:", e.message);
  }
}

// 캐시 무효화 — 특정 role
function invalidateCache(role) {
  delete _memoryCache[role];
  try { localStorage.removeItem(cacheKey(role)); } catch {}
}

// 신선한 데이터 직접 가져오기 (캐시 우회)
async function fetchKnowledgeFromSheet(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_knowledge&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// loadFromSheet — 캐시 우선 (Step 7-12)
// 캐시 있고 신선하면 그대로 반환, 없거나 stale이면 API 호출
async function loadFromSheet(role) {
  const cached = readCache(role);
  if (cached) {
    return cached.data;
  }
  const fresh = await fetchKnowledgeFromSheet(role);
  if (fresh.length > 0) writeCache(role, fresh);
  return fresh;
}

// loadFromSheet의 강제 fresh 버전 — 명시적 새로고침 시 사용
async function loadFromSheetFresh(role) {
  const fresh = await fetchKnowledgeFromSheet(role);
  if (fresh.length > 0) writeCache(role, fresh);
  return fresh;
}

// 대시보드 - 전체 8개 에이전트 진행률 로드
async function loadAllProgress() {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_all_progress`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 요약본 로드 (없으면 null)
async function loadSummary(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_summary&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : null;
  } catch { return null; }
}

// 요약본 저장 (기존 _요약 행 삭제 후 새로 1건 저장)
async function saveSummaryToSheet(role, summary) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_summary", role, summary }),
    });
    return true;
  } catch { return false; }
}

// 마지막 요약 이후 추가된 row 수 (요약 갱신 트리거 판단용)
async function loadSummaryCount(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=count_since_summary&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : { count: 0, hasSummary: false };
  } catch { return { count: 0, hasSummary: false }; }
}

// 특정 카테고리의 항목들만 로드 (자동 충돌 검사용)
async function loadCategoryItems(role, category) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_category_items&role=${role}&category=${encodeURIComponent(category)}`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 기존 row 교체 (신규로 교체 옵션)
async function replaceKnowledge(role, category, oldContent, newContent) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "replace_knowledge", role, category, oldContent, newContent }),
    });
    invalidateCache(role); // Step 7-12
    return true;
  } catch { return false; }
}

// 특정 row 삭제
async function deleteKnowledge(role, category, content) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "delete_knowledge", role, category, content }),
    });
    invalidateCache(role); // Step 7-12
    return true;
  } catch { return false; }
}

// 불량 사진 누적 카운트 + 패턴 존재 여부
async function loadDefectImageCount(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=count_defect_images&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : { count: 0, hasPattern: false };
  } catch { return { count: 0, hasPattern: false }; }
}

// 불량 사진 학습 데이터 모두 로드 (패턴 추출 시 사용)
async function loadDefectImageData(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_defect_image_data&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 불량 패턴 저장 (category="_불량패턴", 항상 1건만 유지)
async function saveDefectPattern(role, pattern) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_defect_pattern", role, pattern }),
    });
    return true;
  } catch { return false; }
}

// ─── 학습자료 폴더 동기화 (Step 5-C) ──────────────────────────────────────────

// 학습자료 폴더 스캔 (특정 role + _공통)
// 반환: { roleFiles: [...], commonFiles: [...] }
async function scanLearningFolder(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=scan_learning_folder&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : { roleFiles: [], commonFiles: [] };
  } catch { return { roleFiles: [], commonFiles: [] }; }
}

// 드라이브에서 파일 내용(base64) 가져오기
// 실패 시 에러 메시지를 살려서 반환 (디버깅용)
async function fetchDriveFile(fileId) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_drive_file&fileId=${fileId}`);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.success) {
      return { success: true, data: data.data };
    }
    return { success: false, error: data.error || "Apps Script 응답 success=false" };
  } catch (e) {
    return { success: false, error: `네트워크 오류: ${e.message}` };
  }
}

// 파일 처리 완료로 마크
async function markFileProcessed(role, fileId, filename) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "mark_file_processed", role, fileId, filename }),
    });
    return true;
  } catch { return false; }
}

// 공통 학습 데이터 저장 (Common_Knowledge 시트)
// v19: sourceMeta 인자 추가 (saveToSheetSingle과 동일 패턴, 하위 호환)
async function saveCommonKnowledge(category, content, sourceMeta) {
  try {
    const payload = { action: "save_common_knowledge", category, content };
    if (sourceMeta) payload.sourceMeta = sourceMeta;
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    return true;
  } catch { return false; }
}

// 공통 학습 데이터 조회
async function loadCommonKnowledge() {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_common_knowledge`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 이미지를 드라이브에 업로드 (Apps Script 직접 호출)
// Content-Type: text/plain으로 CORS preflight 회피
// 응답: { success, data: { url, fileId, filename } } 또는 null
async function uploadImageToDrive(role, filename, base64, mimetype) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain" },  // text/plain으로 preflight 회피
      body: JSON.stringify({
        action: "upload_image",
        role,
        filename,
        base64,
        mimetype,
      }),
    });
    if (!res.ok) {
      console.error(`드라이브 업로드 HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.success) {
      console.error("드라이브 업로드 실패:", data.error);
      return null;
    }
    return data.data; // { url, fileId, filename }
  } catch (e) {
    console.error("드라이브 업로드 에러:", e);
    return null;
  }
}

// 신규 항목 vs 기존 카테고리 항목들 AI 충돌 검사
// 반환: null (충돌 없음) | { conflictWith: {category, content}, type: "duplicate"|"conflict", reason: string }
async function checkConflict(role, category, newContent) {
  // 같은 카테고리 기존 데이터 로드
  const existing = await loadCategoryItems(role, category);
  if (existing.length === 0) return null; // 비교 대상 없음

  // 너무 많으면 최근 20건까지만
  const targets = existing.slice(-20);
  const targetsText = targets.map((it, i) => `${i + 1}. ${it.content}`).join("\n");

  const sys = `당신은 학습 데이터 검증자입니다. 신규 항목이 기존 데이터와 중복되거나 충돌하는지 판단하세요.

[기존 ${category} 항목들]
${targetsText}

[신규 항목]
${newContent}

[판단 기준]
- duplicate: 기존 항목 중 하나와 같은 의미 (표현만 다름)
- conflict: 기존 항목 중 하나와 같은 주제이지만 내용이 다름 (수치 다름, 절차 다름 등)
- none: 충돌 없음 (다른 주제이거나 보완 정보)

JSON으로만 답하세요. 다른 설명 없이.

응답 형식:
{"type":"duplicate"|"conflict"|"none","matchIndex":1~${targets.length}|null,"reason":"한 줄 사유"}`;

  try {
    const raw = await callClaude(sys, "판단 결과만 JSON으로 답하세요.");
    const parsed = safeJSON(raw);

    if (parsed.type === "none") return null;
    if (!parsed.matchIndex || parsed.matchIndex < 1 || parsed.matchIndex > targets.length) return null;

    return {
      type: parsed.type,
      conflictWith: targets[parsed.matchIndex - 1],
      reason: parsed.reason || "",
    };
  } catch {
    return null; // 검사 실패 시 충돌 없는 것으로 처리 (저장 막지 않음)
  }
}

// JSON 파싱
function safeJSON(raw) {
  const cleaned = (raw || "").replace(/```json|```/gi, "").trim();
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s === -1 || e === -1) {
    // 진짜 원인을 알 수 있도록 raw 응답을 에러 메시지에 포함
    const preview = (cleaned || "").slice(0, 200) || "(빈 응답)";
    throw new Error(`AI가 JSON 형식으로 답하지 않았습니다. 응답: ${preview}`);
  }
  try {
    return JSON.parse(cleaned.slice(s, e + 1));
  } catch (parseErr) {
    throw new Error(`JSON 파싱 실패: ${parseErr.message}`);
  }
}

// ─── 빈약 자동학습 항목 감지 (Step 7-11 v4) ─────────────────────────────────
// v14 변경: 메타 row만 대상으로 — 같은 파일이 여러 row로 분리 저장되는 구조 반영
//   - 시트는 한 파일 = 메타 row(파일명+URL) + 종합요약 row + 페이지별 row
//   - 종합요약·페이지별 row를 빈약으로 잡으면 파일명 추출 실패 → "Drive 파일 없음"
//   - 메타 row만 트리거로 잡고, 재학습 시 같은 파일 다른 row도 함께 정리
//
// 메타 row 식별: 자동학습 prefix 시작 + 페이지 URL 다수 또는 [PDF: ...] 메타 형식
// 신호:
//   (1) [시각 설명] 블록 존재 → v10 이전 학습 (옛 프롬프트). 가장 강한 신호
//   (2) 분량 < 500자 + 자동학습 prefix → 짧은 빈약
//   (3) 페이지당 평균 매우 낮음 (페이지 3+ + 평균 <100자)
function isWeakAutoItem(content) {
  if (!content) return false;

  // 학습앱 자동학습이 만든 row만 대상 (v15)
  // - [자동학습-...] : 학습앱이 폴더 동기화로 만든 row
  // - [파일: xxx.pdf/png/jpg/jpeg] : 학습앱이 만든 메타 row
  // 그 외 (docx, 외부학습 v12, 채팅학습 등)는 원본 재학습 불가능하므로 제외
  const isLearningAppRow =
    /^\[자동학습-/i.test(content) ||
    /^\[파일:\s*[^\]]+\.(?:pdf|png|jpg|jpeg)\s*\]/i.test(content);
  if (!isLearningAppRow) return false;

  // 신호 1: v10 이전 프롬프트 표지 (가장 신뢰)
  const hasOldPromptMarker = /\[시각 설명\]|## \[시각 설명\]/.test(content);
  if (hasOldPromptMarker) return true;

  // 신호 2: 짧음
  if (content.length < 500) return true;

  // 신호 3: 정보 밀도 매우 낮음 — 페이지 3개 이상 + 페이지당 평균 < 100자
  const pageMatches = content.match(/━━ 페이지 \d+ ━━|# PDF 페이지 분석 \(\d+\/\d+\)/g);
  if (pageMatches && pageMatches.length >= 3) {
    const avgPerPage = content.length / pageMatches.length;
    if (avgPerPage < 100) return true;
  }

  // 신호 4 (v14 신규): 메타 row인데 URL 다수 + 본문 적음 → 빈약 메타 row
  // 페이지 URL이 5개 이상인데 분량이 작으면 본문이 비어 있다는 뜻
  const urlMatches = (content.match(/\[페이지\d+URL\]/g) || []).length;
  if (urlMatches >= 5) {
    // URL이 차지하는 글자 수 추정 (페이지당 약 100자: "[페이지N URL] https://...")
    const estimatedUrlChars = urlMatches * 100;
    const bodyChars = content.length - estimatedUrlChars;
    if (bodyChars < 200) return true; // 본문 200자 미만이면 빈약
  }

  return false;
}

// ─── 일관성 자동 점검 (Step 7-4) ────────────────────────────────────────────
// 신규 항목 1개를 기존 knowledge와 비교해 중복/충돌을 찾음.
// - 같은 카테고리 + 다른 카테고리 모두 검사 (교차 검사)
// - 비교 대상은 최근 50건으로 제한 (토큰 절약)
// - 발견된 충돌 배열 반환 (없으면 빈 배열)
async function checkConsistencyForItem(newItem, existingKnowledge) {
  if (!newItem || !newItem.content || existingKnowledge.length === 0) return [];

  // 같은 출처(prefix) 청크끼리는 비교 대상에서 제외
  // - 청크 분할 시 (1/3), (2/3), (3/3) 형태로 같은 원본에서 나옴 → 충돌로 잘못 잡힘 방지
  // - prefix 추출 패턴: "[xxx] (N/M)" 또는 "[xxx]"의 첫 대괄호
  const extractSourcePrefix = (content) => {
    if (!content) return null;
    const m = content.match(/^(\[[^\]]+\])/);
    return m ? m[1] : null;
  };
  const newPrefix = extractSourcePrefix(newItem.content);

  // 비교 대상 추출 (자기 자신 제외, 같은 출처 prefix 제외, 최근 50건)
  const candidates = existingKnowledge
    .filter(k => {
      if (!k.content || k.content === newItem.content) return false;
      if (newPrefix) {
        const candPrefix = extractSourcePrefix(k.content);
        if (candPrefix === newPrefix) return false; // 같은 출처 → 제외
      }
      return true;
    })
    .slice(-50);
  if (candidates.length === 0) return [];

  const candidatesText = candidates
    .map((it, i) => `${i + 1}. [${it.category}] ${it.content}`)
    .join("\n");

  const sys = `당신은 학습 데이터 일관성 검증자입니다. 새로 추가된 항목이 기존 항목들과 중복되거나 충돌하는지 검사하세요.

[새 항목]
[${newItem.category}] ${newItem.content}

[기존 항목들]
${candidatesText}

[판단 기준]
- duplicate: 같은 의미를 다른 표현으로 작성한 경우
- conflict: 같은 주제이지만 수치/절차/기준이 다른 경우
- 카테고리가 달라도 내용이 모순되면 충돌로 판단

JSON으로만 답하세요. 발견 없으면 빈 배열.

응답 형식:
{"matches":[{"existing":3,"type":"duplicate|conflict","reason":"한 줄 사유"}]}`;

  try {
    const raw = await callClaude(sys, "검사 결과를 JSON으로 답하세요.");
    const parsed = safeJSON(raw);
    if (!parsed.matches || !Array.isArray(parsed.matches)) return [];

    const findings = [];
    for (const m of parsed.matches) {
      const idx = m.existing - 1;
      if (idx < 0 || idx >= candidates.length) continue;
      findings.push({
        category: newItem.category,
        itemA: { category: newItem.category, content: newItem.content, updated_at: newItem.updated_at },
        itemB: candidates[idx],
        type: m.type === "duplicate" ? "duplicate" : "conflict",
        reason: m.reason || "",
        detectedAt: new Date().toISOString(),
        resolved: false,
      });
    }
    return findings;
  } catch (e) {
    console.warn("[checkConsistency] 검사 실패:", e.message);
    return [];
  }
}

// ─── 학습 수준 계산 ───────────────────────────────────────────────────────────
function calcProgress(knowledge) {
  const categories = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];
  const result = {};
  let total = 0;
  categories.forEach(cat => {
    const items = knowledge.filter(k => k.category === cat);
    const score = cat === "교정사례"
      ? Math.min(100, items.length * 10)
      : items.length > 0 ? Math.min(100, items[0]?.content?.length / 2) : 0;
    result[cat] = Math.round(score);
    total += result[cat];
  });
  result["전체"] = Math.round(total / categories.length);
  return result;
}

// 대시보드 - 5개 지표를 0-100 점수로 정규화 (절대평가)
// 각 지표별 목표값(TARGET_VALUES) 대비 현재값의 비율, 100점 상한
function calcDashboardScore(agent) {
  const cap = (val, target) => Math.min(100, Math.round((val / target) * 100));

  const itemScore = cap(agent.itemCount || 0, TARGET_VALUES.itemCount);
  const contentScore = cap(agent.contentLength || 0, TARGET_VALUES.contentLength);
  const categoryScore = cap(agent.categoryCount || 0, TARGET_VALUES.categoryCount);
  const correctionScore = cap(agent.correctionCount || 0, TARGET_VALUES.correctionCount);
  const freshnessScore = cap(agent.recentRate || 0, TARGET_VALUES.recentRate);

  const totalScore = Math.round(
    (itemScore + contentScore + categoryScore + correctionScore + freshnessScore) / 5
  );
  return { itemScore, contentScore, categoryScore, correctionScore, freshnessScore, totalScore };
}

const SCORE_COLOR = (score) => {
  if (score >= 80) return "#34d399";
  if (score >= 60) return "#fbbf24";
  if (score >= 40) return "#f97316";
  return "#ef4444";
};

const SCORE_LABEL = (score) => {
  if (score >= 80) return "우수";
  if (score >= 60) return "양호";
  if (score >= 40) return "보통";
  return "부족";
};

// ─── 공통 컴포넌트 ────────────────────────────────────────────────────────────
function Spinner() {
  return <span style={{
    display:"inline-block", width:12, height:12,
    border:"2px solid rgba(255,255,255,0.2)",
    borderTop:"2px solid currentColor", borderRadius:"50%",
    animation:"spin 0.7s linear infinite",
  }}/>;
}

// ─── 중복/충돌 다이얼로그 (Step 3) ─────────────────────────────────────────────
// 신규 저장 시 기존 데이터와 충돌하는 경우 사용자에게 선택지 제공
function ConflictDialog({ role, category, newContent, conflict, onResolve, onCancel }) {
  const [editedContent, setEditedContent] = useState(newContent);
  const [editing, setEditing] = useState(false);
  const [processing, setProcessing] = useState(false);

  const handle = async (choice) => {
    setProcessing(true);
    try {
      if (choice === "keep_old") {
        // 기존 유지: 신규는 저장 안 함
        await onResolve("keep_old", null);
      } else if (choice === "replace") {
        // 신규로 교체: 기존 row를 신규 content로 교체
        await replaceKnowledge(role, category, conflict.conflictWith.content, newContent);
        await onResolve("replace", null);
      } else if (choice === "keep_both") {
        // 둘 다 저장: 신규를 그대로 추가
        await saveToSheet(role, category, newContent);
        await onResolve("keep_both", null);
      } else if (choice === "edit") {
        // 수정 후 저장: editedContent로 새로 저장
        if (!editedContent.trim()) {
          alert("내용을 입력해주세요");
          setProcessing(false);
          return;
        }
        await saveToSheet(role, category, editedContent);
        await onResolve("edit", editedContent);
      } else if (choice === "skip") {
        // 건너뛰기: 아무것도 저장 안 함
        await onResolve("skip", null);
      }
    } catch (e) {
      alert("처리 실패: " + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const typeLabel = conflict.type === "duplicate" ? "중복" : "충돌";
  const typeColor = conflict.type === "duplicate" ? "#a78bfa" : "#f59e0b";

  return (
    <div style={{
      position:"fixed", top:0, left:0, right:0, bottom:0,
      background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:1000, padding:"16px", animation:"fadeUp 0.2s ease both",
    }}>
      <div style={{
        background:"#0f172a", border:`1.5px solid ${typeColor}40`,
        borderRadius:14, padding:"20px", maxWidth:540, width:"100%",
        maxHeight:"90vh", overflowY:"auto",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <span style={{
            background:`${typeColor}20`, color:typeColor,
            padding:"3px 10px", borderRadius:5, fontSize:11, fontWeight:800,
          }}>⚠️ {typeLabel} 감지</span>
          <span style={{ fontSize:11, color:"#64748b" }}>{category}</span>
        </div>

        <div style={{ fontSize:12, color:"#94a3b8", marginBottom:14, lineHeight:1.6 }}>
          {conflict.reason || "기존 학습 내용과 중복되거나 충돌됩니다"}
        </div>

        {/* 기존 내용 */}
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:"#64748b", fontWeight:700, marginBottom:5 }}>📂 기존 내용</div>
          <div style={{
            background:"rgba(15,23,42,0.6)", border:"1px solid rgba(51,65,85,0.4)",
            borderRadius:7, padding:"10px 12px", fontSize:12, color:"#cbd5e1",
            lineHeight:1.6, whiteSpace:"pre-wrap",
          }}>{conflict.conflictWith.content}</div>
        </div>

        {/* 신규 내용 (수정 모드면 textarea, 아니면 표시) */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:10, color:"#64748b", fontWeight:700, marginBottom:5 }}>✨ 신규 내용</div>
          {editing ? (
            <textarea value={editedContent} onChange={e => setEditedContent(e.target.value)}
              rows={4} style={{
                width:"100%", background:"rgba(15,23,42,0.8)",
                border:`1.5px solid ${typeColor}50`, borderRadius:7,
                color:"#dde4f0", padding:"10px 12px", fontSize:12,
                outline:"none", resize:"vertical", lineHeight:1.6,
                boxSizing:"border-box", fontFamily:"inherit",
              }}/>
          ) : (
            <div style={{
              background:`${typeColor}08`, border:`1px solid ${typeColor}30`,
              borderRadius:7, padding:"10px 12px", fontSize:12, color:"#dde4f0",
              lineHeight:1.6, whiteSpace:"pre-wrap",
            }}>{editedContent}</div>
          )}
        </div>

        {/* 처리 버튼 5개 */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:6, marginBottom:6 }}>
          <button onClick={() => handle("keep_old")} disabled={processing} style={btnStyle("#94a3b8")}>
            📂 기존 유지
          </button>
          <button onClick={() => handle("replace")} disabled={processing} style={btnStyle("#34d399")}>
            ✨ 신규로 교체
          </button>
          <button onClick={() => handle("keep_both")} disabled={processing} style={btnStyle("#a78bfa")}>
            ➕ 둘 다 저장
          </button>
          {!editing ? (
            <button onClick={() => setEditing(true)} disabled={processing} style={btnStyle("#fbbf24")}>
              ✏️ 수정하기
            </button>
          ) : (
            <button onClick={() => handle("edit")} disabled={processing} style={btnStyle("#fbbf24")}>
              💾 수정 저장
            </button>
          )}
        </div>
        <button onClick={() => handle("skip")} disabled={processing} style={{
          ...btnStyle("#64748b"), width:"100%",
        }}>
          ⏭ 건너뛰기 (저장 안 함)
        </button>

        {processing && (
          <div style={{ marginTop:10, textAlign:"center", color:"#94a3b8", fontSize:11 }}>
            <Spinner/> 처리 중...
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(color) {
  return {
    padding:"9px 12px",
    background:`${color}15`,
    border:`1px solid ${color}40`,
    borderRadius:7, color: color,
    fontSize:12, fontWeight:700, cursor:"pointer",
  };
}

function smallBtnStyle(color) {
  return {
    padding:"6px 8px",
    background:`${color}15`,
    border:`1px solid ${color}40`,
    borderRadius:5, color: color,
    fontSize:11, fontWeight:700, cursor:"pointer",
  };
}

function ProgressBar({ label, value, color }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:11, color:"#94a3b8" }}>{label}</span>
        <span style={{ fontSize:11, color, fontWeight:800 }}>{value}%</span>
      </div>
      <div style={{ height:6, background:"rgba(51,65,85,0.5)", borderRadius:3 }}>
        <div style={{
          height:"100%", borderRadius:3,
          width:`${value}%`,
          background:`linear-gradient(90deg, ${color}, ${color}99)`,
          transition:"width 0.5s ease",
        }}/>
      </div>
    </div>
  );
}

function SaveBtn({ onClick, saving, saved }) {
  return (
    <button onClick={onClick} disabled={saving} style={{
      padding:"8px 16px",
      background: saved ? "rgba(52,211,153,0.2)" : "rgba(59,130,246,0.15)",
      border: `1px solid ${saved ? "rgba(52,211,153,0.4)" : "rgba(59,130,246,0.3)"}`,
      borderRadius:7, color: saved ? "#34d399" : "#93c5fd",
      fontSize:12, fontWeight:700, cursor:"pointer",
      display:"inline-flex", alignItems:"center", gap:6,
    }}>
      {saving ? <><Spinner/>저장 중...</> : saved ? "✅ 저장됨" : "💾 저장"}
    </button>
  );
}

// ─── STEP 1: 채팅 학습 ────────────────────────────────────────────────────────
function TabChat({ role, roleInfo }) {
  const [msgs, setMsgs] = useState([{
    role:"assistant",
    content:`안녕하세요! 저는 ${roleInfo.label}(${role}) AI입니다.\n\n학습 데이터를 불러오는 중...`,
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [summary, setSummary] = useState(null);  // 시트에서 로드한 요약본
  const [commonKnowledge, setCommonKnowledge] = useState([]);  // Common_Knowledge 시트 (모든 에이전트 공유)
  const [initialized, setInitialized] = useState(false);
  const [conflictQueue, setConflictQueue] = useState([]);
  const [currentConflict, setCurrentConflict] = useState(null);
  const bottomRef = useRef();
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      setCurrentConflict(conflictQueue[0]);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
  };

  // 시작 시 요약본 + 공통 학습 데이터 로드 + 첫 메시지 동적 생성
  useEffect(() => {
    if (initialized) return;
    (async () => {
      try {
        // 본인 요약과 공통 학습 데이터를 병렬 로드 (속도 최적화)
        const [summaryData, commonData] = await Promise.all([
          loadSummary(role),
          loadCommonKnowledge(),
        ]);
        setCommonKnowledge(commonData || []);

        if (summaryData && summaryData.content) {
          // 요약본 있음 → AI에게 부족 부분 질문 동적 생성 요청
          setSummary(summaryData.content);

          const sys = `당신은 ${roleInfo.label}(${role}) AI입니다. 아래는 지금까지 학습된 요약본입니다.

[학습 요약]
${summaryData.content}

이 학습 내용을 보고, 아직 부족하거나 추가 학습이 필요한 영역 1~2가지를 골라서
사용자에게 자연스럽게 질문하는 첫 인사말을 작성하세요.

규칙:
- "안녕하세요"로 시작
- "지난 학습을 이어가겠습니다" 같은 표현으로 친근감 표시
- 부족한 영역을 구체적으로 언급 (예: "아직 교정사례 학습이 적은데, 최근 사례가 있으면 알려주세요")
- 마지막에 안내문 추가: "(전체 학습 내용을 보고 싶으면 '요약'이라고 입력해 주세요)"
- 200자 이내, 한국어`;

          try {
            const reply = await callClaude(sys, "첫 인사말을 만들어주세요.");
            setMsgs([{ role:"assistant", content: reply }]);
          } catch {
            // AI 호출 실패 시 기본 메시지
            setMsgs([{
              role:"assistant",
              content:`안녕하세요! ${roleInfo.label}(${role}) AI입니다. 지난 학습을 이어가겠습니다.\n\n오늘은 어떤 부분을 더 알려주시겠어요?\n\n(전체 학습 내용을 보고 싶으면 '요약'이라고 입력해 주세요)`
            }]);
          }
        } else {
          // 요약본 없음 → 첫 학습 인사
          setMsgs([{
            role:"assistant",
            content:`안녕하세요! 저는 ${roleInfo.label}(${role}) AI입니다.\n\n지금부터 공장 상황과 업무 방식을 배워갈게요. 편하게 알려주세요.\n\n예를 들어:\n• 어떤 공장인지, 어떤 제품을 만드는지\n• 주요 공정 흐름\n• 평소 신경 쓰는 부분`
          }]);
        }
      } catch (e) {
        // 로드 실패 시 기본 메시지
        setMsgs([{
          role:"assistant",
          content:`안녕하세요! 저는 ${roleInfo.label}(${role}) AI입니다.\n\n지금부터 공장 상황과 업무 방식을 배워갈게요.`
        }]);
      } finally {
        setInitialized(true);
      }
    })();
  }, [role, roleInfo, initialized]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");

    // "요약" 입력 시 요약본 표시 (AI 호출 없음)
    if (msg === "요약" || msg === "요약보여줘" || msg === "요약 보여줘") {
      const newMsgs = [...msgs, { role:"user", content:msg }];
      if (summary) {
        setMsgs([...newMsgs, {
          role:"assistant",
          content:`📋 지금까지 학습된 내용입니다:\n\n${summary}\n\n추가로 알려주실 내용이 있으면 말씀해 주세요.`
        }]);
      } else {
        setMsgs([...newMsgs, {
          role:"assistant",
          content:"아직 저장된 요약이 없습니다. 학습 데이터가 5건 이상 누적되면 자동으로 요약이 생성됩니다."
        }]);
      }
      return;
    }

    const newMsgs = [...msgs, { role:"user", content:msg }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      // ─── 디테일 모드: 토큰 점수 기반 매칭 (Step 7-8) ───
      // 이전 v7: 카테고리 키워드 매칭 → 카테고리 칸막이로 인해 같은 주제도 표현에 따라
      //          다른 카테고리만 보고 답을 못 함 (예: "Ceramic Bushing 적용된 라인"이
      //          "라인" 키워드 때문에 공장정보만 매칭되어 교정사례 데이터를 못 봄).
      // v8: 카테고리 무관, 질문의 단어가 학습 항목 content에 얼마나 매칭되는지
      //     점수로 정렬하여 우선 포함. 매칭 없으면 최근 N건 추가.

      const trimmed = msg.trim();
      const wordCount = trimmed.split(/\s+/).length;

      // 명백한 잡담/짧은 응답 패턴 (디테일 모드 OFF — 학습 데이터 로드 안 함)
      const chitchatPatterns = [
        /^(안녕|하이|hi|hello|반가|감사|고마워|고맙|땡큐|thanks?)/i,
        /^(응|네|예|ㅇㅇ|ㄴㄴ|아니|noo*|yes|ok|okay|오케이)$/i,
        /^(잘\s*있|좋아|좋네|괜찮|굿|good|great|nice)/,
        /^(ㅋ+|ㅎ+|ㅠ+|ㅜ+|ㅡㅡ)$/,
      ];
      const isChitchat = wordCount <= 2 && chitchatPatterns.some(re => re.test(trimmed));
      const isDetailMode = !isChitchat;

      // 질문에서 의미 토큰 추출
      // - 한글 2글자 이상 어절 + 영문/숫자 2글자 이상 단어
      // - 흔한 조사·접속사·의문어 제외 (의미 단어만 남김)
      const STOPWORDS = new Set([
        "있는","있어","있음","있나","없는","없어","없음","하는","하고","하면","합니다",
        "하나요","뭐야","뭐였","뭐지","무엇","어떻","어디","언제","누구","얼마","얼마나",
        "그리고","그러나","하지만","따라서","그래서","또는","그것","그거","이것","저것",
        "거기","여기","저기","우리","나는","나의","내가","당신","구체","정확","상세",
        "자세히","알려","알려줘","말해","말해줘","적용","적용된","대해","대한","위한",
        "그게","그건","그건가","해줘","해주세요","주세요","해야","해야하","입니다","이야",
        "이에요","에서","에게","에서는","에는","으로","에서의",
      ]);
      const extractTokens = (text) => {
        const tokens = [];
        // 한글 어절
        const koreanWords = text.match(/[가-힣]{2,}/g) || [];
        koreanWords.forEach(w => {
          // 조사 제거 시도 (마지막 1글자가 조사이면 제거)
          const stripped = w.replace(/(은|는|이|가|을|를|에|의|와|과|도|만|랑|로|으로|에서|에게|한테|부터|까지|보다|처럼|같이|마저|밖에|이라|라는|이라는|이라서|라서)$/, "");
          const final = stripped.length >= 2 ? stripped : w;
          if (!STOPWORDS.has(final)) tokens.push(final);
        });
        // 영문/숫자
        const enWords = text.match(/[A-Za-z0-9][A-Za-z0-9\-_]{1,}/g) || [];
        enWords.forEach(w => tokens.push(w));
        return [...new Set(tokens)]; // 중복 제거
      };

      let detailContext = "";
      let usedScoring = false;
      let topMatchCount = 0;

      if (isDetailMode) {
        const allKnowledge = await loadFromSheet(role);
        const filtered = allKnowledge.filter(k => k.category !== "_요약" && k.content);

        if (filtered.length > 0) {
          const tokens = extractTokens(trimmed);

          // 각 항목 점수 계산 (Step 7-9 보완):
          //   - 출현 횟수 cap (3회): 한 항목 안에서 같은 토큰이 N번 반복돼도 가중 안 함
          //     → 자동학습 PDF 메타처럼 단어 반복이 많은 항목이 부당하게 점수 폭증하는 것 방지
          //   - 자동학습 PDF 메타 항목 페널티 (×0.4): 파일명/페이지 URL뿐인 메타 항목은
          //     실제 정보 항목보다 후순위로 밀어냄
          const scored = filtered.map(k => {
            const content = (k.content || "").toLowerCase();
            let score = 0;
            let matchedTokens = 0;
            for (const tok of tokens) {
              const lowerTok = tok.toLowerCase();
              if (!lowerTok) continue;
              // 출현 횟수 카운트
              let count = 0;
              let idx = 0;
              while ((idx = content.indexOf(lowerTok, idx)) !== -1) {
                count++;
                idx += lowerTok.length;
              }
              if (count > 0) {
                matchedTokens++;
                // 출현 횟수 cap → 3회 초과는 점수 안 늘림 (다회 등장 가중 폭증 차단)
                const cappedCount = Math.min(count, 3);
                score += tok.length * Math.log(1 + cappedCount);
              }
            }
            // 매칭 토큰 다양성 가중치
            score += matchedTokens * 2;

            // 자동학습 PDF 메타 항목 페널티
            // 패턴: "[파일: xxx.pdf] [PDF: xxx.pdf - 그림 분석, N페이지]" 또는 페이지 URL만 다수
            const rawContent = k.content || "";
            const isAutoMeta = /^\[파일:\s*[^\]]+\.(pdf|png|jpg|jpeg)\]\s*\[(PDF|이미지)/i.test(rawContent);
            if (isAutoMeta) {
              score *= 0.4;
            }

            return { item: k, score, matchedTokens };
          });

          // 점수 0보다 큰 것만 우선, 점수 내림차순 정렬
          const matched = scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score);
          topMatchCount = matched.length;
          usedScoring = matched.length > 0;

          // 우선순위 항목 (점수 매칭) → 6000자 cap까지 채우기 (Step 7-10C)
          // - 한 항목이 너무 크면 다른 매칭 항목이 못 들어감 → 항목당 3000자 cap
          // - 청크 분할(7-10A)로 대부분 안 걸리지만, 외부에서 들어온 큰 항목 안전망
          const selected = [];
          let usedChars = 0;
          const HARD_CAP = 6000;
          const ITEM_CAP = 3000;
          const truncateForContext = (text) => {
            if (text.length <= ITEM_CAP) return text;
            return text.slice(0, ITEM_CAP) + ` ... [잘림: 전체 ${text.length}자 중 앞 ${ITEM_CAP}자]`;
          };
          for (const s of matched) {
            const truncatedContent = truncateForContext(s.item.content || "");
            const formatted = `[${s.item.category}] ${truncatedContent}`;
            if (usedChars + formatted.length > HARD_CAP) break;
            selected.push(formatted);
            usedChars += formatted.length + 1; // \n 포함
          }

          // 남는 공간 → 매칭 안 된 최근 항목으로 컨텍스트 보완
          if (usedChars < HARD_CAP * 0.6) {
            const unmatchedRecent = scored
              .filter(s => s.score === 0)
              .slice(-15)
              .reverse();
            for (const s of unmatchedRecent) {
              const truncatedContent = truncateForContext(s.item.content || "");
              const formatted = `[${s.item.category}] ${truncatedContent}`;
              if (usedChars + formatted.length > HARD_CAP) break;
              selected.push(formatted);
              usedChars += formatted.length + 1;
            }
          }

          if (selected.length > 0) {
            const header = usedScoring
              ? `[참고 - 원본 학습 데이터 (질문 관련 ${matched.length}건 중 상위 ${selected.length}건)]`
              : `[참고 - 원본 학습 데이터 (최근 ${selected.length}건)]`;
            detailContext = `\n\n${header}\n${selected.join("\n")}\n\n위 원본 데이터에서 정확한 정보를 찾아 답변하세요. 학습된 내용에 관한 질문이면 반드시 위 데이터를 근거로 답하고, 데이터에 없는 정보만 모른다고 답하세요. 데이터에 라인·수치·날짜 같은 구체 정보가 있으면 빠뜨리지 말고 답에 포함하세요. 항목 끝에 "[잘림: ...]" 표시가 있으면 그 항목엔 더 많은 정보가 있다는 의미입니다 — 사용자가 그 부분을 묻거나 "더 알려줘"라고 하면 "이 항목은 일부만 표시되었습니다. '(2/3) 또는 (3/3)' 같은 후속 청크가 있는지 보관함에서 확인해주세요"라고 안내하거나, 잘린 부분과 관련된 구체적 후속 질문을 안내하세요.`;
          }
        }
      }

      const summaryContext = summary
        ? `\n\n[기존 학습 요약]\n${summary}\n\n위 내용을 이미 알고 있다는 전제로 답변하세요. 같은 질문을 반복하지 마세요.`
        : "";

      // 공통 학습 데이터 컨텍스트 (모든 에이전트 공유 - 회사 규정/공통 지침)
      // 디테일 모드일 때는 detailContext가 크므로 commonContext는 줄여서 토큰 절약
      const commonLimit = isDetailMode ? 2000 : 4000;
      const commonContext = (commonKnowledge && commonKnowledge.length > 0)
        ? `\n\n[공통 회사 규정/지침 - 모든 에이전트 공유]\n${
            commonKnowledge
              .map(c => `[${c.category}] ${c.content}`)
              .join("\n")
              .slice(0, commonLimit)
          }\n\n위 공통 규정/지침은 ${roleInfo.label} 업무 답변의 기본 전제입니다. 본인 업무 답변이 위 규정과 충돌하지 않도록 답변하세요.`
        : "";

      // 답변 길이 정책: 사실 조회면 300자, 일반 대화면 150자
      // 사실 조회 추정: 토큰 매칭이 다수 발생했고 잡담이 아닐 때
      const isFactualQuery = usedScoring && topMatchCount >= 2;
      const lengthGuide = isFactualQuery
        ? "300자 이내로 답하되, 학습된 사실(라인·수치·날짜·부품명 등)은 빠뜨리지 말고 모두 포함하세요. 사용자에게 되묻기보다 데이터에서 찾아 답하는 것을 우선하세요."
        : "150자 이내로 간결하게 한국어로 답하세요.";

      const system = `당신은 ${roleInfo.label} AI로 훈련 중입니다.
사용자가 공장 상황과 ${role} 업무를 알려주면 자연스럽게 대화하며 더 깊이 파악하세요.
모르는 부분은 추가 질문하고, 중요한 내용은 확인하세요.
수율/KPI 수치보다 실제 업무 흐름, 협업 방식, 현장 문제에 집중하세요.
${lengthGuide}${summaryContext}${commonContext}${detailContext}`;
      const reply = await callClaude(system, msg);
      setMsgs(m => [...m, { role:"assistant", content:reply }]);
    } catch {
      setMsgs(m => [...m, { role:"assistant", content:"⚠️ 오류 발생. 다시 시도해주세요." }]);
    } finally { setLoading(false); }
  };

  // 요약본 재생성 (백그라운드)
  const regenerateSummary = async () => {
    try {
      const knowledge = await loadFromSheet(role);
      // _요약은 제외하고 일반 학습 데이터만
      const filtered = knowledge.filter(k => k.category !== "_요약");
      if (filtered.length === 0) return;

      const dataText = filtered.map(k => `[${k.category}] ${k.content}`).join("\n");

      const sys = `당신은 학습 데이터 정리자입니다. ${roleInfo.label}(${role})의 학습 내용을 카테고리별로 구조화해 요약하세요.

[학습 데이터]
${dataText.slice(0, 8000)}

다음 형식으로 한국어 요약 작성:
[공장정보] (한 줄 요약)
[업무역할] (한 줄 요약)
[판단기준] (한 줄 요약, 핵심 기준 1~3가지)
[협업방식] (한 줄 요약)
[교정사례] (한 줄 요약, 없으면 "없음")
[미흡 영역] (학습이 부족해 보이는 영역 1~2가지)

각 항목 한 줄씩, 전체 500자 이내.`;

      const summaryText = await callClaude(sys, "요약을 작성하세요.");
      await saveSummaryToSheet(role, summaryText);
      setSummary(summaryText); // 로컬 state도 갱신
    } catch (e) {
      console.error("요약 재생성 실패:", e);
    }
  };

  const saveChat = async () => {
    setSaving(true);
    let stage = "준비"; // 어느 단계에서 실패했는지 추적

    try {
      // ─── 0단계: 메시지가 충분한지 확인 ───
      stage = "사전 검증";
      const userMsgs = msgs.filter(m => m.role === "user");
      if (userMsgs.length < 2) {
        alert("저장할 만큼 대화가 충분하지 않습니다. (사용자 메시지 2개 이상 필요)");
        return;
      }

      // ─── 1단계: AI에 정보 추출 요청 ───
      stage = "AI 정보 추출";
      const conv = msgs.map(m => `${m.role === "user" ? "사용자" : "AI"}: ${m.content}`).join("\n");

      // 시스템 프롬프트 강화: JSON만, 정보 없으면 빈 문자열
      const system = `대화에서 ${roleInfo.label} 업무 정보를 추출해 JSON으로만 답하세요. 다른 설명 없이 JSON만.

추출 규칙:
- 각 카테고리에 해당 정보가 있으면 한 줄로 요약
- 정보가 없거나 불충분하면 빈 문자열 ""
- 절대 일반 텍스트로 답하지 말 것

응답 형식 (정확히 이 키 사용):
{"공장정보":"","업무역할":"","협업방식":""}`;

      let raw;
      try {
        raw = await callClaude(system, conv);
      } catch (apiErr) {
        throw new Error(`AI 호출 실패: ${apiErr.message || "네트워크 오류"}`);
      }

      // ─── 2단계: JSON 파싱 ───
      stage = "JSON 파싱";
      let parsed;
      try {
        parsed = safeJSON(raw);
      } catch (parseErr) {
        // raw 응답을 콘솔에 남겨서 사후 분석 가능하게
        console.error("[saveChat] JSON 파싱 실패. AI 응답 원문:", raw);
        throw new Error(`AI가 추출 가능한 정보를 인식하지 못했습니다. ${parseErr.message}`);
      }

      // ─── 3단계: 비어있지 않은 항목만 추리기 ───
      stage = "유효 항목 검증";
      const validEntries = Object.entries(parsed)
        .filter(([cat, content]) => content && typeof content === "string" && content.trim().length > 0);

      if (validEntries.length === 0) {
        alert("대화에서 추출할 만한 업무 정보가 없습니다. 더 구체적으로 대화해 주세요.");
        return;
      }

      // ─── 4단계: 카테고리별 저장 (각 항목 독립 try/catch — 부분 성공 허용) ───
      stage = "시트 저장";
      const conflicts = [];
      const savedCats = [];
      const failedCats = [];

      for (const [cat, content] of validEntries) {
        try {
          const conflict = await checkConflict(role, cat, content);
          if (conflict) {
            conflicts.push({ category: cat, content, conflict });
          } else {
            await saveToSheet(role, cat, content);
            savedCats.push(cat);
          }
        } catch (itemErr) {
          console.error(`[saveChat] '${cat}' 저장 실패:`, itemErr);
          failedCats.push({ cat, msg: itemErr.message || "알 수 없는 오류" });
        }
      }

      // ─── 5단계: 충돌 큐 + 결과 메시지 ───
      if (conflicts.length > 0) {
        setConflictQueue(conflicts);
      }

      // 결과별 사용자 알림
      if (savedCats.length > 0 && failedCats.length === 0 && conflicts.length === 0) {
        // 전체 성공 — 토스트만
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else if (savedCats.length > 0 && (failedCats.length > 0 || conflicts.length > 0)) {
        // 부분 성공
        const parts = [`${savedCats.length}개 저장됨 (${savedCats.join(", ")})`];
        if (conflicts.length > 0) parts.push(`${conflicts.length}개 충돌 검토 필요`);
        if (failedCats.length > 0) parts.push(`${failedCats.length}개 실패: ${failedCats.map(f => f.cat).join(", ")}`);
        alert(parts.join("\n"));
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else if (savedCats.length === 0 && conflicts.length > 0) {
        // 모두 충돌만 — 충돌 모달이 알아서 뜨므로 별도 알림 X
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        // 전부 실패
        const detail = failedCats.map(f => `· ${f.cat}: ${f.msg}`).join("\n");
        alert(`저장 실패\n\n${detail}`);
        return;
      }

      // ─── 6단계: 백그라운드 요약 재생성 ───
      stage = "요약 재생성";
      try {
        const countData = await loadSummaryCount(role);
        if (countData && countData.count >= 5) {
          regenerateSummary(); // await 안 함 (백그라운드)
        }
      } catch (summaryErr) {
        // 요약 재생성 실패는 저장 자체엔 영향 없음 — 콘솔에만
        console.warn("[saveChat] 요약 재생성 실패 (저장은 정상):", summaryErr);
      }

    } catch (e) {
      // 진짜 에러 메시지를 콘솔과 사용자 모두에게 노출
      console.error(`[saveChat] '${stage}' 단계에서 실패:`, e);
      alert(`저장 실패 (${stage} 단계)\n\n${e.message || "알 수 없는 오류"}\n\n다시 시도하거나 콘솔(F12)을 확인해 주세요.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>💬 공장 & 업무 대화로 학습</div>
          {commonKnowledge.length > 0 && (
            <span title="모든 에이전트가 공유하는 회사 규정/지침이 채팅 컨텍스트에 자동 주입됩니다" style={{
              background:"rgba(212,175,55,0.12)",
              border:"1px solid rgba(212,175,55,0.35)",
              borderRadius:10,
              padding:"2px 8px",
              fontSize:10.5,
              fontWeight:700,
              color:"#d4af37",
              cursor:"help",
            }}>📚 공통 {commonKnowledge.length}건 적용 중</span>
          )}
        </div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          공장/제품/공정/업무 방식을 자유롭게 알려주세요
        </div>
      </div>

      {/* 가이드 버튼 */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
        {summary && (
          <button onClick={() => setInput("요약")} style={{
            background:"rgba(167,139,250,0.1)", border:"1px solid rgba(167,139,250,0.3)",
            borderRadius:14, padding:"4px 11px", color:"#a78bfa", fontSize:11, cursor:"pointer", fontWeight:700,
          }}>📋 요약 보기</button>
        )}
        {["어떤 공장인지 알려줄게요", "주요 공정 흐름은요", "하루 일과가 어때요", "자주 생기는 문제는"].map((q,i) => (
          <button key={i} onClick={() => setInput(q)} style={{
            background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.2)",
            borderRadius:14, padding:"4px 11px", color:"#93c5fd", fontSize:11, cursor:"pointer",
          }}>{q}</button>
        ))}
      </div>

      {/* 채팅창 */}
      <div style={{
        background:"rgba(4,8,15,0.7)", border:"1px solid rgba(59,130,246,0.15)",
        borderRadius:12, padding:14, height:320, overflowY:"auto", marginBottom:10,
      }}>
        {msgs.map((m,i) => (
          <div key={i} style={{
            display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start",
            marginBottom:10, animation:"fadeUp 0.2s ease both",
          }}>
            {m.role==="assistant" && (
              <div style={{
                width:26, height:26, borderRadius:"50%",
                background:roleInfo.bg, border:`1.5px solid ${roleInfo.color}44`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:12, marginRight:7, flexShrink:0, marginTop:2,
              }}>{roleInfo.icon}</div>
            )}
            <div style={{
              maxWidth:"80%",
              background:m.role==="user"?"rgba(59,130,246,0.12)":"rgba(20,30,50,0.9)",
              border:`1px solid ${m.role==="user"?"rgba(59,130,246,0.25)":"rgba(51,65,85,0.35)"}`,
              borderRadius:m.role==="user"?"12px 3px 12px 12px":"3px 12px 12px 12px",
              padding:"8px 12px", fontSize:12.5, color:"#dde4f0",
              lineHeight:1.7, whiteSpace:"pre-wrap",
            }}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <div style={{ width:26, height:26, borderRadius:"50%", background:roleInfo.bg,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>
              {roleInfo.icon}
            </div>
            <span style={{ fontSize:12, color:"#475569", animation:"pulse 1s infinite" }}>생각 중...</span>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <input value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&send()}
          placeholder="자유롭게 입력하세요 (Enter 전송)"
          style={{
            flex:1, background:"rgba(8,14,26,0.9)",
            border:"1.5px solid rgba(59,130,246,0.25)", borderRadius:8,
            color:"#e2e8f0", padding:"9px 13px", fontSize:13, outline:"none",
          }}
        />
        <button onClick={send} disabled={!input.trim()||loading} style={{
          padding:"9px 16px",
          background:input.trim()&&!loading?"linear-gradient(135deg,#3b82f6,#22d3ee)":"rgba(51,65,85,0.3)",
          border:"none", borderRadius:8, color:"#fff", fontSize:13, fontWeight:700,
          cursor:input.trim()&&!loading?"pointer":"not-allowed",
        }}>전송</button>
      </div>

      <SaveBtn onClick={saveChat} saving={saving} saved={saved}/>

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 2: 업무 규칙 ────────────────────────────────────────────────────────
const RULE_FIELDS = {
  Cell_PE: [
    { key:"판단기준", label:"Cell 공정 이상 발생 시 대응 순서", placeholder:"예: 이상 감지 → 현장 확인 → 조장 보고 → 원인 파악 → ME/TE 협의" },
    { key:"협업방식", label:"Cell ME·TE팀과 협업 방식", placeholder:"예: 설비 고장은 ME에게 즉시 연락, 공정 개선은 TE와 주 1회 협의" },
    { key:"판단기준", label:"생산 vs 품질 vs 안전 우선순위", placeholder:"예: 안전 최우선, 불량 발생 시 라인 정지 가능, 불량 출하 금지" },
    { key:"판단기준", label:"보고 & 에스컬레이션 기준", placeholder:"예: 다운타임 30분 초과 시 팀장 보고, 불량 배치 시 품질팀 즉시 통보" },
  ],
  Cell_ME: [
    { key:"판단기준", label:"Cell 설비 고장 시 대응 순서", placeholder:"예: 알람 확인 → 현장 점검 → 원인 파악 → 부품 교체 → 테스트 런" },
    { key:"협업방식", label:"Cell PE·TE팀과 협업 방식", placeholder:"예: 생산 영향 큰 고장은 PE에게 즉시 보고, 공정 조건 변경은 TE와 협의" },
    { key:"판단기준", label:"PM(예방보전) 기준", placeholder:"예: MTBF 기반 PM 주기, 소모품 교체 기준, 예방보전 우선순위" },
    { key:"판단기준", label:"라인 정지 vs 임시 조치 판단 기준", placeholder:"예: 즉시 정지 조건, 임시 조치 후 운영 가능 조건" },
  ],
  Cell_TE: [
    { key:"판단기준", label:"Cell 공정 조건 변경 기준", placeholder:"예: 불량률 기준 초과 시 조건 검토, 변경 전 ME/PE 협의 필수" },
    { key:"협업방식", label:"Cell PE·ME팀과 협업 방식", placeholder:"예: 품질 이슈는 PE와 즉시 공유, 설비 조건은 ME와 협의 후 변경" },
    { key:"판단기준", label:"불량 원인 분석 방법", placeholder:"예: 4M 분석(Man/Machine/Material/Method), 재현 테스트, 데이터 분석" },
    { key:"판단기준", label:"재발 방지 기준", placeholder:"예: 동일 불량 2회 이상 시 근본 원인 분석서 작성, 개선 검증 기간 설정" },
  ],
  Elec_PE: [
    { key:"판단기준", label:"Elec 공정 이상 발생 시 대응 순서", placeholder:"예: 이상 감지 → 현장 확인 → 조장 보고 → 원인 파악 → ME/TE 협의" },
    { key:"협업방식", label:"Elec ME·TE팀과 협업 방식", placeholder:"예: 설비 고장은 ME에게 즉시 연락, 공정 개선은 TE와 주 1회 협의" },
    { key:"판단기준", label:"생산 vs 품질 vs 안전 우선순위", placeholder:"예: 안전 최우선, 불량 발생 시 라인 정지 가능, 불량 출하 금지" },
    { key:"판단기준", label:"보고 & 에스컬레이션 기준", placeholder:"예: 다운타임 30분 초과 시 팀장 보고, 불량 배치 시 품질팀 즉시 통보" },
  ],
  Elec_ME: [
    { key:"판단기준", label:"Elec 설비 고장 시 대응 순서", placeholder:"예: 알람 확인 → 현장 점검 → 원인 파악 → 부품 교체 → 테스트 런" },
    { key:"협업방식", label:"Elec PE·TE팀과 협업 방식", placeholder:"예: 생산 영향 큰 고장은 PE에게 즉시 보고, 공정 조건 변경은 TE와 협의" },
    { key:"판단기준", label:"PM(예방보전) 기준", placeholder:"예: MTBF 기반 PM 주기, 소모품 교체 기준, 예방보전 우선순위" },
    { key:"판단기준", label:"라인 정지 vs 임시 조치 판단 기준", placeholder:"예: 즉시 정지 조건, 임시 조치 후 운영 가능 조건" },
  ],
  Elec_TE: [
    { key:"판단기준", label:"Elec 공정 조건 변경 기준", placeholder:"예: 불량률 기준 초과 시 조건 검토, 변경 전 ME/PE 협의 필수" },
    { key:"협업방식", label:"Elec PE·ME팀과 협업 방식", placeholder:"예: 품질 이슈는 PE와 즉시 공유, 설비 조건은 ME와 협의 후 변경" },
    { key:"판단기준", label:"불량 원인 분석 방법", placeholder:"예: 4M 분석(Man/Machine/Material/Method), 재현 테스트, 데이터 분석" },
    { key:"판단기준", label:"재발 방지 기준", placeholder:"예: 동일 불량 2회 이상 시 근본 원인 분석서 작성, 개선 검증 기간 설정" },
  ],
  FA: [
    { key:"판단기준", label:"반송 설비(C/V·Stocker·OHT·AGV) 이상 시 대응 순서", placeholder:"예: 알람 확인 → 영향 라인 파악 → 우회 경로 확보 → 정비 → 재가동" },
    { key:"협업방식", label:"PE·ME·TE팀과 협업 방식", placeholder:"예: 라인 정지 영향 시 PE 즉시 공유, 본 라인 설비와 정비 일정은 ME와 협의, 반송 중 품질 영향 시 TE와 협업" },
    { key:"판단기준", label:"WIP(공정 중 재공) 관리 기준", placeholder:"예: Stocker 처리 한계, 공정별 WIP 적정 수준, 누적 시 라인 속도 조정 기준" },
    { key:"판단기준", label:"반송 이슈 vs 공정 이슈 구분 기준", placeholder:"예: 잼/충돌/통신두절은 반송 측, 대기시간 영향은 공정 변수 함께 검토" },
  ],
  Vision: [
    { key:"판단기준", label:"외관 검사 기준 및 불량 분류", placeholder:"예: 불량 등급 기준(Critical/Major/Minor), 자동 검출 기준, 수동 검사 트리거" },
    { key:"협업방식", label:"PE·TE팀과 협업 방식", placeholder:"예: 새 불량 유형 발생 시 TE와 즉시 협의, 알고리즘 변경 시 PE 승인" },
    { key:"판단기준", label:"비전 시스템 이상 대응", placeholder:"예: 검출율 급감 시 조치 기준, 카메라·조명 점검 주기, 재교정 기준" },
    { key:"판단기준", label:"불량 이미지 분석 방법", placeholder:"예: 이미지 패턴 분류 기준, 오검출·미검출 구분, 데이터 축적 및 개선 방법" },
  ],
  Cell_PLC: [
    { key:"판단기준", label:"Cell PLC 알람 발생 시 대응 순서", placeholder:"예: 알람 확인 → 시퀀스 분석 → I/O 점검 → 코드 수정 → 테스트" },
    { key:"협업방식", label:"Cell PE·ME·TE팀과 협업 방식", placeholder:"예: 알람은 ME와 공유, 시퀀스 변경은 PE 승인, 통신 이슈는 TE와 분석" },
    { key:"판단기준", label:"PLC 수정 vs 임시 우회 판단 기준", placeholder:"예: 안전 관련 변경은 즉시 정지 후 수정, 비안전은 우회 후 점검 시간에 수정" },
    { key:"판단기준", label:"백업·버전 관리 기준", placeholder:"예: 변경 전후 백업 필수, 변경 사유·날짜·담당자 기록, 주간 정기 백업" },
  ],
  Elec_PLC: [
    { key:"판단기준", label:"Elec PLC 알람 발생 시 대응 순서", placeholder:"예: 알람 확인 → 시퀀스 분석 → I/O 점검 → 코드 수정 → 테스트" },
    { key:"협업방식", label:"Elec PE·ME·TE팀과 협업 방식", placeholder:"예: 알람은 ME와 공유, 시퀀스 변경은 PE 승인, 통신 이슈는 TE와 분석" },
    { key:"판단기준", label:"PLC 수정 vs 임시 우회 판단 기준", placeholder:"예: 안전 관련 변경은 즉시 정지 후 수정, 비안전은 우회 후 점검 시간에 수정" },
    { key:"판단기준", label:"백업·버전 관리 기준", placeholder:"예: 변경 전후 백업 필수, 변경 사유·날짜·담당자 기록, 주간 정기 백업" },
  ],
  FA_PLC: [
    { key:"판단기준", label:"FA(반송) PLC 알람 발생 시 대응 순서", placeholder:"예: 알람 확인 → 영향 라인 파악 → I/O·통신 점검 → 시퀀스 수정 → 재가동" },
    { key:"협업방식", label:"PE·ME·TE팀과 협업 방식", placeholder:"예: 라인 정지 영향 시 PE 즉시 공유, 본 라인 PLC와 인터페이스는 라인 PLC팀과 협의" },
    { key:"판단기준", label:"반송 시퀀스 수정 우선순위", placeholder:"예: WIP 흐름 영향 큰 시퀀스 우선, 안전 관련 즉시 수정" },
    { key:"판단기준", label:"백업·버전 관리 기준", placeholder:"예: 변경 전후 백업 필수, 영향 범위 사전 공유, 주간 정기 백업" },
  ],
};

function TabRules({ role, roleInfo }) {
  const fields = RULE_FIELDS[role] || RULE_FIELDS[Object.keys(RULE_FIELDS)[0]];
  const [values, setValues] = useState(Object.fromEntries(fields.map((_,i) => [i, ""])));
  const [loadingExisting, setLoadingExisting] = useState(true);  // 기존 입력 로드 중
  const [hasExisting, setHasExisting] = useState(false);  // 기존 입력 있었는지 (배지 표시용)
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [conflictQueue, setConflictQueue] = useState([]); // 충돌 대기 큐
  const [currentConflict, setCurrentConflict] = useState(null); // 현재 처리 중인 충돌

  // 시트에서 기존 입력 내용 로드 (영속성)
  // - 같은 필드 라벨로 저장된 항목 중 가장 최근(updated_at) 것을 textarea에 복원
  // - role이 바뀌면 다시 로드 (race condition 방지: cancelled 플래그)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingExisting(true);
      setHasExisting(false);
      // 역할 바뀐 직후 잔상 방지 — 일단 빈 칸으로 리셋
      setValues(Object.fromEntries(fields.map((_,i) => [i, ""])));
      try {
        const items = await loadFromSheet(role);
        if (cancelled) return;
        const restored = {};
        let foundAny = false;
        fields.forEach((field, i) => {
          const labelPrefix = `[${field.label}]`;
          const matched = (items || [])
            .filter(it => it.content && it.content.startsWith(labelPrefix))
            .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0];
          if (matched) {
            restored[i] = matched.content.slice(labelPrefix.length).trim();
            foundAny = true;
          }
        });
        if (foundAny) {
          setValues(v => ({ ...v, ...restored }));
          setHasExisting(true);
        }
      } catch (e) {
        console.error("[TabRules] 기존 입력 로드 실패:", e);
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [role]);

  // 큐에서 다음 충돌 꺼내기
  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      const next = conflictQueue[0];
      setCurrentConflict(next);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const save = async () => {
    setSaving(true);
    try {
      const conflicts = [];
      const safeItems = []; // 충돌 없는 항목

      // 1단계: 각 입력 항목별로 충돌 검사
      for (const [idx, content] of Object.entries(values)) {
        if (!content.trim()) continue;
        const field = fields[parseInt(idx)];
        const fullContent = `[${field.label}] ${content}`;
        const conflict = await checkConflict(role, field.key, fullContent);
        if (conflict) {
          conflicts.push({ category: field.key, content: fullContent, conflict });
        } else {
          safeItems.push({ category: field.key, content: fullContent });
        }
      }

      // 2단계: 충돌 없는 항목은 즉시 저장
      for (const item of safeItems) {
        await saveToSheet(role, item.category, item.content);
      }

      // 3단계: 충돌 항목들을 큐에 쌓아서 사용자에게 차례로 표시
      if (conflicts.length > 0) {
        setConflictQueue(conflicts);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("저장 실패"); }
    finally { setSaving(false); }
  };

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
    // useEffect가 다음 큐 항목을 자동으로 처리
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>📋 업무 규칙 & 판단 기준</div>
          {loadingExisting && (
            <span style={{
              background:"rgba(100,116,139,0.15)",
              border:"1px solid rgba(100,116,139,0.3)",
              borderRadius:10, padding:"2px 8px",
              fontSize:10.5, fontWeight:700, color:"#94a3b8",
            }}>기존 입력 불러오는 중…</span>
          )}
          {!loadingExisting && hasExisting && (
            <span title="시트에 저장된 기존 입력 내용을 자동 복원했습니다" style={{
              background:"rgba(34,197,94,0.12)",
              border:"1px solid rgba(34,197,94,0.35)",
              borderRadius:10, padding:"2px 8px",
              fontSize:10.5, fontWeight:700, color:"#4ade80",
              cursor:"help",
            }}>✅ 기존 입력 복원됨</span>
          )}
        </div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          {roleInfo.label}로서 실제로 따르는 행동 원칙을 입력하세요
        </div>
      </div>

      {fields.map((f, i) => (
        <div key={i} style={{
          background:"rgba(15,23,42,0.6)", border:`1px solid ${roleInfo.color}20`,
          borderRadius:10, padding:"14px 16px", marginBottom:12,
        }}>
          <div style={{ fontSize:11, color:roleInfo.color, fontWeight:800, marginBottom:8 }}>
            {f.label}
          </div>
          <textarea
            value={values[i] || ""}
            onChange={e => setValues(v => ({ ...v, [i]: e.target.value }))}
            placeholder={f.placeholder}
            rows={2}
            style={{
              width:"100%", background:"rgba(4,8,15,0.8)",
              border:"1.5px solid rgba(51,65,85,0.6)",
              borderRadius:7, color:"#dde4f0",
              padding:"9px 12px", fontSize:12.5, outline:"none",
              resize:"vertical", lineHeight:1.7,
              boxSizing:"border-box", fontFamily:"inherit",
            }}
          />
        </div>
      ))}

      <SaveBtn onClick={save} saving={saving} saved={saved}/>

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 3: 상황 교정 ────────────────────────────────────────────────────────
function TabCorrection({ role, roleInfo, knowledge }) {
  const [situation, setSituation] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [correction, setCorrection] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cases, setCases] = useState([]);
  const [conflictQueue, setConflictQueue] = useState([]);
  const [currentConflict, setCurrentConflict] = useState(null);

  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      setCurrentConflict(conflictQueue[0]);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
  };

  const SAMPLES = {
    Cell_PE: [
      "오전 10시, STK 라인 불량률이 갑자기 1.8%로 올랐다. 원인 불명. 라인은 현재 가동 중.",
      "야간 교대 중 CUT 설비가 멈췄고 ME는 부품 교체에 2시간 필요.",
      "기술팀에서 Cell 공정 조건 변경 요청. 변경 시 생산 속도 15% 감소 예상.",
    ],
    Cell_ME: [
      "STK-1-B3 설비에서 진공 오류 알람 발생. 생산은 계속 진행 중.",
      "동일 부품이 이번 주 3번째 교체됨. 근본 원인 파악이 필요한 상황.",
      "PM 일정이 생산 피크 기간과 겹침. PE에서 PM 연기 요청이 왔다.",
    ],
    Cell_TE: [
      "Cell 불량률이 0.3%에서 1.5%로 갑자기 상승. 공정 조건은 변경 없음.",
      "신규 원자재 로트 투입 후 불량 발생. 기존 로트와 혼용 중.",
      "PE에서 생산 속도 증가 요청. 현재 공정 조건에서 품질 리스크가 있음.",
    ],
    Elec_PE: [
      "오전 10시, Elec 라인 불량률이 갑자기 상승. 원인 불명. 라인은 현재 가동 중.",
      "야간 교대 중 전극 설비가 멈췄고 ME는 부품 교체에 2시간 필요.",
      "기술팀에서 Elec 공정 조건 변경 요청. 변경 시 생산 속도 감소 예상.",
    ],
    Elec_ME: [
      "Elec 설비에서 오류 알람 발생. 생산은 계속 진행 중.",
      "동일 부품이 이번 주 3번째 교체됨. Elec 라인 근본 원인 파악 필요.",
      "Elec PM 일정이 생산 피크 기간과 겹침. PE에서 PM 연기 요청.",
    ],
    Elec_TE: [
      "Elec 불량률이 갑자기 상승. 공정 조건은 변경 없음.",
      "신규 전극 원자재 로트 투입 후 불량 발생. 기존 로트와 혼용 중.",
      "PE에서 Elec 생산 속도 증가 요청. 현재 공정 조건에서 품질 리스크 있음.",
    ],
    FA: [
      "OHT 호기 충돌로 Cell 라인 반송 지연 발생. 라인 대기 시간 30분 누적 중.",
      "Stocker 처리 한계 도달로 공정 앞단 WIP 급증. 라인 속도 조정 검토 필요.",
      "AGV 통신 두절 빈발. MES 연동 문제인지 통신망 문제인지 구분 필요.",
    ],
    Vision: [
      "비전 검사기에서 불량 검출율이 갑자기 50% 이하로 떨어졌다.",
      "새로운 불량 유형이 발생했는데 현재 알고리즘이 검출하지 못하고 있다.",
      "조명 노후화로 의심되는 오검출이 증가하고 있다. 생산에 영향을 주고 있음.",
    ],
    Cell_PLC: [
      "Cell STK 라인 PLC에서 'Servo Fault' 알람 빈발. 시퀀스 점검이 필요함.",
      "ME에서 설비 수정 후 PLC 시퀀스도 조정 요청. 변경 영향 검토 필요.",
      "Cell PLC 통신 알람 간헐 발생. 네트워크 또는 PLC 측 문제 구분 필요.",
    ],
    Elec_PLC: [
      "Elec 설비 PLC에서 'Communication Error' 알람 발생. 생산 영향 미정.",
      "신규 Elec 설비 도입으로 PLC 인터페이스 통합 필요. 기존 시퀀스 영향 검토.",
      "Elec PLC 변경 이후 간헐 알람 발생. 변경 사항 롤백 검토 중.",
    ],
    FA_PLC: [
      "OHT 시퀀스 알람 빈발. 호기 간 동기화 문제 의심.",
      "Stocker PLC와 라인 PLC 간 통신 두절. 인터페이스 점검 필요.",
      "AGV 시퀀스 변경 후 일부 라인에서 진입 거부 알람 발생.",
    ],
  };

  const askAI = async () => {
    if (!situation.trim()) return;
    setLoading(true);
    setAiAnswer("");
    try {
      const knowledgeText = knowledge.map(k => `${k.category}: ${k.content}`).join("\n");
      const system = `당신은 아래 지식을 보유한 ${roleInfo.label}(${role}) AI입니다.
${knowledgeText || "기본 역할 정의만 있음"}
주어진 현장 상황에 대해 ${roleInfo.label}로서 즉각적인 판단과 행동 방침을 150자 이내로 답하세요.`;
      const reply = await callClaude(system, situation);
      setAiAnswer(reply);
    } catch { setAiAnswer("⚠️ 오류 발생"); }
    finally { setLoading(false); }
  };

  const saveCase = async () => {
    setSaving(true);
    try {
      const content = `상황: ${situation} | AI판단: ${aiAnswer} | 교정: ${correction || "정확함"}`;

      // 충돌 검사
      const conflict = await checkConflict(role, "교정사례", content);
      if (conflict) {
        setConflictQueue([{ category: "교정사례", content, conflict }]);
      } else {
        await saveToSheet(role, "교정사례", content);
      }

      setCases(c => [...c, { situation, aiAnswer, correction, date: new Date().toLocaleDateString("ko-KR") }]);
      setSituation(""); setAiAnswer(""); setCorrection("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("저장 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>🎯 상황 던지기 & 판단 교정</div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          실제 상황 입력 → AI 판단 확인 → 틀리면 교정 → 저장
        </div>
      </div>

      {/* 샘플 */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, color:"#374151", fontWeight:700, marginBottom:6, letterSpacing:1 }}>샘플 상황</div>
        {(SAMPLES[role]||SAMPLES.PE).map((s,i) => (
          <button key={i} onClick={() => setSituation(s)} style={{
            display:"block", width:"100%", textAlign:"left",
            background:"rgba(167,139,250,0.06)", border:"1px solid rgba(167,139,250,0.18)",
            borderRadius:7, padding:"7px 12px", color:"#a78bfa",
            fontSize:11.5, cursor:"pointer", lineHeight:1.5, marginBottom:5,
          }}>{s}</button>
        ))}
      </div>

      <textarea value={situation} onChange={e=>setSituation(e.target.value)}
        placeholder="현장 상황을 직접 입력하세요..."
        rows={3} style={{
          width:"100%", background:"rgba(4,8,15,0.8)",
          border:"1.5px solid rgba(167,139,250,0.3)", borderRadius:8,
          color:"#e2e8f0", padding:"10px 13px", fontSize:13, outline:"none",
          resize:"vertical", lineHeight:1.7, boxSizing:"border-box",
          fontFamily:"inherit", marginBottom:10,
        }}
      />

      <button onClick={askAI} disabled={!situation.trim()||loading} style={{
        padding:"10px 18px", marginBottom:14,
        background:situation&&!loading?"linear-gradient(135deg,#a78bfa,#7c3aed)":"rgba(51,65,85,0.3)",
        border:"none", borderRadius:8,
        color:situation&&!loading?"#fff":"#374151",
        fontSize:13, fontWeight:700,
        cursor:situation&&!loading?"pointer":"not-allowed",
        display:"inline-flex", alignItems:"center", gap:8,
      }}>
        {loading?<><Spinner/>AI 판단 중...</>:"🤖 AI 판단 확인"}
      </button>

      {aiAnswer && (
        <>
          <div style={{
            background:`${roleInfo.color}08`, border:`1px solid ${roleInfo.color}25`,
            borderRadius:10, padding:"13px 15px", marginBottom:12,
          }}>
            <div style={{ fontSize:10, color:roleInfo.color, fontWeight:800, marginBottom:7 }}>
              {roleInfo.icon} {roleInfo.label}의 판단
            </div>
            <div style={{ fontSize:13, color:"#dde4f0", lineHeight:1.75, whiteSpace:"pre-wrap" }}>
              {aiAnswer}
            </div>
          </div>

          <textarea value={correction} onChange={e=>setCorrection(e.target.value)}
            placeholder="AI 판단이 맞으면 비워두세요. 틀렸다면 올바른 대응을 입력하세요."
            rows={2} style={{
              width:"100%", background:"rgba(4,8,15,0.8)",
              border:"1.5px solid rgba(249,115,22,0.25)", borderRadius:8,
              color:"#e2e8f0", padding:"9px 13px", fontSize:12.5, outline:"none",
              resize:"vertical", lineHeight:1.7, boxSizing:"border-box",
              fontFamily:"inherit", marginBottom:10,
            }}
          />

          <SaveBtn onClick={saveCase} saving={saving} saved={saved}/>
        </>
      )}

      {cases.length > 0 && (
        <div style={{ marginTop:24 }}>
          <div style={{ fontSize:10, color:"#374151", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
            📚 저장된 교정 사례 ({cases.length}건)
          </div>
          {[...cases].reverse().map((c,i) => (
            <div key={i} style={{
              background:"rgba(8,14,26,0.8)", border:"1px solid rgba(51,65,85,0.35)",
              borderRadius:8, padding:"11px 13px", marginBottom:8,
            }}>
              <div style={{ fontSize:11, color:"#64748b", marginBottom:4 }}>
                <span style={{ color:"#475569" }}>상황: </span>{c.situation.slice(0,60)}...
              </div>
              <div style={{ fontSize:11, color:"#64748b", marginBottom: c.correction ? 4 : 0 }}>
                <span style={{ color:roleInfo.color }}>AI: </span>{c.aiAnswer.slice(0,60)}...
              </div>
              {c.correction && (
                <div style={{ fontSize:11, color:"#fbbf24" }}>
                  <span style={{ color:"#f97316" }}>교정: </span>{c.correction}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 4: 문서·사진 학습 ──────────────────────────────────────────────────
function TabDocument({ role, roleInfo }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [analyzed, setAnalyzed] = useState("");
  const [category, setCategory] = useState("판단기준");
  const [imageType, setImageType] = useState(""); // 이미지 유형 (검사기준서/다이어그램/불량/설비/기타)
  const [recommendedCategory, setRecommendedCategory] = useState(""); // AI가 추천한 카테고리
  const [uploadedImageUrl, setUploadedImageUrl] = useState(""); // 드라이브 업로드된 이미지 URL

  // PDF 관련 (Step 5-B)
  const [pdfDoc, setPdfDoc] = useState(null);          // 로드된 PDF 객체
  const [pdfPageCount, setPdfPageCount] = useState(0); // 페이지 수
  const [pdfMode, setPdfMode] = useState("text");      // "text" | "vision"
  const [pdfImageUrls, setPdfImageUrls] = useState([]); // 페이지별 드라이브 URL
  // v19: PDF Vision 모드 페이지별 분석 결과 (카드 UI용)
  //   각 원소: { pageNum, content, section, summary, imageUrl, isError, errorMsg }
  //   - content: 4블록 응답 전체 텍스트 (사용자 편집 가능)
  //   - section: 챕터/섹션 (목차 우선, Vision fallback, 직전 페이지 상속)
  //   - summary: [핵심 정보] 블록 한 줄 (카드 헤더에 표시)
  const [pdfPageResults, setPdfPageResults] = useState([]);
  // v19: 카드별 펼침 상태 (페이지 번호 → boolean)
  const [pageExpanded, setPageExpanded] = useState({});
  // v19: PDF Vision 모드 페이지별 저장 진행률
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState(""); // 분석 진행 단계 표시
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [defectInfo, setDefectInfo] = useState({ count: 0, hasPattern: false }); // 불량 사진 누적 정보
  const fileRef = useRef();

  const CATEGORIES = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];
  const IMAGE_TYPES = ["검사 기준서", "공정 다이어그램", "불량 사진", "설비 사진", "기타"];
  const DEFECT_PATTERN_THRESHOLD = 10; // 불량 사진 N장 이상 누적 시 패턴 추출

  const isImage = file && file.type.startsWith("image/");
  const isPDF = file && file.type === "application/pdf";
  const isDoc = file && (file.name.endsWith(".docx") || file.name.endsWith(".doc"));
  const isExcel = file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"));

  // 시작 시 불량 사진 누적 카운트 로드
  useEffect(() => {
    (async () => {
      const info = await loadDefectImageCount(role);
      setDefectInfo(info);
    })();
  }, [role]);

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setAnalyzed("");
    setError("");
    setImageType("");
    setRecommendedCategory("");
    setUploadedImageUrl("");
    setPdfDoc(null);
    setPdfPageCount(0);
    setPdfImageUrls([]);
    setPdfMode("text");
    // v19: 페이지별 결과·펼침 상태·저장 진행률 초기화
    setPdfPageResults([]);
    setPageExpanded({});
    setSaveProgress({ current: 0, total: 0 });

    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview("");
    }

    // PDF면 페이지 수 자동 파악
    if (f.type === "application/pdf") {
      try {
        const pdf = await loadPdfDocument(f);
        setPdfDoc(pdf);
        setPdfPageCount(pdf.numPages);
      } catch (err) {
        setError(`PDF 로드 실패: ${err.message}`);
      }
    }
  };

  // 이미지 유형별 특화 프롬프트
  const getTypeSpecificPrompt = (detectedType) => {
    const baseRole = `당신은 ${roleInfo.label}(${role}) AI입니다.`;
    switch (detectedType) {
      case "검사 기준서":
        return `${baseRole}\n검사 기준서 이미지에서 다음을 정확히 추출하세요:\n- 검사 항목명 (각 항목)\n- 측정 위치 / 측정 방법\n- 규격값 (수치, 허용 오차 포함)\n- CTQ 여부\n표 형태가 있으면 표 구조를 살려서 정리.`;
      case "공정 다이어그램":
        return `${baseRole}\n공정 다이어그램에서 다음을 추출하세요:\n- 공정 단계 순서 (좌→우 또는 위→아래)\n- 각 단계의 명칭과 역할\n- 단계 간 연결 관계 / 분기 / 피드백 루프\n- 표시된 주요 변수나 조건`;
      case "불량 사진":
        return `${baseRole}\n불량 현상 사진에서 다음을 추출하세요:\n- 불량의 시각적 특징 (색상, 형태, 위치, 크기)\n- 불량 발생 부위 (제품의 어느 부분)\n- 추정 원인 (시각적 단서 기반)\n- 분류 가능한 불량 유형 (예: 스크래치, 변색, 누액, 변형 등)`;
      case "설비 사진":
        return `${baseRole}\n설비 사진에서 다음을 추출하세요:\n- 설비 종류 / 명칭 (식별 가능한 경우)\n- 주요 부품 또는 구조\n- 라벨, 표시판, 게이지 표시값\n- 설비 상태 (정상/이상 신호 있는지)`;
      default:
        return `${baseRole}\n업로드된 이미지에서 ${role} 업무 관련 핵심 내용을 추출하세요.\n한국어로 간결하게 정리.`;
    }
  };

  // AI에게 이미지 유형 자동 판단 요청
  const detectImageType = async (base64, mediaType) => {
    const sys = `당신은 이미지 분류기입니다. 업로드된 이미지가 다음 중 어느 유형인지 판단하세요.
- 검사 기준서: 표/다이어그램으로 검사 항목과 규격이 정리된 문서
- 공정 다이어그램: 공정 흐름이나 시스템 구조를 보여주는 도식
- 불량 사진: 제품의 불량/이상 현상을 찍은 사진
- 설비 사진: 공장 설비, 기계, 장비를 찍은 사진
- 기타: 위에 해당하지 않음

또한 이 이미지가 다음 카테고리 중 어디에 가장 잘 맞는지 추천하세요:
- 공장정보, 업무역할, 판단기준, 협업방식, 교정사례

JSON으로만 답하세요. 다른 설명 없이.

응답 형식:
{"imageType":"검사 기준서|공정 다이어그램|불량 사진|설비 사진|기타","recommendedCategory":"공장정보|업무역할|판단기준|협업방식|교정사례","reason":"한 줄 사유"}`;

    try {
      const raw = await callClaudeVision(sys, "이 이미지를 분류하세요.", base64, mediaType);
      const parsed = safeJSON(raw);
      return {
        imageType: parsed.imageType || "기타",
        recommendedCategory: parsed.recommendedCategory || "판단기준",
      };
    } catch {
      return { imageType: "기타", recommendedCategory: "판단기준" };
    }
  };

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setAnalyzed("");
    setImageType("");
    setRecommendedCategory("");
    setUploadedImageUrl("");
    // v19: PDF Vision 모드 재분석 시 이전 페이지 결과 초기화
    setPdfPageResults([]);
    setPageExpanded({});

    try {
      let result = "";
      let detectedType = "";

      if (isImage) {
        const base64 = await fileToBase64(file);
        // 압축된 이미지는 항상 JPEG로 재인코딩됨
        const mediaType = "image/jpeg";

        // 압축 후 크기 표시 (디버깅 + 사용자 안내용)
        const compressedKB = estimateBase64Size(base64);
        console.log(`이미지 압축 완료: ${compressedKB}KB`);

        // 1단계: 이미지 유형 자동 판단
        setAnalyzeStep("이미지 유형 분석 중...");
        const detection = await detectImageType(base64, mediaType);
        detectedType = detection.imageType;
        setImageType(detectedType);
        setRecommendedCategory(detection.recommendedCategory);
        setCategory(detection.recommendedCategory); // 카테고리 자동 설정

        // 2단계: 유형별 특화 프롬프트로 분석
        setAnalyzeStep(`${detectedType} 분석 중...`);
        const specificPrompt = getTypeSpecificPrompt(detectedType);

        // 시각 메타데이터 + 추출 텍스트 + 메타데이터 + 챕터/섹션을 한꺼번에 요청 (v19: 4블록)
        const analysisPrompt = `${specificPrompt}

이미지가 매뉴얼·작업 지시서·도면·사양서·표 형식이면 단계 번호·구체 수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출하세요. 글자수 제한 없음 — 정보가 많으면 길게, 적으면 짧게. **표가 있으면 헤더 행과 모든 데이터 행을 셀 단위로 짚어 추출 — 항목명·대수·사양·비고 등 셀 안의 모든 텍스트·숫자·단위 빠뜨리지 말 것.**

다음 4블록 형식으로 한국어 답변:
[추출 텍스트]
(이미지에서 읽거나 추론한 정보. 단계·수치·버튼명·부품명·치수 등 구체값 빠뜨리지 말 것)

[핵심 정보]
(이 이미지가 다루는 공정·설비·이슈 — 한 문장)

[메타데이터]
(문서 제목, Rev, 작성일, 페이지 번호 등이 보이면 기재. 없으면 생략)

[챕터/섹션]
(이미지 상단·헤더 영역에 보이는 챕터 또는 섹션 제목. 예: "2. 안전 인터록", "§4.3 도어 인터록". 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)`;

        result = await callClaudeVision(
          analysisPrompt,
          `이 ${detectedType} 이미지를 분석하세요.`,
          base64,
          mediaType
        );

        // 3단계: 드라이브에 이미지 업로드 (백그라운드 진행, 실패해도 분석은 유지)
        setAnalyzeStep("드라이브 저장 중...");
        let imageUrl = "";
        try {
          const uploadResult = await uploadImageToDrive(role, file.name, base64, mediaType);
          if (uploadResult && uploadResult.url) {
            imageUrl = uploadResult.url;
            setUploadedImageUrl(imageUrl);
          }
        } catch (e) {
          console.error("드라이브 업로드 실패 (분석은 계속 진행):", e);
        }

        // 메타데이터 추가 (URL 있으면 포함)
        const urlLine = imageUrl ? `[이미지URL] ${imageUrl}\n` : "";
        result = `${urlLine}[이미지 유형] ${detectedType}\n${result}`;
      } else if (isPDF && pdfDoc) {
        // ─── PDF 처리 (Step 5-B) ───
        if (pdfMode === "text") {
          // 텍스트 추출 모드
          setAnalyzeStep(`PDF 텍스트 추출 중 (${pdfPageCount}페이지)...`);
          const fullText = await extractPdfText(pdfDoc);

          if (!fullText || fullText.trim().length < 50) {
            // 텍스트 추출 실패 = 스캔 PDF 가능성
            throw new Error("텍스트 추출이 거의 안 되었습니다. 스캔 PDF로 보입니다. '그림 분석' 모드로 다시 시도하세요.");
          }

          setAnalyzeStep("AI 분석 중...");
          // v19: 텍스트 추출 모드도 4블록 형식 (챕터 정보 추출 위해)
          const sys = `${roleInfo.label}(${role}) AI입니다. PDF에서 추출한 텍스트입니다.
카테고리: ${category}
한국어로 핵심 내용만 정리하되, 학습 가치 있는 구체 정보(수치·부품명·단계 등)는 빠뜨리지 마세요.
표/구조가 있으면 살려서 정리하세요.

다음 4블록 형식으로 한국어 답변:
[추출 텍스트]
(원문에서 학습 가치 있는 내용. 1000자 이내 권장)

[핵심 정보]
(이 문서가 다루는 공정·설비·이슈 — 한 문장)

[메타데이터]
(문서 제목, Rev, 작성일이 보이면 기재. 없으면 생략)

[챕터/섹션]
(이 문서의 주요 챕터/섹션 제목. 예: "2. 안전 인터록". 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)`;
          const truncated = fullText.slice(0, 12000); // 너무 길면 자르기
          result = await callClaude(sys, `다음 PDF 내용에서 핵심을 추출하세요:\n\n${truncated}`);

          result = `[PDF: ${file.name} - 텍스트 추출, ${pdfPageCount}페이지]\n${result}`;
        } else {
          // v19: 그림 분석 모드 — 페이지별 카드 + 페이지별 row 저장 (종합 요약 없음)
          // 1) 목차 파싱 (성공하면 페이지→챕터 매핑)
          setAnalyzeStep("PDF 목차 파싱 중...");
          const outlineMap = await extractPdfOutline(pdfDoc);

          const pageResults = []; // 페이지별 결과 누적
          const pageUrls = [];
          let lastSection = ""; // 직전 페이지 챕터 상속용

          for (let pageNum = 1; pageNum <= pdfPageCount; pageNum++) {
            setAnalyzeStep(`페이지 ${pageNum}/${pdfPageCount} 분석 중...`);

            // 1단계: 페이지를 base64 이미지로 변환
            const pageBase64 = await pdfPageToBase64(pdfDoc, pageNum);

            // 2단계: 드라이브에 업로드 (백그라운드)
            const pageFilename = `${file.name.replace(/\.pdf$/i, "")}_p${pageNum}.jpg`;
            let pageUrl = "";
            try {
              const uploadResult = await uploadImageToDrive(role, pageFilename, pageBase64, "image/jpeg");
              if (uploadResult && uploadResult.url) {
                pageUrl = uploadResult.url;
              }
            } catch (e) {
              console.error(`페이지 ${pageNum} 드라이브 업로드 실패:`, e);
            }
            pageUrls.push(pageUrl);

            // 3단계: Vision API로 분석 (v19: 4블록)
            const pagePrompt = `${roleInfo.label}(${role}) AI입니다. PDF 페이지 ${pageNum}/${pdfPageCount} 분석.
카테고리: ${category}

페이지가 매뉴얼·작업 지시서·도면·사양서·표 형식이면 단계 번호·구체 수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출하세요. 글자수 제한 없음 — 정보가 많으면 길게, 적으면 짧게. **표가 있으면 헤더 행과 모든 데이터 행을 셀 단위로 짚어 추출 — 항목명·대수·사양·비고 등 셀 안의 모든 텍스트·숫자·단위 빠뜨리지 말 것.**

다음 4블록 형식:
[추출 텍스트] (페이지의 실제 내용. 단계·수치·버튼명·부품명·치수 등 구체값 빠뜨리지 말 것)
[핵심 정보] (이 페이지가 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일이 보이면 기재. 없으면 생략)
[챕터/섹션] (페이지 상단·헤더 영역에 보이는 챕터 또는 섹션 제목. 예: "2. 안전 인터록". 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)`;

            let pageContent = "";
            let isError = false;
            let errorMsg = "";
            try {
              pageContent = await callClaudeVision(
                pagePrompt,
                `이 PDF 페이지를 분석하세요.`,
                pageBase64,
                "image/jpeg"
              );
            } catch (e) {
              isError = true;
              errorMsg = e.message || "분석 실패";
              pageContent = `(분석 실패: ${errorMsg})`;
            }

            // 챕터 결정: 목차 → Vision 응답 → 직전 페이지 상속 → 빈 칸
            let section = outlineMap[pageNum] || "";
            if (!section && !isError) {
              section = parseChapterFromAnalysis(pageContent);
            }
            if (!section) section = lastSection; // 직전 페이지 상속
            if (section) lastSection = section;

            // 핵심 정보 추출 (카드 헤더에 한 줄 표시용)
            let summary = "";
            const summaryMatch = pageContent.match(/\[핵심 정보\]\s*\n?([^\n\[]*)/);
            if (summaryMatch) summary = (summaryMatch[1] || "").trim();

            pageResults.push({
              pageNum,
              content: pageContent,
              section,
              summary,
              imageUrl: pageUrl,
              isError,
              errorMsg,
            });
          }

          setPdfImageUrls(pageUrls);
          setPdfPageResults(pageResults);
          // 첫 페이지만 펼치고 나머지는 접힘
          setPageExpanded({ 1: true });

          // analyzed에는 카드 UI 모드 식별용 더미 값 (실제 결과는 pdfPageResults에 있음)
          result = `[PDF: ${file.name} - 그림 분석, ${pdfPageCount}페이지] (페이지별 카드 보기)`;
        }
      } else {
        // 텍스트 파일 처리 (Step 7-10B 적용)
        setAnalyzeStep("파일 분석 중...");
        const sys = `${roleInfo.label}(${role}) AI입니다. 카테고리: ${category}.

파일이 매뉴얼·작업 지시서·도면 텍스트면 단계 번호·구체 수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출. 글자수 제한 없음 — 정보가 많으면 길게, 적으면 짧게.

다음 3블록 형식:
[추출 텍스트] (파일의 실제 내용. 구체값 빠뜨리지 말 것)
[핵심 정보] (이 파일이 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일이 보이면 기재)`;
        let text = await extractTextFromFile(file);
        if (!text || text.length < 10) text = `파일명: ${file.name}`;
        const truncated = text.slice(0, 2000);
        result = await callClaude(sys, `다음 내용에서 핵심을 추출하세요:\n${truncated}`);
      }

      setAnalyzed(result);
    } catch(e) {
      setError(`분석 실패: ${e.message}`);
    } finally {
      setLoading(false);
      setAnalyzeStep("");
    }
  };

  const [conflictQueue, setConflictQueue] = useState([]);
  const [currentConflict, setCurrentConflict] = useState(null);

  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      setCurrentConflict(conflictQueue[0]);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
  };

  // 불량 사진 패턴 추출 (10장 이상 누적 시 자동 트리거)
  const extractDefectPattern = async () => {
    try {
      const data = await loadDefectImageData(role);
      if (data.length === 0) return;

      const dataText = data.map((d, i) =>
        `${i + 1}. ${d.content.replace(/\[파일: [^\]]+\]/g, '').slice(0, 300)}`
      ).join("\n\n");

      const sys = `당신은 불량 패턴 분석 전문가입니다. 아래 ${data.length}장의 불량 사진 분석 결과들을 보고 공통된 패턴을 일반화해서 추출하세요.

[불량 사진 분석 결과들]
${dataText.slice(0, 8000)}

다음 형식으로 한국어 요약 작성:
[자주 발생하는 불량 유형] (Top 3)
[공통 발생 부위]
[추정 공통 원인]
[권장 점검 포인트]

전체 500자 이내로 간결하게.`;

      const pattern = await callClaude(sys, "불량 패턴을 일반화하세요.");
      await saveDefectPattern(role, pattern);

      // UI 갱신
      const info = await loadDefectImageCount(role);
      setDefectInfo(info);
    } catch (e) {
      console.error("불량 패턴 추출 실패:", e);
    }
  };

  const save = async () => {
    if (!analyzed) return;
    setSaving(true);

    // 정상 저장 완료 후 입력 초기화 헬퍼
    const resetInputs = () => {
      if (preview) URL.revokeObjectURL(preview);
      setFile(null);
      setPreview("");
      setAnalyzed("");
      setImageType("");
      setRecommendedCategory("");
      setUploadedImageUrl("");
      setPdfDoc(null);
      setPdfPageCount(0);
      setPdfImageUrls([]);
      setPdfMode("text");
      setPdfPageResults([]);
      setPageExpanded({});
      setError("");
      setSaveProgress({ current: 0, total: 0 });
      if (fileRef.current) fileRef.current.value = "";
    };

    try {
      // ─── 분기 1: PDF Vision 모드 — 페이지별 N개 row 저장 (v19) ───
      if (isPDF && pdfMode === "vision" && pdfPageResults.length > 0) {
        const valid = pdfPageResults.filter(p => !p.isError && p.content && p.content.trim());
        if (valid.length === 0) {
          setError("저장 가능한 페이지가 없습니다 (모두 분석 실패)");
          setSaving(false);
          return;
        }

        setSaveProgress({ current: 0, total: valid.length });

        // 페이지별 충돌 검사는 일괄 학습 흐름과 일관 — 건너뛰고 모두 저장
        // (자동 점검에서 사후 감지됨, Common 패턴)
        let okCount = 0;
        let failCount = 0;
        for (let i = 0; i < valid.length; i++) {
          const p = valid[i];
          setSaveProgress({ current: i + 1, total: valid.length });

          const contentTagged = `[파일: ${file.name}] [PDF 페이지 ${p.pageNum}/${pdfPageCount}]\n${p.content}`;
          const sourceMeta = buildSourceMeta(
            file.name,
            String(p.pageNum),
            p.section,
            p.imageUrl  // 직접 업로드는 PDF 자체 URL 없으므로 페이지별 이미지 URL 사용
          );

          try {
            const ok = await saveToSheet(role, category, contentTagged, sourceMeta);
            if (ok) okCount++; else failCount++;
          } catch (e) {
            failCount++;
            console.error(`페이지 ${p.pageNum} 저장 실패:`, e);
          }
        }

        if (okCount > 0 && failCount === 0) {
          resetInputs();
        } else if (okCount > 0) {
          alert(`${okCount}개 페이지 저장됨 / ${failCount}개 실패`);
          resetInputs();
        } else {
          setError("페이지 저장 실패");
          return;
        }

        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        return;
      }

      // ─── 분기 2: 단일 이미지 / PDF 텍스트 모드 / 텍스트 파일 — 1 row 저장 (v18 흐름 + v19 sourceMeta) ───
      const contentToSave = `[파일: ${file.name}] ${analyzed}`;

      // 단일 row의 sourceMeta 빌드 (v19)
      // - 이미지: page 빈 칸 / section은 Vision 응답에서 추출 / url은 Drive 업로드 URL
      // - PDF 텍스트 모드: page 빈 칸(전체) / section은 응답에서 추출 / url 빈 칸 (직접 업로드 PDF는 Drive에 없음)
      // - 텍스트 파일: meta 모두 빈 칸 (sourceMeta=null)
      let sourceMeta = null;
      if (isImage) {
        const section = parseChapterFromAnalysis(analyzed);
        sourceMeta = buildSourceMeta(file.name, "", section, uploadedImageUrl);
      } else if (isPDF && pdfMode === "text") {
        const section = parseChapterFromAnalysis(analyzed);
        sourceMeta = buildSourceMeta(file.name, "", section, "");
      }

      // 충돌 검사
      const conflict = await checkConflict(role, category, contentToSave);
      if (conflict) {
        setConflictQueue([{ category, content: contentToSave, conflict, sourceMeta }]);
      } else {
        await saveToSheet(role, category, contentToSave, sourceMeta);

        // 불량 사진이고 누적 임계 도달 시 패턴 추출 (백그라운드)
        if (imageType === "불량 사진") {
          const newCount = (defectInfo.count || 0) + 1;
          if (newCount >= DEFECT_PATTERN_THRESHOLD && newCount % DEFECT_PATTERN_THRESHOLD === 0) {
            extractDefectPattern(); // await 안 함
          }
          setDefectInfo({ ...defectInfo, count: newCount });
        }

        resetInputs();
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError("저장 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>📄 문서·사진 학습</div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          PDF, Word, Excel, 사진 파일을 업로드하면 AI가 핵심 내용을 추출해요
        </div>
      </div>

      {/* 지원 형식 */}
      <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
        {[
          { label:"PDF", color:"#ef4444" },
          { label:"JPG/PNG", color:"#f97316" },
          { label:"TXT/CSV", color:"#a78bfa" },
        ].map(t => (
          <span key={t.label} style={{
            background:`${t.color}15`, border:`1px solid ${t.color}30`,
            color:t.color, borderRadius:5, padding:"2px 10px",
            fontSize:10, fontWeight:800,
          }}>{t.label}</span>
        ))}
      </div>

      {/* Word/Excel 미지원 안내 */}
      <div style={{
        fontSize:10, color:"#64748b", marginBottom:14, lineHeight:1.5,
        padding:"6px 10px", background:"rgba(15,23,42,0.5)",
        border:"1px solid rgba(51,65,85,0.3)", borderRadius:6,
      }}>
        💡 Word/Excel은 PDF로 변환 후 업로드해주세요 (파일 → 다른 이름으로 저장 → PDF)
      </div>

      {/* 파일 업로드 */}
      <div onClick={() => fileRef.current?.click()} style={{
        border:`2px dashed ${file ? roleInfo.color : "rgba(71,85,105,0.6)"}`,
        borderRadius:12, padding:"28px 20px", textAlign:"center",
        cursor:"pointer", marginBottom:14,
        background: file ? `${roleInfo.color}05` : "rgba(15,23,42,0.4)",
        transition:"all 0.2s",
      }}>
        <input ref={fileRef} type="file"
          accept=".pdf,.txt,.csv,.md,.jpg,.jpeg,.png"
          onChange={handleFile} style={{ display:"none" }}/>
        {preview ? (
          <img src={preview} alt="미리보기"
            style={{ maxHeight:150, maxWidth:"100%", borderRadius:8, marginBottom:8 }}/>
        ) : (
          <div style={{ fontSize:36, marginBottom:8 }}>{file ? "📄" : "📂"}</div>
        )}
        {file ? (
          <>
            <div style={{ fontSize:13, color:roleInfo.color, fontWeight:700 }}>{file.name}</div>
            <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>
              {(file.size/1024).toFixed(1)}KB · 클릭하여 변경
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize:13, color:"#94a3b8" }}>클릭하여 파일 선택</div>
            <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>PDF, Word, Excel, 사진</div>
          </>
        )}
      </div>

      {/* 불량 사진 누적 정보 */}
      {defectInfo.count > 0 && (
        <div style={{
          background: defectInfo.hasPattern ? "rgba(52,211,153,0.06)" : "rgba(245,158,11,0.06)",
          border: `1px solid ${defectInfo.hasPattern ? "rgba(52,211,153,0.25)" : "rgba(245,158,11,0.25)"}`,
          borderRadius:8, padding:"9px 13px", marginBottom:12,
          fontSize:11, color:"#94a3b8", lineHeight:1.6,
        }}>
          <span style={{ color: defectInfo.hasPattern ? "#34d399" : "#fbbf24", fontWeight:700 }}>
            {defectInfo.hasPattern ? "✅ 불량 패턴 학습됨" : `📸 불량 사진 ${defectInfo.count}장 누적`}
          </span>
          {!defectInfo.hasPattern && defectInfo.count < DEFECT_PATTERN_THRESHOLD && (
            <span> · {DEFECT_PATTERN_THRESHOLD - defectInfo.count}장 더 모이면 자동 패턴 추출</span>
          )}
        </div>
      )}

      {/* PDF 모드 선택 (Step 5-B) */}
      {isPDF && pdfPageCount > 0 && (
        <div style={{
          background:"rgba(15,23,42,0.6)",
          border:`1px solid ${roleInfo.color}30`,
          borderRadius:10, padding:"14px 16px", marginBottom:12,
        }}>
          <div style={{ fontSize:12, color:"#cbd5e1", fontWeight:700, marginBottom:4 }}>
            📄 PDF 분석 방식 선택
          </div>
          <div style={{ fontSize:10.5, color:"#64748b", marginBottom:10 }}>
            {pdfPageCount}페이지 · {(file.size/1024).toFixed(0)}KB
            {pdfPageCount > 30 && (
              <span style={{ color:"#fbbf24", marginLeft:6, fontWeight:700 }}>
                ⚠️ 페이지 수가 많습니다
              </span>
            )}
          </div>

          {/* 옵션 2개 */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {/* 텍스트 추출 */}
            <div onClick={() => setPdfMode("text")} style={{
              padding:"10px 12px", cursor:"pointer",
              background: pdfMode === "text" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
              border: `1.5px solid ${pdfMode === "text" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
              borderRadius:8, transition:"all 0.15s",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                <div style={{
                  width:14, height:14, borderRadius:"50%",
                  border:`2px solid ${pdfMode === "text" ? roleInfo.color : "#475569"}`,
                  background: pdfMode === "text" ? roleInfo.color : "transparent",
                }}/>
                <span style={{ fontSize:11.5, fontWeight:700,
                  color: pdfMode === "text" ? roleInfo.color : "#94a3b8" }}>
                  📝 텍스트 추출
                </span>
              </div>
              <div style={{ fontSize:10, color:"#64748b", lineHeight:1.5 }}>
                {calcTextExtractCost(pdfPageCount).label}
                <br/>
                ⚡ {estimateTime(pdfPageCount, "text")} · 전체 페이지
                <br/>
                <span style={{ color:"#34d399" }}>✓ 텍스트 PDF에 적합</span>
                <br/>
                <span style={{ color:"#f87171" }}>✗ 그림/표 시각 정보 손실</span>
              </div>
            </div>

            {/* 그림 분석 */}
            <div onClick={() => setPdfMode("vision")} style={{
              padding:"10px 12px", cursor:"pointer",
              background: pdfMode === "vision" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
              border: `1.5px solid ${pdfMode === "vision" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
              borderRadius:8, transition:"all 0.15s",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                <div style={{
                  width:14, height:14, borderRadius:"50%",
                  border:`2px solid ${pdfMode === "vision" ? roleInfo.color : "#475569"}`,
                  background: pdfMode === "vision" ? roleInfo.color : "transparent",
                }}/>
                <span style={{ fontSize:11.5, fontWeight:700,
                  color: pdfMode === "vision" ? roleInfo.color : "#94a3b8" }}>
                  🖼️ 그림 분석
                </span>
              </div>
              <div style={{ fontSize:10, color:"#64748b", lineHeight:1.5 }}>
                {calcVisionCost(pdfPageCount).label}
                <br/>
                ⏱️ {estimateTime(pdfPageCount, "vision")} · 전체 페이지
                <br/>
                <span style={{ color:"#34d399" }}>✓ 시각 정보 보존, 스캔 PDF OK</span>
                <br/>
                <span style={{ color:"#34d399" }}>✓ 페이지별 드라이브 저장</span>
              </div>
            </div>
          </div>

          {pdfPageCount > 30 && pdfMode === "vision" && (
            <div style={{
              marginTop:8, padding:"7px 10px",
              background:"rgba(251,191,36,0.08)",
              border:"1px solid rgba(251,191,36,0.3)",
              borderRadius:6, fontSize:10.5, color:"#fbbf24",
            }}>
              ⚠️ {pdfPageCount}페이지 그림 분석 시 비용이 큽니다. 텍스트 추출 모드가 가능하면 그쪽을 권장합니다.
            </div>
          )}
        </div>
      )}

      {/* 이미지 유형 자동 판단 결과 표시 */}
      {imageType && (
        <div style={{
          background:`${roleInfo.color}06`, border:`1px solid ${roleInfo.color}25`,
          borderRadius:8, padding:"10px 13px", marginBottom:12,
        }}>
          <div style={{ fontSize:10, color:roleInfo.color, fontWeight:800, marginBottom:4 }}>
            🎯 AI 자동 판단
          </div>
          <div style={{ fontSize:12, color:"#cbd5e1" }}>
            <strong>이미지 유형:</strong> {imageType}
            {recommendedCategory && (
              <> · <strong>추천 카테고리:</strong> {recommendedCategory}</>
            )}
          </div>
          {recommendedCategory && recommendedCategory !== category && (
            <div style={{ fontSize:10, color:"#fbbf24", marginTop:4 }}>
              ⚠️ 카테고리를 변경하셨습니다 (자동 추천: {recommendedCategory})
            </div>
          )}
        </div>
      )}

      {/* 카테고리 선택 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:10, color:"#475569", fontWeight:800, letterSpacing:1.2, marginBottom:6 }}>
          저장 카테고리 {recommendedCategory && <span style={{ color:roleInfo.color, marginLeft:4 }}>(AI 추천: {recommendedCategory})</span>}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)} style={{
              padding:"5px 12px",
              background: category===cat ? `${roleInfo.color}20` : "rgba(30,41,59,0.6)",
              border:`1px solid ${category===cat ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
              borderRadius:6, color: category===cat ? roleInfo.color : "#64748b",
              fontSize:11, fontWeight:700, cursor:"pointer",
            }}>{cat}</button>
          ))}
        </div>
      </div>

      {/* 분석 버튼 */}
      <button onClick={analyze} disabled={!file || loading} style={{
        padding:"10px 18px", marginBottom:14,
        background: file&&!loading ? `linear-gradient(135deg,${roleInfo.color},${roleInfo.color}99)` : "rgba(51,65,85,0.3)",
        border:"none", borderRadius:8,
        color: file&&!loading ? "#fff" : "#374151",
        fontSize:13, fontWeight:700,
        cursor: file&&!loading ? "pointer" : "not-allowed",
        display:"inline-flex", alignItems:"center", gap:8,
      }}>
        {loading ? <><Spinner/>{analyzeStep || "분석 중..."}</> : "🔍 AI 분석"}
      </button>

      {error && (
        <div style={{
          padding:"9px 13px", background:"rgba(239,68,68,0.08)",
          border:"1px solid rgba(239,68,68,0.25)", borderRadius:8,
          fontSize:11, color:"#fca5a5", marginBottom:12,
        }}>{error}</div>
      )}

      {/* 분석 결과 */}
      {analyzed && (
        <div style={{ marginBottom:14 }}>
          {/* v19: PDF Vision 모드면 페이지별 카드 UI, 그 외는 기존 textarea */}
          {(isPDF && pdfMode === "vision" && pdfPageResults.length > 0) ? (
            <>
              <div style={{ fontSize:10, color:roleInfo.color, fontWeight:800, marginBottom:8 }}>
                🤖 페이지별 분석 결과 ({pdfPageResults.length}페이지 · 저장 카테고리: {category})
              </div>
              <div style={{
                fontSize:10, color:"#64748b", marginBottom:10, padding:"6px 10px",
                background:"rgba(15,23,42,0.5)", borderRadius:6,
                border:"1px solid rgba(51,65,85,0.3)", lineHeight:1.5,
              }}>
                💡 각 페이지는 시트에 별도 행으로 저장됩니다. 카드를 클릭해 펼치면 내용 검토·편집 가능.
                저장 시 분석 실패 페이지는 자동 건너뜁니다.
              </div>

              {pdfPageResults.map(p => {
                const isOpen = !!pageExpanded[p.pageNum];
                const borderColor = p.isError ? "rgba(239,68,68,0.35)" : `${roleInfo.color}30`;
                return (
                  <div key={p.pageNum} style={{
                    background:"rgba(15,23,42,0.55)",
                    border:`1px solid ${borderColor}`,
                    borderRadius:8, marginBottom:6, overflow:"hidden",
                  }}>
                    {/* 카드 헤더 */}
                    <div
                      onClick={() => setPageExpanded(pe => ({ ...pe, [p.pageNum]: !pe[p.pageNum] }))}
                      style={{
                        padding:"9px 12px", cursor:"pointer",
                        display:"flex", alignItems:"center", gap:8,
                        background: isOpen ? "rgba(30,41,59,0.5)" : "transparent",
                        transition:"background 0.15s",
                      }}
                    >
                      <span style={{
                        fontSize:11, fontWeight:800, color:roleInfo.color,
                        minWidth:55,
                      }}>📄 p.{p.pageNum}</span>
                      {p.section && (
                        <span style={{
                          fontSize:10, padding:"1px 7px",
                          background:`${roleInfo.color}15`, color:roleInfo.color,
                          borderRadius:4, fontWeight:700,
                          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                          maxWidth:150,
                        }} title={p.section}>📑 {p.section}</span>
                      )}
                      <span style={{
                        flex:1, fontSize:11, color:"#94a3b8",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      }}>
                        {p.isError ? <span style={{ color:"#f87171" }}>⚠️ {p.errorMsg}</span> : (p.summary || "(핵심 정보 미추출)")}
                      </span>
                      <span style={{
                        fontSize:10, color:"#64748b",
                        transform: isOpen ? "rotate(180deg)" : "rotate(0)",
                        transition:"transform 0.2s",
                      }}>▼</span>
                    </div>

                    {/* 카드 본문 (펼친 상태) */}
                    {isOpen && (
                      <div style={{
                        padding:"4px 12px 10px",
                        borderTop:"1px solid rgba(51,65,85,0.4)",
                      }}>
                        <textarea
                          value={p.content}
                          onChange={e => {
                            const newContent = e.target.value;
                            setPdfPageResults(arr => arr.map(item =>
                              item.pageNum === p.pageNum ? { ...item, content: newContent } : item
                            ));
                          }}
                          rows={10}
                          style={{
                            width:"100%", background:"rgba(8,14,26,0.7)",
                            border:"1px solid rgba(51,65,85,0.4)",
                            borderRadius:6, color:"#dde4f0",
                            padding:"8px 10px", fontSize:11.5, lineHeight:1.65,
                            outline:"none", resize:"vertical", marginTop:6,
                            fontFamily:"inherit", boxSizing:"border-box",
                            maxHeight:400,
                          }}
                        />
                        <div style={{
                          display:"flex", alignItems:"center", justifyContent:"space-between",
                          marginTop:6, fontSize:10, color:"#64748b",
                        }}>
                          <span>{(p.content || "").length}자 · 시트 1행으로 저장됨</span>
                          {p.imageUrl && (
                            <a href={p.imageUrl} target="_blank" rel="noopener noreferrer" style={{
                              color:"#93c5fd", fontSize:10, textDecoration:"underline",
                            }}>🔗 페이지 이미지</a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 진행률 표시 (저장 중일 때) */}
              {saving && saveProgress.total > 0 && (
                <div style={{
                  margin:"10px 0",
                  background:"rgba(15,23,42,0.6)",
                  border:`1px solid ${roleInfo.color}40`,
                  borderRadius:8, padding:"10px 12px",
                }}>
                  <div style={{ fontSize:11, color:"#cbd5e1", marginBottom:6 }}>
                    저장 중... {saveProgress.current}/{saveProgress.total} 페이지
                  </div>
                  <div style={{
                    height:6, background:"rgba(51,65,85,0.5)", borderRadius:3, overflow:"hidden",
                  }}>
                    <div style={{
                      height:"100%",
                      width: saveProgress.total > 0
                        ? `${(saveProgress.current/saveProgress.total)*100}%` : "0%",
                      background:`linear-gradient(90deg,${roleInfo.color},${roleInfo.color}99)`,
                      transition:"width 0.3s",
                    }}/>
                  </div>
                </div>
              )}

              <SaveBtn onClick={save} saving={saving} saved={saved}/>
            </>
          ) : (
            <>
              <div style={{
                background:`${roleInfo.color}06`, border:`1px solid ${roleInfo.color}25`,
                borderRadius:10, padding:"13px 15px", marginBottom:10,
              }}>
                <div style={{ fontSize:10, color:roleInfo.color, fontWeight:800, marginBottom:7 }}>
                  🤖 AI 분석 결과 ({category})
                </div>
                <textarea
                  value={analyzed}
                  onChange={e => setAnalyzed(e.target.value)}
                  rows={4}
                  style={{
                    width:"100%", background:"transparent",
                    border:"none", color:"#dde4f0",
                    fontSize:12.5, lineHeight:1.75, outline:"none",
                    resize:"vertical", fontFamily:"inherit",
                    boxSizing:"border-box",
                  }}
                />
                <div style={{ fontSize:9, color:"#374151", marginTop:4 }}>
                  내용을 직접 수정할 수 있어요
                </div>
              </div>

              {/* 드라이브 업로드 상태 (이미지인 경우만) */}
              {isImage && (
                <div style={{
                  background: uploadedImageUrl ? "rgba(52,211,153,0.06)" : "rgba(239,68,68,0.06)",
                  border: `1px solid ${uploadedImageUrl ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.25)"}`,
                  borderRadius:8, padding:"9px 13px", marginBottom:10,
                  fontSize:11, lineHeight:1.6,
                }}>
                  {uploadedImageUrl ? (
                    <>
                      <span style={{ color:"#34d399", fontWeight:700 }}>✅ 드라이브에 저장됨</span>
                      <a href={uploadedImageUrl} target="_blank" rel="noopener noreferrer" style={{
                        color:"#93c5fd", marginLeft:8, fontSize:10.5, textDecoration:"underline",
                      }}>
                        🔗 원본 이미지 보기
                      </a>
                    </>
                  ) : (
                    <>
                      <span style={{ color:"#fca5a5", fontWeight:700 }}>⚠️ 드라이브 업로드 실패</span>
                      <span style={{ color:"#94a3b8", marginLeft:6, fontSize:10.5 }}>
                        (분석 결과는 그대로 저장되며, URL만 누락됨)
                      </span>
                    </>
                  )}
                </div>
              )}

              <SaveBtn onClick={save} saving={saving} saved={saved}/>
            </>
          )}
        </div>
      )}

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 5: 학습 현황 ────────────────────────────────────────────────────────
// ─── 검색 매치 하이라이트 헬퍼 ─────────────────────────────────────────────
function highlightMatch(text, query) {
  if (!text || !query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{
        background:"rgba(251,191,36,0.3)",
        color:"#fbbf24",
        padding:"1px 2px", borderRadius:2,
      }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── 학습 보관함 (TabLibrary): 검색 / 필터 / 정렬 / 열람 / 편집 / 삭제 ────
function TabLibrary({ role, roleInfo, knowledge, onReload, loading }) {
  const CATEGORIES = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("전체");
  const [sortMode, setSortMode] = useState("recent"); // recent | category | length
  const [pageSize, setPageSize] = useState(20);

  // 편집/삭제 state
  // editingKey: 편집 중인 항목 식별자 (category|content), null이면 편집 모드 아님
  const [editingKey, setEditingKey] = useState(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // deleteTarget: 삭제 확인 모달용 항목 객체, null이면 모달 안 뜸
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingNow, setDeletingNow] = useState(false);

  // 항목 식별자 생성 (category + content로 유니크 식별 - Apps Script도 동일 방식 매칭)
  const itemKey = (item) => `${item.category}|${item.content}`;

  // 편집 시작
  const startEdit = (item) => {
    setEditingKey(itemKey(item));
    setEditText(item.content || "");
  };

  // 편집 취소
  const cancelEdit = () => {
    setEditingKey(null);
    setEditText("");
  };

  // 편집 저장
  const saveEdit = async (item) => {
    const newContent = editText.trim();
    if (!newContent) return;
    if (newContent === (item.content || "").trim()) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    try {
      await replaceKnowledge(role, item.category, item.content, newContent);
      cancelEdit();
      await onReload();
    } catch (e) {
      console.error("[TabLibrary] 편집 저장 실패:", e);
      alert("편집 저장 실패. 다시 시도해 주세요.");
    } finally {
      setSavingEdit(false);
    }
  };

  // 삭제 확인
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingNow(true);
    try {
      await deleteKnowledge(role, deleteTarget.category, deleteTarget.content);
      setDeleteTarget(null);
      await onReload();
    } catch (e) {
      console.error("[TabLibrary] 삭제 실패:", e);
      alert("삭제 실패. 다시 시도해 주세요.");
    } finally {
      setDeletingNow(false);
    }
  };

  // ─── 백업/내보내기 ────────────────────────────────────────────
  // 파일 다운로드 트리거 (브라우저 표준 패턴)
  const triggerDownload = (content, mimeType, filename) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // YYYYMMDD-HHmm 형식 (파일명용)
  const timestampForFilename = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };

  // JSON 내보내기 (메타데이터 포함, 복원/이전용)
  const exportJSON = () => {
    const payload = {
      version: "1.0",
      app: "Factory Engineer AI 학습앱",
      role,
      role_label: roleInfo.label,
      exported_at: new Date().toISOString(),
      total_count: knowledge.length,
      items: knowledge.map(k => ({
        category: k.category,
        content: k.content,
        updated_at: k.updated_at || null,
      })),
    };
    const json = JSON.stringify(payload, null, 2);
    const filename = `learning-${role}-${timestampForFilename()}.json`;
    triggerDownload(json, "application/json;charset=utf-8", filename);
  };

  // CSV 내보내기 (Excel 호환)
  // - BOM 포함하여 한글이 Excel에서 깨지지 않도록 함
  // - 컴마/따옴표/줄바꿈은 표준 CSV 이스케이프
  const escapeCsvField = (val) => {
    const s = (val == null ? "" : String(val));
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const exportCSV = () => {
    const header = ["category", "content", "updated_at"];
    const lines = [header.join(",")];
    knowledge.forEach(k => {
      lines.push([
        escapeCsvField(k.category),
        escapeCsvField(k.content),
        escapeCsvField(k.updated_at),
      ].join(","));
    });
    // BOM(\uFEFF) 추가 — Excel이 UTF-8로 인식하도록
    const csv = "\uFEFF" + lines.join("\r\n");
    const filename = `learning-${role}-${timestampForFilename()}.csv`;
    triggerDownload(csv, "text/csv;charset=utf-8", filename);
  };

  // 디바운스 (입력 200ms 멈추면 필터링)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // 검색어 변경 시 페이지 사이즈 리셋
  useEffect(() => {
    setPageSize(20);
  }, [debouncedQuery, categoryFilter, sortMode]);

  // 카테고리별 카운트 (필터 칩 표시용)
  const categoryCounts = useMemo(() => {
    const counts = { "전체": knowledge.length };
    CATEGORIES.forEach(c => {
      counts[c] = knowledge.filter(k => k.category === c).length;
    });
    return counts;
  }, [knowledge]);

  // 필터링 + 정렬
  const filteredItems = useMemo(() => {
    let items = knowledge;

    if (categoryFilter !== "전체") {
      items = items.filter(k => k.category === categoryFilter);
    }

    if (debouncedQuery) {
      const q = debouncedQuery.toLowerCase();
      items = items.filter(k =>
        (k.content || "").toLowerCase().includes(q) ||
        (k.category || "").toLowerCase().includes(q)
      );
    }

    items = [...items];
    if (sortMode === "recent") {
      items.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    } else if (sortMode === "category") {
      items.sort((a, b) => (a.category || "").localeCompare(b.category || ""));
    } else if (sortMode === "length") {
      items.sort((a, b) => (b.content || "").length - (a.content || "").length);
    }

    return items;
  }, [knowledge, categoryFilter, debouncedQuery, sortMode]);

  const visibleItems = filteredItems.slice(0, pageSize);
  const hasMore = filteredItems.length > pageSize;

  return (
    <div style={{ padding:"16px 18px" }}>
      {/* 헤더 */}
      <div style={{ marginBottom:14 }}>
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:8, flexWrap:"wrap",
        }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>
              📚 학습 보관함
            </div>
            <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
              학습된 내용을 검색·열람·관리합니다 · 전체 {knowledge.length}건
            </div>
          </div>
          {/* 내보내기 버튼 그룹 */}
          {knowledge.length > 0 && (
            <div style={{ display:"flex", gap:6 }}>
              <button
                onClick={exportJSON}
                title="JSON 형식으로 다운로드 (복원·이전용 권장)"
                style={{
                  background:"rgba(167,139,250,0.1)",
                  border:"1px solid rgba(167,139,250,0.35)",
                  borderRadius:6, padding:"6px 10px",
                  color:"#a78bfa", fontSize:11, fontWeight:600,
                  cursor:"pointer",
                  display:"flex", alignItems:"center", gap:4,
                }}
              >💾 JSON</button>
              <button
                onClick={exportCSV}
                title="CSV 형식으로 다운로드 (Excel 열람용)"
                style={{
                  background:"rgba(52,211,153,0.1)",
                  border:"1px solid rgba(52,211,153,0.35)",
                  borderRadius:6, padding:"6px 10px",
                  color:"#34d399", fontSize:11, fontWeight:600,
                  cursor:"pointer",
                  display:"flex", alignItems:"center", gap:4,
                }}
              >📊 CSV</button>
            </div>
          )}
        </div>
      </div>

      {/* 검색 박스 */}
      <div style={{ position:"relative", marginBottom:12 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 검색어를 입력하세요"
          style={{
            width:"100%", padding:"11px 14px",
            paddingRight: searchQuery ? 36 : 14,
            background:"rgba(15,23,42,0.6)",
            border:"1px solid rgba(51,65,85,0.5)",
            borderRadius:10, color:"#e2e8f0",
            fontSize:13, outline:"none",
            boxSizing:"border-box",
          }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} style={{
            position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
            background:"transparent", border:"none", color:"#64748b",
            cursor:"pointer", fontSize:18, lineHeight:1,
          }}>×</button>
        )}
      </div>

      {/* 카테고리 필터 칩 */}
      <div style={{
        display:"flex", flexWrap:"wrap", gap:6, marginBottom:10,
      }}>
        {["전체", ...CATEGORIES].map(cat => {
          const isActive = categoryFilter === cat;
          const count = categoryCounts[cat] || 0;
          const disabled = count === 0 && cat !== "전체";
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              disabled={disabled}
              style={{
                padding:"6px 11px",
                background: isActive ? roleInfo.color : "rgba(30,41,59,0.5)",
                border:`1px solid ${isActive ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
                borderRadius:14,
                color: isActive ? "#fff" : "#94a3b8",
                fontSize:11, fontWeight: isActive ? 700 : 500,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.4 : 1,
              }}
            >
              {cat} {count}
            </button>
          );
        })}
      </div>

      {/* 정렬 + 결과 카운트 */}
      <div style={{
        display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:12, fontSize:11, color:"#64748b",
      }}>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value)}
          style={{
            background:"rgba(15,23,42,0.6)",
            border:"1px solid rgba(51,65,85,0.5)",
            borderRadius:6, padding:"5px 8px",
            color:"#cbd5e1", fontSize:11, cursor:"pointer",
          }}
        >
          <option value="recent">최신순</option>
          <option value="category">카테고리순</option>
          <option value="length">내용 길이순</option>
        </select>
        <span>표시: {filteredItems.length}건</span>
      </div>

      {/* 결과 카드 목록 */}
      {filteredItems.length === 0 ? (
        <div style={{
          padding:"40px 20px", textAlign:"center", color:"#64748b",
          background:"rgba(15,23,42,0.4)", borderRadius:10, fontSize:12,
        }}>
          {debouncedQuery
            ? `"${debouncedQuery}" 일치 항목 없음`
            : (knowledge.length === 0 ? "아직 학습된 내용이 없습니다" : "표시할 항목이 없습니다")}
        </div>
      ) : (
        <>
          {visibleItems.map((item, i) => {
            const isEditing = editingKey === itemKey(item);
            return (
            <div key={item.id || `${item.updated_at}-${i}`} style={{
              padding:"12px 14px",
              marginBottom:8,
              background:"rgba(30,41,59,0.4)",
              border:`1px solid ${isEditing ? roleInfo.color : "rgba(51,65,85,0.4)"}`,
              borderLeft:`3px solid ${roleInfo.color}`,
              borderRadius:8,
            }}>
              <div style={{
                display:"flex", alignItems:"center", gap:8, marginBottom:6,
                flexWrap:"wrap",
              }}>
                <span style={{
                  background:`${roleInfo.color}15`,
                  color: roleInfo.color,
                  padding:"2px 7px", borderRadius:4,
                  fontSize:10, fontWeight:700,
                }}>
                  {item.category}
                </span>
                {item.updated_at && (
                  <span style={{ fontSize:10, color:"#64748b" }}>
                    {String(item.updated_at).slice(0, 10)}
                  </span>
                )}
                {/* 편집/삭제 버튼 (편집 중이 아닐 때만) */}
                {!isEditing && (
                  <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
                    <button
                      onClick={() => startEdit(item)}
                      title="편집"
                      style={{
                        background:"rgba(51,65,85,0.4)",
                        border:"1px solid rgba(51,65,85,0.5)",
                        borderRadius:5, padding:"3px 8px",
                        color:"#94a3b8", fontSize:10, cursor:"pointer",
                      }}
                    >✏️ 편집</button>
                    <button
                      onClick={() => setDeleteTarget(item)}
                      title="삭제"
                      style={{
                        background:"rgba(239,68,68,0.1)",
                        border:"1px solid rgba(239,68,68,0.3)",
                        borderRadius:5, padding:"3px 8px",
                        color:"#f87171", fontSize:10, cursor:"pointer",
                      }}
                    >🗑️</button>
                  </div>
                )}
              </div>

              {/* 편집 모드 / 일반 모드 분기 */}
              {isEditing ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={Math.min(10, Math.max(3, Math.ceil(editText.length / 50)))}
                    style={{
                      width:"100%", padding:"8px 10px",
                      background:"rgba(15,23,42,0.7)",
                      border:`1px solid ${roleInfo.color}50`,
                      borderRadius:6, color:"#e2e8f0",
                      fontSize:12, fontFamily:"inherit", lineHeight:1.6,
                      resize:"vertical", outline:"none", boxSizing:"border-box",
                    }}
                    autoFocus
                  />
                  <div style={{ display:"flex", gap:6, marginTop:8, justifyContent:"flex-end" }}>
                    <button
                      onClick={cancelEdit}
                      disabled={savingEdit}
                      style={{
                        background:"rgba(51,65,85,0.4)",
                        border:"1px solid rgba(51,65,85,0.5)",
                        borderRadius:6, padding:"6px 12px",
                        color:"#94a3b8", fontSize:11,
                        cursor: savingEdit ? "not-allowed" : "pointer",
                      }}
                    >취소</button>
                    <button
                      onClick={() => saveEdit(item)}
                      disabled={savingEdit || !editText.trim()}
                      style={{
                        background: savingEdit || !editText.trim()
                          ? "rgba(51,65,85,0.3)"
                          : roleInfo.color,
                        border:"none", borderRadius:6,
                        padding:"6px 14px",
                        color: savingEdit || !editText.trim() ? "#475569" : "#fff",
                        fontSize:11, fontWeight:700,
                        cursor: savingEdit || !editText.trim() ? "not-allowed" : "pointer",
                        display:"flex", alignItems:"center", gap:6,
                      }}
                    >
                      {savingEdit ? <><Spinner/>저장 중</> : "저장"}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{
                  fontSize:12, color:"#cbd5e1", lineHeight:1.6,
                  wordBreak:"break-word", whiteSpace:"pre-wrap",
                }}>
                  {highlightMatch(item.content, debouncedQuery)}
                </div>
              )}
            </div>
            );
          })}

          {/* 더 보기 */}
          {hasMore && (
            <button
              onClick={() => setPageSize(p => p + 20)}
              style={{
                width:"100%", padding:"10px",
                background:"rgba(51,65,85,0.3)",
                border:"1px solid rgba(51,65,85,0.4)",
                borderRadius:8, color:"#94a3b8",
                fontSize:12, cursor:"pointer", marginTop:6,
              }}
            >
              ↓ 더 보기 (남은 {filteredItems.length - pageSize}건)
            </button>
          )}
        </>
      )}

      {/* 새로고침 */}
      <button onClick={onReload} disabled={loading} style={{
        width:"100%", padding:"10px", marginTop:14,
        background:"rgba(51,65,85,0.3)", border:"1px solid rgba(51,65,85,0.4)",
        borderRadius:8, color:"#64748b", fontSize:11, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      }}>
        {loading ? <><Spinner/>로딩 중...</> : "🔄 최신 데이터 불러오기"}
      </button>

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div style={{
          position:"fixed", inset:0,
          background:"rgba(0,0,0,0.7)", zIndex:1000,
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:20,
        }} onClick={() => !deletingNow && setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background:"#0f172a",
            border:"1px solid rgba(239,68,68,0.4)",
            borderRadius:12, padding:"20px 22px",
            maxWidth:420, width:"100%",
            boxShadow:"0 20px 50px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#f1f5f9", marginBottom:8 }}>
              🗑️ 학습 항목 삭제
            </div>
            <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:14, lineHeight:1.6 }}>
              아래 항목을 영구 삭제합니다. 이 동작은 되돌릴 수 없습니다.
            </div>
            <div style={{
              padding:"10px 12px",
              background:"rgba(15,23,42,0.7)",
              border:"1px solid rgba(51,65,85,0.4)",
              borderLeft:`3px solid ${roleInfo.color}`,
              borderRadius:6, marginBottom:16,
              fontSize:11, color:"#cbd5e1", lineHeight:1.6,
              maxHeight:140, overflowY:"auto",
              wordBreak:"break-word", whiteSpace:"pre-wrap",
            }}>
              <span style={{
                background:`${roleInfo.color}15`, color: roleInfo.color,
                padding:"1px 6px", borderRadius:3,
                fontSize:9.5, fontWeight:700, marginRight:6,
              }}>{deleteTarget.category}</span>
              {deleteTarget.content}
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deletingNow}
                style={{
                  background:"rgba(51,65,85,0.4)",
                  border:"1px solid rgba(51,65,85,0.5)",
                  borderRadius:6, padding:"8px 16px",
                  color:"#94a3b8", fontSize:12,
                  cursor: deletingNow ? "not-allowed" : "pointer",
                }}
              >취소</button>
              <button
                onClick={confirmDelete}
                disabled={deletingNow}
                style={{
                  background: deletingNow
                    ? "rgba(239,68,68,0.3)"
                    : "linear-gradient(135deg,#ef4444,#dc2626)",
                  border:"none", borderRadius:6,
                  padding:"8px 16px",
                  color:"#fff", fontSize:12, fontWeight:700,
                  cursor: deletingNow ? "not-allowed" : "pointer",
                  display:"flex", alignItems:"center", gap:6,
                }}
              >
                {deletingNow ? <><Spinner/>삭제 중</> : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabStatus({ role, roleInfo, knowledge, onReload, loading, autoConflicts = [], autoCheckBusy = false, onResolveAutoConflict, onStartRelearn, relearning = false, relearnProgress = { current:0, total:0, currentFile:"" } }) {
  const progress = calcProgress(knowledge);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null); // { conflicts: [...], scannedAt: timestamp }
  const [resolving, setResolving] = useState(null); // 현재 처리 중인 충돌 인덱스

  const CATEGORIES_TO_SCAN = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];

  // ─── 품질 진단 분석 (메모이제이션) ────────────────────────────────────
  // knowledge 또는 scanResults 변경 시에만 재계산
  const qualityReport = useMemo(() => {
    if (!knowledge || knowledge.length === 0) return null;

    // 1. 카테고리별 항목 수
    const byCategory = {};
    CATEGORIES_TO_SCAN.forEach(c => {
      byCategory[c] = knowledge.filter(k => k.category === c).length;
    });
    const totalItems = knowledge.length;
    const maxCategoryCount = Math.max(...Object.values(byCategory), 1);

    // 2. 빈/약한 카테고리 (5건 미만)
    const weakCategories = CATEGORIES_TO_SCAN.filter(c => byCategory[c] < 5);
    const emptyCategories = CATEGORIES_TO_SCAN.filter(c => byCategory[c] === 0);

    // 3. 평균 항목 길이 (단답형 감지)
    const lengths = knowledge.map(k => (k.content || "").length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const shortItems = knowledge.filter(k => (k.content || "").length < 30);
    const shortRatio = totalItems > 0 ? (shortItems.length / totalItems) * 100 : 0;

    // 4. 최근 활동 (30일 이내 갱신된 항목)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentItems = knowledge.filter(k => {
      if (!k.updated_at) return false;
      const d = new Date(k.updated_at);
      return !isNaN(d.getTime()) && d >= thirtyDaysAgo;
    });
    const stalecategories = CATEGORIES_TO_SCAN.filter(c => {
      const items = knowledge.filter(k => k.category === c);
      if (items.length === 0) return false;
      // 해당 카테고리 항목 모두가 30일 이상 갱신 안 됐는지
      return !items.some(k => {
        if (!k.updated_at) return false;
        const d = new Date(k.updated_at);
        return !isNaN(d.getTime()) && d >= thirtyDaysAgo;
      });
    });

    // 5. 미해결 충돌 (수동 풀 스캔 + 자동 점검 통합)
    const manualUnresolved = scanResults
      ? scanResults.conflicts.filter(c => !c.resolved).length
      : 0;
    const autoUnresolved = (autoConflicts || []).filter(c => !c.resolved).length;
    const unresolvedConflicts = (scanResults || autoConflicts.length > 0)
      ? manualUnresolved + autoUnresolved
      : null;

    // 6. 종합 품질 점수 (0~100)
    // - 카테고리 균형도 (30점): 가장 적은 카테고리가 평균의 몇 % 인가
    // - 분량 적정성 (25점): 평균 길이 100자 기준
    // - 단답형 비율 (15점): 단답형이 적을수록 좋음
    // - 최근 활동 (15점): 30일 내 갱신 비율
    // - 충돌 정리 (15점): 미해결 0이면 만점, scan 안 했으면 중간 점수
    const balanceScore = Math.round(
      (Math.min(...Object.values(byCategory)) / Math.max(maxCategoryCount, 1)) * 30
    );
    const lengthScore = Math.min(25, Math.round((avgLen / 100) * 25));
    const conciseScore = Math.round(15 * (1 - shortRatio / 100));
    const freshScore = totalItems > 0
      ? Math.round((recentItems.length / totalItems) * 15)
      : 0;
    const conflictScore = unresolvedConflicts == null
      ? 8 // 검사 안 함 — 중간 점수
      : (unresolvedConflicts === 0 ? 15 : Math.max(0, 15 - unresolvedConflicts * 3));
    const totalScore = balanceScore + lengthScore + conciseScore + freshScore + conflictScore;

    // 7. 추천 액션
    const recommendations = [];
    if (emptyCategories.length > 0) {
      recommendations.push(`"${emptyCategories[0]}" 카테고리가 비어 있음 — 학습 추가 필요`);
    } else if (weakCategories.length > 0) {
      recommendations.push(`"${weakCategories[0]}" 카테고리 보강 권장 (현재 ${byCategory[weakCategories[0]]}건)`);
    }
    if (shortRatio > 20) {
      recommendations.push(`단답형 항목이 ${shortRatio.toFixed(0)}% — 더 자세히 입력 권장`);
    }
    if (stalecategories.length > 0) {
      recommendations.push(`"${stalecategories[0]}" 30일째 갱신 없음 — 최신화 검토`);
    }
    if (unresolvedConflicts && unresolvedConflicts > 0) {
      if (autoUnresolved > 0) {
        recommendations.push(`자동 감지된 충돌 ${autoUnresolved}건 — 아래 "자동 감지 결과"에서 검토`);
      }
      if (manualUnresolved > 0) {
        recommendations.push(`수동 검사 미해결 ${manualUnresolved}건 — 아래 "데이터 정리"에서 검토`);
      }
    }
    if (unresolvedConflicts == null && totalItems >= 10) {
      recommendations.push(`"전체 검사"를 실행해 중복/충돌을 확인해 보세요`);
    }

    // 빈약 자동학습 항목 감지 (Step 7-11 v2)
    // 헬퍼: isWeakAutoItem (다중 신호 기반)
    // - v10 이전 프롬프트 표지 ([시각 설명] 블록) → 강한 신호
    // - 분량 < 500자 → 짧은 빈약
    // - 페이지당 평균 < 150자 → 정보 밀도 낮음
    const weakAutoItems = knowledge.filter(k => isWeakAutoItem(k.content));
    if (weakAutoItems.length > 0) {
      recommendations.push(`빈약 자동학습 항목 ${weakAutoItems.length}건 — 아래 "재학습"으로 품질 개선 가능`);
    }

    if (recommendations.length === 0) {
      recommendations.push(`✨ 학습 상태 양호 — 꾸준히 업데이트하세요`);
    }

    return {
      totalScore, byCategory, totalItems, maxCategoryCount,
      weakCategories, emptyCategories, stalecategories,
      avgLen, shortItems, shortRatio,
      recentItems, unresolvedConflicts,
      weakAutoItems,
      recommendations,
      breakdown: { balanceScore, lengthScore, conciseScore, freshScore, conflictScore },
    };
  }, [knowledge, scanResults, autoConflicts]);

  // 품질 점수 색상
  const qualityColor = (score) => {
    if (score >= 80) return "#34d399"; // green
    if (score >= 60) return "#fbbf24"; // amber
    if (score >= 40) return "#fb923c"; // orange
    return "#f87171"; // red
  };

  // 카테고리별 풀 검사 (Step 3 수동 검사)
  const startFullScan = async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const allConflicts = [];

      for (const category of CATEGORIES_TO_SCAN) {
        const items = knowledge.filter(k => k.category === category);
        if (items.length < 2) continue; // 비교할 데이터 부족

        // 너무 많으면 최근 30건까지만
        const targets = items.slice(-30);
        const targetsText = targets.map((it, i) => `${i + 1}. ${it.content}`).join("\n");

        const sys = `당신은 학습 데이터 검증자입니다. 아래 ${category} 카테고리 항목들 중 서로 중복(같은 의미)이거나 충돌(같은 주제이지만 내용 다름)하는 쌍을 찾아주세요.

[항목들]
${targetsText}

[판단 기준]
- duplicate: 같은 의미를 다른 표현으로 작성
- conflict: 같은 주제인데 수치/절차/기준이 다름

JSON으로만 답하세요. 충돌 없으면 빈 배열.

응답 형식:
{"pairs":[{"a":1,"b":3,"type":"duplicate|conflict","reason":"한 줄 사유"}]}`;

        try {
          const raw = await callClaude(sys, "검사 결과를 JSON으로 답하세요.");
          const parsed = safeJSON(raw);

          if (parsed.pairs && Array.isArray(parsed.pairs)) {
            for (const pair of parsed.pairs) {
              if (pair.a >= 1 && pair.a <= targets.length &&
                  pair.b >= 1 && pair.b <= targets.length && pair.a !== pair.b) {
                allConflicts.push({
                  category,
                  itemA: targets[pair.a - 1],
                  itemB: targets[pair.b - 1],
                  type: pair.type || "conflict",
                  reason: pair.reason || "",
                  resolved: false,
                });
              }
            }
          }
        } catch {
          // 카테고리별 검사 실패해도 다음 진행
          continue;
        }
      }

      setScanResults({
        conflicts: allConflicts,
        scannedAt: new Date().toLocaleTimeString("ko-KR"),
      });
    } catch (e) {
      alert("검사 실패: " + e.message);
    } finally {
      setScanning(false);
    }
  };

  // 충돌 해결 처리 (A 유지 / B 유지 / 둘 다 / 건너뛰기)
  const resolveConflict = async (idx, choice) => {
    setResolving(idx);
    try {
      const c = scanResults.conflicts[idx];
      if (choice === "keep_a") {
        // A 유지 → B 삭제
        await deleteKnowledge(role, c.category, c.itemB.content);
      } else if (choice === "keep_b") {
        // B 유지 → A 삭제
        await deleteKnowledge(role, c.category, c.itemA.content);
      }
      // keep_both / skip은 둘 다 유지 (아무것도 안 함)

      // 해당 항목 처리됨 표시
      setScanResults(r => ({
        ...r,
        conflicts: r.conflicts.map((cf, i) =>
          i === idx ? { ...cf, resolved: true, resolvedAs: choice } : cf
        ),
      }));
    } catch (e) {
      alert("처리 실패: " + e.message);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>🧠 학습 현황</div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          구글 시트에 저장된 학습 내용 및 수준
        </div>
      </div>

      {/* 전체 학습도 */}
      <div style={{
        background:`${roleInfo.color}08`, border:`1px solid ${roleInfo.color}25`,
        borderRadius:12, padding:"16px 18px", marginBottom:16, textAlign:"center",
      }}>
        <div style={{ fontSize:36, fontWeight:900, color:roleInfo.color, marginBottom:4 }}>
          {progress["전체"]}%
        </div>
        <div style={{ fontSize:11, color:"#64748b" }}>{roleInfo.label} 전체 학습도</div>
      </div>

      {/* 항목별 */}
      {["공장정보","업무역할","판단기준","협업방식","교정사례"].map(cat => (
        <ProgressBar key={cat} label={cat} value={progress[cat]||0} color={roleInfo.color}/>
      ))}

      {/* ─── 품질 진단 ─── */}
      {qualityReport && (
        <div style={{
          marginTop:18, padding:"14px 16px",
          background:"rgba(15,23,42,0.5)",
          border:"1px solid rgba(51,65,85,0.4)",
          borderRadius:10,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#cbd5e1" }}>
              📊 학습 품질 진단
            </div>
            <div style={{
              padding:"3px 10px",
              background: `${qualityColor(qualityReport.totalScore)}20`,
              border: `1px solid ${qualityColor(qualityReport.totalScore)}50`,
              borderRadius:12,
              color: qualityColor(qualityReport.totalScore),
              fontSize:11, fontWeight:800,
            }}>
              {qualityReport.totalScore}/100
            </div>
          </div>

          {/* 점수 막대 */}
          <div style={{
            height:6, background:"rgba(51,65,85,0.4)", borderRadius:3,
            overflow:"hidden", marginBottom:14,
          }}>
            <div style={{
              width:`${qualityReport.totalScore}%`, height:"100%",
              background: qualityColor(qualityReport.totalScore),
              transition:"width 0.4s ease",
            }}/>
          </div>

          {/* 카테고리 균형도 */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10.5, color:"#94a3b8", fontWeight:700, marginBottom:6 }}>
              📊 카테고리 균형도
            </div>
            {CATEGORIES_TO_SCAN.map(cat => {
              const count = qualityReport.byCategory[cat];
              const pct = qualityReport.maxCategoryCount > 0
                ? (count / qualityReport.maxCategoryCount) * 100
                : 0;
              const isWeak = count < 5;
              return (
                <div key={cat} style={{ marginBottom:5, display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ fontSize:10, color:"#94a3b8", width:60, flexShrink:0 }}>{cat}</div>
                  <div style={{
                    flex:1, height:6, background:"rgba(51,65,85,0.3)",
                    borderRadius:3, overflow:"hidden",
                  }}>
                    <div style={{
                      width:`${pct}%`, height:"100%",
                      background: isWeak ? "#f87171" : roleInfo.color,
                      opacity: count === 0 ? 0.3 : 1,
                    }}/>
                  </div>
                  <div style={{
                    fontSize:9.5, color: isWeak ? "#f87171" : "#64748b",
                    width:30, textAlign:"right", flexShrink:0,
                  }}>{count}건</div>
                </div>
              );
            })}
          </div>

          {/* 데이터 건강도 지표 그리드 */}
          <div style={{
            display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14,
          }}>
            <div style={{
              padding:"8px 10px",
              background:"rgba(30,41,59,0.5)",
              borderRadius:6, borderLeft:"3px solid #34d399",
            }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>평균 분량</div>
              <div style={{ fontSize:13, fontWeight:700, color:"#cbd5e1" }}>
                {Math.round(qualityReport.avgLen)}<span style={{ fontSize:9, color:"#64748b", fontWeight:400 }}>자</span>
              </div>
            </div>
            <div style={{
              padding:"8px 10px",
              background:"rgba(30,41,59,0.5)",
              borderRadius:6,
              borderLeft: `3px solid ${qualityReport.shortRatio > 20 ? "#fb923c" : "#34d399"}`,
            }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>단답형 비율</div>
              <div style={{
                fontSize:13, fontWeight:700,
                color: qualityReport.shortRatio > 20 ? "#fb923c" : "#cbd5e1",
              }}>
                {qualityReport.shortRatio.toFixed(0)}<span style={{ fontSize:9, color:"#64748b", fontWeight:400 }}>%</span>
              </div>
            </div>
            <div style={{
              padding:"8px 10px",
              background:"rgba(30,41,59,0.5)",
              borderRadius:6, borderLeft:"3px solid #a78bfa",
            }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>최근 30일 갱신</div>
              <div style={{ fontSize:13, fontWeight:700, color:"#cbd5e1" }}>
                {qualityReport.recentItems.length}<span style={{ fontSize:9, color:"#64748b", fontWeight:400 }}>/{qualityReport.totalItems}건</span>
              </div>
            </div>
            <div style={{
              padding:"8px 10px",
              background:"rgba(30,41,59,0.5)",
              borderRadius:6,
              borderLeft: `3px solid ${
                qualityReport.unresolvedConflicts == null ? "#64748b"
                  : qualityReport.unresolvedConflicts === 0 ? "#34d399"
                  : "#f87171"
              }`,
            }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>미해결 충돌</div>
              <div style={{
                fontSize:13, fontWeight:700,
                color: qualityReport.unresolvedConflicts == null ? "#64748b"
                  : qualityReport.unresolvedConflicts === 0 ? "#34d399"
                  : "#f87171",
              }}>
                {qualityReport.unresolvedConflicts == null
                  ? "—"
                  : <>{qualityReport.unresolvedConflicts}<span style={{ fontSize:9, color:"#64748b", fontWeight:400 }}>건</span></>
                }
              </div>
            </div>
          </div>

          {/* 추천 액션 */}
          <div style={{
            padding:"10px 12px",
            background:"rgba(167,139,250,0.06)",
            border:"1px solid rgba(167,139,250,0.2)",
            borderRadius:8,
          }}>
            <div style={{ fontSize:10.5, color:"#a78bfa", fontWeight:700, marginBottom:6 }}>
              💡 추천 다음 행동
            </div>
            {qualityReport.recommendations.map((rec, i) => (
              <div key={i} style={{
                fontSize:11, color:"#cbd5e1", lineHeight:1.6,
                paddingLeft: rec.startsWith("✨") ? 0 : 12,
                position:"relative",
              }}>
                {!rec.startsWith("✨") && (
                  <span style={{
                    position:"absolute", left:0, top:0,
                    color:"#a78bfa",
                  }}>→</span>
                )}
                {rec}
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={onReload} disabled={loading} style={{
        width:"100%", padding:"10px", marginTop:8,
        background:"rgba(51,65,85,0.3)", border:"1px solid rgba(51,65,85,0.4)",
        borderRadius:8, color:"#64748b", fontSize:12, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      }}>
        {loading ? <><Spinner/>로딩 중...</> : "🔄 최신 데이터 불러오기"}
      </button>

      {/* ─── 빈약 데이터 재학습 (Step 7-11) ─── */}
      {qualityReport && qualityReport.weakAutoItems && qualityReport.weakAutoItems.length > 0 && (
        <div style={{
          marginTop:18, padding:"14px 16px",
          background:"rgba(99,102,241,0.05)",
          border:"1px solid rgba(99,102,241,0.25)",
          borderRadius:10,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#cbd5e1" }}>
              🔄 빈약 학습 데이터 재학습
            </div>
            <span style={{
              background:"rgba(99,102,241,0.15)",
              border:"1px solid rgba(99,102,241,0.3)",
              borderRadius:10, padding:"2px 8px",
              fontSize:9.5, fontWeight:700, color:"#a5b4fc",
            }}>{qualityReport.weakAutoItems.length}건</span>
          </div>
          <div style={{ fontSize:10.5, color:"#64748b", marginBottom:10, lineHeight:1.6 }}>
            200자 제한 시기에 학습된 빈약한 자동학습 항목들을 Drive 폴더 원본으로 다시 분석하여
            품질을 개선합니다. (현재 v10 프롬프트 적용, 청크 분할 자동)
          </div>

          {relearning ? (
            <div>
              <div style={{ fontSize:11, color:"#cbd5e1", marginBottom:6 }}>
                ⏳ {relearnProgress.current}/{relearnProgress.total} — {relearnProgress.currentFile || "준비 중..."}
              </div>
              <div style={{
                height:6, background:"rgba(51,65,85,0.4)", borderRadius:3, overflow:"hidden",
              }}>
                <div style={{
                  width: relearnProgress.total > 0
                    ? `${(relearnProgress.current / relearnProgress.total) * 100}%` : "0%",
                  height:"100%", background:"#a5b4fc",
                  transition:"width 0.3s ease",
                }}/>
              </div>
            </div>
          ) : (
            <button
              onClick={onStartRelearn}
              style={{
                width:"100%", padding:"10px",
                background:"rgba(99,102,241,0.15)",
                border:"1px solid rgba(99,102,241,0.4)",
                borderRadius:6, color:"#a5b4fc",
                fontSize:12, fontWeight:700, cursor:"pointer",
              }}
            >📥 재학습 시작 ({qualityReport.weakAutoItems.length}건)</button>
          )}
        </div>
      )}

      {/* ─── 자동 감지 결과 (Step 7-4) ─── */}
      {(autoConflicts.length > 0 || autoCheckBusy) && (
        <div style={{
          marginTop:18, padding:"14px 16px",
          background:"rgba(245,158,11,0.05)",
          border:"1px solid rgba(245,158,11,0.25)",
          borderRadius:10,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#cbd5e1" }}>
              ⚡ 자동 감지 결과
            </div>
            {autoCheckBusy && (
              <span style={{
                background:"rgba(100,116,139,0.15)",
                border:"1px solid rgba(100,116,139,0.3)",
                borderRadius:10, padding:"2px 8px",
                fontSize:9.5, fontWeight:700, color:"#94a3b8",
                display:"flex", alignItems:"center", gap:4,
              }}><Spinner/>점검 중</span>
            )}
          </div>
          <div style={{ fontSize:10.5, color:"#64748b", marginBottom:10, lineHeight:1.6 }}>
            새로 추가된 학습 항목과 기존 항목 간 중복/충돌을 자동으로 검사한 결과입니다.
            (브라우저 세션에만 저장 · 새로고침 시 초기화)
          </div>

          {autoConflicts.length === 0 && !autoCheckBusy ? null : autoConflicts.length === 0 ? (
            <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center", padding:"10px 0" }}>
              현재 검사 진행 중...
            </div>
          ) : (
            autoConflicts.map((c, idx) => (
              <div key={idx} style={{
                background:"rgba(15,23,42,0.6)",
                border:`1px solid ${c.resolved ? "rgba(52,211,153,0.4)" : "rgba(245,158,11,0.3)"}`,
                borderRadius:8, padding:"12px 14px", marginBottom:10,
                opacity: c.resolved ? 0.6 : 1,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                  <span style={{
                    background: c.type === "duplicate" ? "rgba(167,139,250,0.2)" : "rgba(245,158,11,0.2)",
                    color: c.type === "duplicate" ? "#a78bfa" : "#fbbf24",
                    padding:"2px 7px", borderRadius:4, fontSize:9, fontWeight:800,
                  }}>{c.type === "duplicate" ? "중복" : "충돌"}</span>
                  <span style={{ fontSize:10, color:"#64748b" }}>
                    {c.itemA.category}
                    {c.itemA.category !== c.itemB.category && ` ↔ ${c.itemB.category}`}
                  </span>
                  {c.resolved && (
                    <span style={{ marginLeft:"auto", fontSize:10, color:"#34d399", fontWeight:700 }}>
                      ✓ 처리됨
                    </span>
                  )}
                </div>

                {c.reason && (
                  <div style={{ fontSize:10.5, color:"#94a3b8", marginBottom:8, fontStyle:"italic" }}>
                    {c.reason}
                  </div>
                )}

                <div style={{ marginBottom:6 }}>
                  <div style={{ fontSize:9.5, color:"#64748b", fontWeight:700, marginBottom:3 }}>새 항목 (A)</div>
                  <div style={{
                    fontSize:11, color:"#cbd5e1",
                    background:"rgba(30,41,59,0.5)", padding:"6px 9px", borderRadius:5,
                    borderLeft:`2px solid ${roleInfo.color}`,
                    lineHeight:1.5, wordBreak:"break-word", whiteSpace:"pre-wrap",
                  }}>{c.itemA.content}</div>
                </div>
                <div style={{ marginBottom:c.resolved ? 0 : 8 }}>
                  <div style={{ fontSize:9.5, color:"#64748b", fontWeight:700, marginBottom:3 }}>기존 항목 (B)</div>
                  <div style={{
                    fontSize:11, color:"#cbd5e1",
                    background:"rgba(30,41,59,0.5)", padding:"6px 9px", borderRadius:5,
                    borderLeft:"2px solid rgba(100,116,139,0.5)",
                    lineHeight:1.5, wordBreak:"break-word", whiteSpace:"pre-wrap",
                  }}>{c.itemB.content}</div>
                </div>

                {!c.resolved && onResolveAutoConflict && (
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    <button
                      onClick={() => onResolveAutoConflict(idx, "skip")}
                      style={{
                        flex:1, padding:"6px 8px",
                        background:"rgba(51,65,85,0.4)",
                        border:"1px solid rgba(51,65,85,0.5)",
                        borderRadius:5, color:"#94a3b8", fontSize:10,
                        cursor:"pointer", fontWeight:600,
                      }}
                    >건너뛰기</button>
                    <button
                      onClick={async () => {
                        // 새 항목 삭제 (B 유지)
                        try {
                          await deleteKnowledge(role, c.itemA.category, c.itemA.content);
                          onResolveAutoConflict(idx, "keep_b");
                          await onReload();
                        } catch (e) { alert("처리 실패"); }
                      }}
                      style={{
                        flex:1, padding:"6px 8px",
                        background:"rgba(239,68,68,0.1)",
                        border:"1px solid rgba(239,68,68,0.3)",
                        borderRadius:5, color:"#f87171", fontSize:10,
                        cursor:"pointer", fontWeight:600,
                      }}
                    >A 삭제</button>
                    <button
                      onClick={async () => {
                        // 기존 항목 삭제 (A 유지)
                        try {
                          await deleteKnowledge(role, c.itemB.category, c.itemB.content);
                          onResolveAutoConflict(idx, "keep_a");
                          await onReload();
                        } catch (e) { alert("처리 실패"); }
                      }}
                      style={{
                        flex:1, padding:"6px 8px",
                        background:"rgba(239,68,68,0.1)",
                        border:"1px solid rgba(239,68,68,0.3)",
                        borderRadius:5, color:"#f87171", fontSize:10,
                        cursor:"pointer", fontWeight:600,
                      }}
                    >B 삭제</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 데이터 정리 (풀 검사) */}
      <div style={{
        marginTop:18, padding:"14px 16px",
        background:"rgba(167,139,250,0.05)",
        border:"1px solid rgba(167,139,250,0.2)",
        borderRadius:10,
      }}>
        <div style={{ fontSize:13, fontWeight:700, color:"#cbd5e1", marginBottom:4 }}>
          🔍 학습 데이터 정리
        </div>
        <div style={{ fontSize:10.5, color:"#64748b", marginBottom:10, lineHeight:1.6 }}>
          카테고리별 중복/충돌을 한꺼번에 검토합니다. (약 30초~1분 소요)
        </div>
        <button onClick={startFullScan} disabled={scanning || knowledge.length < 2} style={{
          width:"100%", padding:"10px",
          background: scanning || knowledge.length < 2 ? "rgba(51,65,85,0.3)" : "linear-gradient(135deg,#a78bfa,#7c3aed)",
          border:"none", borderRadius:8,
          color: scanning || knowledge.length < 2 ? "#475569" : "#fff",
          fontSize:12, fontWeight:700,
          cursor: scanning || knowledge.length < 2 ? "not-allowed" : "pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        }}>
          {scanning ? <><Spinner/>검사 중...</> : "🔎 전체 검사 시작"}
        </button>

        {/* 검사 결과 표시 */}
        {scanResults && (
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:11, color:"#94a3b8", marginBottom:10 }}>
              {scanResults.conflicts.length === 0
                ? `✅ 검사 완료 (${scanResults.scannedAt}) — 정리할 항목 없음`
                : `⚠️ ${scanResults.conflicts.length}쌍의 중복/충돌 발견 (${scanResults.scannedAt})`
              }
            </div>

            {scanResults.conflicts.map((c, idx) => (
              <div key={idx} style={{
                background:"rgba(15,23,42,0.6)",
                border:`1px solid ${c.resolved ? "rgba(52,211,153,0.4)" : "rgba(245,158,11,0.3)"}`,
                borderRadius:8, padding:"12px 14px", marginBottom:10,
                opacity: c.resolved ? 0.6 : 1,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                  <span style={{
                    background: c.type === "duplicate" ? "rgba(167,139,250,0.2)" : "rgba(245,158,11,0.2)",
                    color: c.type === "duplicate" ? "#a78bfa" : "#fbbf24",
                    padding:"2px 7px", borderRadius:4, fontSize:9, fontWeight:800,
                  }}>{c.type === "duplicate" ? "중복" : "충돌"}</span>
                  <span style={{ fontSize:10, color:"#64748b" }}>{c.category}</span>
                  {c.resolved && (
                    <span style={{ marginLeft:"auto", fontSize:10, color:"#34d399", fontWeight:700 }}>
                      ✓ 처리됨 ({c.resolvedAs === "keep_a" ? "A 유지" :
                                c.resolvedAs === "keep_b" ? "B 유지" :
                                c.resolvedAs === "keep_both" ? "둘 다" : "건너뜀"})
                    </span>
                  )}
                </div>

                {c.reason && (
                  <div style={{ fontSize:10.5, color:"#94a3b8", marginBottom:8, fontStyle:"italic" }}>
                    {c.reason}
                  </div>
                )}

                <div style={{ marginBottom:6 }}>
                  <div style={{ fontSize:9.5, color:"#64748b", fontWeight:700, marginBottom:3 }}>A</div>
                  <div style={{
                    background:"rgba(8,14,26,0.6)", padding:"7px 10px",
                    borderRadius:5, fontSize:11, color:"#cbd5e1", lineHeight:1.5,
                  }}>{c.itemA.content}</div>
                </div>
                <div style={{ marginBottom: c.resolved ? 0 : 10 }}>
                  <div style={{ fontSize:9.5, color:"#64748b", fontWeight:700, marginBottom:3 }}>B</div>
                  <div style={{
                    background:"rgba(8,14,26,0.6)", padding:"7px 10px",
                    borderRadius:5, fontSize:11, color:"#cbd5e1", lineHeight:1.5,
                  }}>{c.itemB.content}</div>
                </div>

                {!c.resolved && (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:5 }}>
                    <button onClick={() => resolveConflict(idx, "keep_a")}
                      disabled={resolving === idx} style={smallBtnStyle("#34d399")}>
                      A 유지
                    </button>
                    <button onClick={() => resolveConflict(idx, "keep_b")}
                      disabled={resolving === idx} style={smallBtnStyle("#3b82f6")}>
                      B 유지
                    </button>
                    <button onClick={() => resolveConflict(idx, "keep_both")}
                      disabled={resolving === idx} style={smallBtnStyle("#a78bfa")}>
                      둘 다 유지
                    </button>
                    <button onClick={() => resolveConflict(idx, "skip")}
                      disabled={resolving === idx} style={smallBtnStyle("#64748b")}>
                      건너뛰기
                    </button>
                  </div>
                )}
              </div>
            ))}

            {scanResults.conflicts.length > 0 && (
              <div style={{ fontSize:10, color:"#64748b", marginTop:6, textAlign:"center" }}>
                💡 처리 후 "최신 데이터 불러오기"로 새로고침하세요
              </div>
            )}
          </div>
        )}
      </div>

      {/* 저장된 내용 */}
      {knowledge.length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, color:"#374151", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
            📋 저장된 학습 내용 ({knowledge.length}건)
          </div>
          {knowledge.map((k,i) => {
            // [이미지URL] https://... 패턴 추출
            const urlMatch = k.content && k.content.match(/\[이미지URL\]\s*(https?:\/\/[^\s\n]+)/);
            const imageUrl = urlMatch ? urlMatch[1] : null;
            // URL 라인을 제외한 나머지 텍스트 (가독성을 위해)
            const contentWithoutUrl = imageUrl
              ? k.content.replace(/\[이미지URL\]\s*https?:\/\/[^\s\n]+\n?/, "")
              : k.content;

            return (
              <div key={i} style={{
                background:"rgba(8,14,26,0.7)", border:"1px solid rgba(51,65,85,0.3)",
                borderRadius:8, padding:"10px 13px", marginBottom:7,
              }}>
                <div style={{
                  display:"flex", alignItems:"center", gap:8, marginBottom:4,
                }}>
                  <div style={{ fontSize:10, color:roleInfo.color, fontWeight:700 }}>
                    {k.category}
                  </div>
                  {imageUrl && (
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer" style={{
                      fontSize:10, color:"#93c5fd", textDecoration:"none",
                      background:"rgba(59,130,246,0.12)", padding:"2px 7px",
                      borderRadius:4, border:"1px solid rgba(59,130,246,0.25)",
                    }}>
                      🖼️ 이미지 보기
                    </a>
                  )}
                </div>
                <div style={{ fontSize:11.5, color:"#94a3b8", lineHeight:1.6,
                  whiteSpace:"pre-wrap" }}>
                  {contentWithoutUrl}
                </div>
                <div style={{ fontSize:9.5, color:"#374151", marginTop:4 }}>{k.updated_at}</div>
              </div>
            );
          })}
        </div>
      )}

      {knowledge.length === 0 && !loading && (
        <div style={{ textAlign:"center", padding:"30px 0", color:"#374151" }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
          <div style={{ fontSize:12 }}>아직 학습된 내용이 없어요</div>
          <div style={{ fontSize:10, marginTop:4 }}>STEP 1~3을 진행하면 여기에 쌓입니다</div>
        </div>
      )}
    </div>
  );
}

// ─── 전체 학습 대시보드 (에이전트 선택 화면용) ────────────────────────────────
function HomeDashboard() {
  const [data, setData] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const raw = await loadAllProgress();
      if (raw.length === 0) {
        setError("데이터를 불러올 수 없습니다");
        setLoading(false);
        return;
      }
      const merged = raw.map(a => ({
        ...a,
        line: DASHBOARD_AGENT_META[a.role]?.line || "공통",
        roleType: DASHBOARD_AGENT_META[a.role]?.role || "-",
        agentColor: DASHBOARD_AGENT_META[a.role]?.color || "#94a3b8",
      }));
      setData(merged);
    } catch (e) {
      setError(`로드 실패: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const enriched = data.length > 0
    ? data.map(a => ({ ...a, ...calcDashboardScore(a) }))
        .sort((a, b) => b.totalScore - a.totalScore)
    : [];

  if (loading && enriched.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"40px 0", color:"#64748b" }}>
        <Spinner/>
        <div style={{ marginTop:10, fontSize:12 }}>학습 데이터 로딩 중...</div>
      </div>
    );
  }

  if (error && enriched.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"30px 0" }}>
        <div style={{ fontSize:24, marginBottom:6 }}>⚠️</div>
        <div style={{ fontSize:12, color:"#ef4444", marginBottom:12 }}>{error}</div>
        <button onClick={fetchData} style={{
          padding:"7px 16px", background:"rgba(59,130,246,0.15)",
          border:"1px solid rgba(59,130,246,0.3)", borderRadius:7,
          color:"#93c5fd", fontSize:11, fontWeight:700, cursor:"pointer",
        }}>🔄 다시 시도</button>
      </div>
    );
  }

  // 통계
  const avgScore = Math.round(enriched.reduce((s, a) => s + a.totalScore, 0) / enriched.length);
  const cellAgents = enriched.filter(a => a.line === "Cell");
  const elecAgents = enriched.filter(a => a.line === "Elec");
  const cellAvg = cellAgents.length > 0
    ? Math.round(cellAgents.reduce((s, a) => s + a.totalScore, 0) / cellAgents.length) : 0;
  const elecAvg = elecAgents.length > 0
    ? Math.round(elecAgents.reduce((s, a) => s + a.totalScore, 0) / elecAgents.length) : 0;
  const totalItems = enriched.reduce((s, a) => s + (a.itemCount || 0), 0);
  const totalCorrections = enriched.reduce((s, a) => s + (a.correctionCount || 0), 0);

  const sel = selected || enriched[0];
  const maxItem = Math.max(...enriched.map(a => a.itemCount || 0), 1);

  return (
    <div style={{ textAlign:"left" }}>
      {/* KPI 5개 */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:6, marginBottom:18 }}>
        <KpiCard label="전체" value={avgScore} suffix="점" color="#a78bfa" />
        <KpiCard label="Cell" value={cellAvg} suffix="점" color={LINE_COLORS.Cell} />
        <KpiCard label="Elec" value={elecAvg} suffix="점" color={LINE_COLORS.Elec} />
        <KpiCard label="학습" value={totalItems} suffix="건" color="#34d399" />
        <KpiCard label="교정" value={totalCorrections} suffix="건" color="#fbbf24" />
      </div>

      {/* 종합 순위 */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:11, color:"#64748b", fontWeight:700, marginBottom:8, letterSpacing:1 }}>
          🏆 종합 순위
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {enriched.map((a, idx) => (
            <RankRow key={a.role} rank={idx+1} agent={a}
              isSelected={sel?.role === a.role}
              onClick={() => setSelected(a)} />
          ))}
        </div>
      </div>

      {/* 선택된 에이전트 상세 */}
      {sel && (
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:"#64748b", fontWeight:700, marginBottom:8, letterSpacing:1 }}>
            🔍 {sel.role} 상세 · {sel.line} · {sel.roleType}
          </div>
          <div style={{
            background:"rgba(15,23,42,0.6)",
            border:`1px solid ${sel.agentColor}25`,
            borderRadius:10, padding:14,
          }}>
            <ProgressBar label={`학습 항목 (${sel.itemCount}건)`} value={sel.itemScore} color={sel.agentColor} />
            <ProgressBar label={`내용 총량 (${sel.contentLength.toLocaleString()}자)`} value={sel.contentScore} color={sel.agentColor} />
            <ProgressBar label={`카테고리 (${sel.categoryCount}종)`} value={sel.categoryScore} color={sel.agentColor} />
            <ProgressBar label={`교정 사례 (${sel.correctionCount}건)`} value={sel.correctionScore} color={sel.agentColor} />
            <ProgressBar label={`최신성 (최근 7일 ${sel.recentRate}%)`} value={sel.freshnessScore} color={sel.agentColor} />

            <div style={{
              marginTop:8, paddingTop:8,
              borderTop:"1px solid rgba(51,65,85,0.4)",
              display:"flex", justifyContent:"space-between", fontSize:10,
            }}>
              <span style={{ color:"#64748b" }}>마지막 업데이트</span>
              <span style={{ color:"#cbd5e1", fontWeight:700 }}>
                {sel.lastUpdate || "데이터 없음"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 학습 항목 비교 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, color:"#64748b", fontWeight:700, marginBottom:8, letterSpacing:1 }}>
          📈 학습 항목 수
        </div>
        <div style={{
          background:"rgba(15,23,42,0.5)", border:"1px solid rgba(51,65,85,0.3)",
          borderRadius:10, padding:12,
        }}>
          {enriched.map(a => (
            <div key={a.role} style={{ marginBottom:7 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span style={{ fontSize:10.5, color:"#cbd5e1", fontWeight:600 }}>
                  <span style={{ color: a.agentColor, marginRight:5 }}>●</span>{a.role}
                </span>
                <span style={{ fontSize:10.5, color: a.agentColor, fontWeight:700 }}>
                  {a.itemCount}건
                </span>
              </div>
              <div style={{ height:5, background:"rgba(51,65,85,0.5)", borderRadius:3 }}>
                <div style={{
                  height:"100%", borderRadius:3,
                  width:`${(a.itemCount/maxItem)*100}%`,
                  background:`linear-gradient(90deg, ${a.agentColor}, ${a.agentColor}99)`,
                  transition:"width 0.5s ease",
                }}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 지표 설명 */}
      <div style={{
        background:"rgba(8,14,26,0.6)", border:"1px solid rgba(51,65,85,0.3)",
        borderRadius:8, padding:"10px 12px", fontSize:9.5, color:"#64748b",
        lineHeight:1.7,
      }}>
        <div style={{ fontWeight:700, color:"#94a3b8", marginBottom:5 }}>📖 평가 지표 (5개 평균, 절대평가)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>학습 항목</b>: 등록된 row 수 (목표 300건)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>내용 총량</b>: content 글자수 합계 (목표 80,000자)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>카테고리</b>: unique category 개수 (목표 5종)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>교정 사례</b>: 교정사례 카테고리 row 수 (목표 60건)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>최신성</b>: 최근 7일 내 업데이트 비율 (목표 70%)</div>
      </div>
    </div>
  );
}

// 대시보드 - KPI 카드
function KpiCard({ label, value, suffix, color }) {
  return (
    <div style={{
      background:"rgba(15,23,42,0.7)",
      border:"1px solid rgba(51,65,85,0.4)",
      borderLeft:`3px solid ${color}`,
      borderRadius:7, padding:"8px 10px",
    }}>
      <div style={{ fontSize:9, color:"#64748b", fontWeight:700, marginBottom:2,
        letterSpacing:1, textTransform:"uppercase" }}>{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
        <span style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>{value}</span>
        <span style={{ fontSize:10, color:"#475569" }}>{suffix}</span>
      </div>
    </div>
  );
}

// 대시보드 - 순위 행
function RankRow({ rank, agent, isSelected, onClick }) {
  return (
    <div onClick={onClick} style={{
      display:"grid",
      gridTemplateColumns:"24px 1fr auto auto",
      gap:10, alignItems:"center", padding:"8px 10px",
      background: isSelected ? "rgba(51,65,85,0.5)" : "rgba(8,14,26,0.6)",
      border: `1px solid ${isSelected ? agent.agentColor : "rgba(51,65,85,0.35)"}`,
      borderRadius:7, cursor:"pointer", transition:"all 0.15s",
    }}>
      <div style={{
        width:22, height:22, borderRadius:11,
        background: rank <= 3 ? "#fbbf24" : "rgba(71,85,105,0.6)",
        color: rank <= 3 ? "#1e293b" : "#cbd5e1",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:11, fontWeight:800,
      }}>{rank}</div>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:"#f1f5f9" }}>{agent.role}</div>
        <div style={{ fontSize:9.5, color:"#64748b" }}>
          <span style={{ color: agent.agentColor }}>●</span> {agent.line} · {agent.roleType}
        </div>
      </div>
      <div style={{
        fontSize:9, padding:"2px 7px", borderRadius:9,
        background: SCORE_COLOR(agent.totalScore) + "25",
        color: SCORE_COLOR(agent.totalScore), fontWeight:700,
      }}>{SCORE_LABEL(agent.totalScore)}</div>
      <div style={{
        fontSize:16, fontWeight:800, color:"#f1f5f9",
        minWidth:32, textAlign:"right",
      }}>{agent.totalScore}</div>
    </div>
  );
}

// ─── 메인 앱 ─────────────────────────────────────────────────────────────────
const TABS = [
  { id:0, icon:"💬", label:"채팅 학습" },
  { id:1, icon:"📋", label:"업무 규칙" },
  { id:2, icon:"🎯", label:"상황 교정" },
  { id:3, icon:"📄", label:"문서·사진" },
  { id:4, icon:"📚", label:"보관함" },
  { id:5, icon:"🧠", label:"학습 현황" },
];

export default function App() {
  const role = getRole();
  const roleInfo = role ? ROLE_CONFIG[role] : null;
  const [tab, setTab] = useState(0);
  const [knowledge, setKnowledge] = useState([]);
  const [loadingKB, setLoadingKB] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // ─── 학습자료 폴더 동기화 (Step 5-C) ───
  const [folderScan, setFolderScan] = useState({ roleFiles: [], commonFiles: [] });
  const [scanning, setScanning] = useState(false);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncingFiles, setSyncingFiles] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, currentFile: "" });
  const [syncResult, setSyncResult] = useState(null);
  const [showPdfModeDialog, setShowPdfModeDialog] = useState(false); // PDF 모드 선택 모달
  const [syncPdfMode, setSyncPdfMode] = useState("auto"); // "auto" | "vision"

  // ─── 일관성 자동 점검 (Step 7-4) ───
  // autoConflicts: 자동 감지된 충돌/중복 (세션 메모리에만 보관, 브라우저 재시작 시 초기화)
  const [autoConflicts, setAutoConflicts] = useState([]);
  // 마지막으로 검사한 시점의 knowledge 스냅샷 (signature 비교용)
  const lastCheckedSignatureRef = useRef(null);
  // 현재 점검 진행 중인지 (중복 호출 방지)
  const checkingRef = useRef(false);
  const [autoCheckBusy, setAutoCheckBusy] = useState(false);

  // ─── 빈약 데이터 재학습 (Step 7-11) ─────────────────────────────────
  // 상태: 모달 표시, 진행률, 결과
  const [showRelearnDialog, setShowRelearnDialog] = useState(false);
  const [relearning, setRelearning] = useState(false);
  const [relearnProgress, setRelearnProgress] = useState({ current: 0, total: 0, currentFile: "" });
  const [relearnResult, setRelearnResult] = useState(null);
  const relearnCancelRef = useRef(false);

  // 빈약 항목에서 파일명 추출 (v14: prefix별 명시 패턴, 공백 허용)
  // 시트의 실제 prefix 형태:
  //   [자동학습-제작사양서/220421 OHT 제작 사양서 v1.3.pdf] ← 공백 포함
  //   [파일: 1000228935.jpg]
  //   [PDF: my-file.pdf - 그림 분석, 11페이지]
  // 공통: 대괄호 ] 가 종료자. 그 안에 공백 허용.
  const extractFilenameFromWeakItem = (content) => {
    if (!content) return null;
    const head = content.slice(0, 500);
    // 3가지 prefix 패턴별 매칭 (대괄호 안 ] 직전까지)
    const patterns = [
      /\[자동학습-([^\]]+?\.(?:pdf|png|jpg|jpeg))\]/i,
      /\[파일:\s*([^\]]+?\.(?:pdf|png|jpg|jpeg))\s*\]/i,
      /\[PDF:\s*([^\]\s]+(?:\s+[^\]\s]+)*?\.pdf)/i,
    ];
    for (const pat of patterns) {
      const m = head.match(pat);
      if (m) {
        let fname = m[1].trim();
        // subPath 제거 — basename만
        fname = fname.split("/").pop().split("\\").pop();
        return fname.trim();
      }
    }
    return null;
  };

  // 재학습 실행
  // - weakItems: 시트의 빈약 항목 배열
  // - 폴더 스캔 결과(folderScan)에서 파일명 매칭
  // - 매칭된 파일을 새 학습 흐름으로 다시 분석 → saveToSheet (청크 분할 자동 적용)
  // - 학습 성공 시 기존 빈약 항목 deleteKnowledge로 삭제
  const startRelearn = async (weakItems) => {
    setRelearning(true);
    relearnCancelRef.current = false;
    setRelearnResult(null);

    // 재학습 전용 폴더 스캔 (Step 7-11 v6)
    // - scan_learning_folder는 Processed_Files 필터링으로 이미 학습된 파일을 제외함
    // - 재학습은 정작 그 파일들이 필요하므로 _all 액션 사용
    // - 기존 folderScan state(학습 화면용)는 무시하고 항상 새로 스캔
    let scan = { roleFiles: [], commonFiles: [] };
    try {
      const res = await fetch(`${APPS_SCRIPT_URL}?action=scan_learning_folder_all&role=${role}`);
      const data = await res.json();
      if (data.success) {
        scan = { roleFiles: data.roleFiles || [], commonFiles: data.commonFiles || [] };
      } else {
        console.error("[재학습] 폴더 스캔 실패:", data.error);
      }
    } catch (e) {
      console.error("[재학습] 폴더 스캔 오류:", e);
    }
    const allFolderFiles = [...(scan.roleFiles || []), ...(scan.commonFiles || [])];

    // 빈약 항목별 매칭 (v13: basename 비교 — subPath/대소문자 영향 없도록)
    const matched = []; // { weakItem, file }
    const notFound = []; // weakItem (Drive에 파일 없음)
    const getBasename = (p) => (p || "").split("/").pop().split("\\").pop().trim();
    for (const w of weakItems) {
      const fname = extractFilenameFromWeakItem(w.content);
      if (!fname) {
        notFound.push({ item: w, reason: "파일명 추출 불가" });
        continue;
      }
      const fnameBase = getBasename(fname).toLowerCase();
      const file = allFolderFiles.find(f => getBasename(f.filename).toLowerCase() === fnameBase);
      if (!file) {
        notFound.push({ item: w, reason: `Drive에 '${fname}' 없음` });
        continue;
      }
      matched.push({ weakItem: w, file });
    }

    setRelearnProgress({ current: 0, total: matched.length, currentFile: "" });

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < matched.length; i++) {
      if (relearnCancelRef.current) break;

      const { weakItem, file } = matched[i];
      setRelearnProgress({ current: i + 1, total: matched.length, currentFile: file.filename });

      try {
        // 1. 파일 다운로드
        const fetchResult = await fetchDriveFile(file.fileId);
        if (!fetchResult.success) {
          failCount++;
          errors.push(`${file.filename}: 다운로드 실패 — ${fetchResult.error}`);
          continue;
        }
        const fileData = fetchResult.data;
        const isImageFile = (fileData.mimetype || "").startsWith("image/");
        const isPdfFile = (fileData.mimetype || "").includes("pdf") ||
                          (file.filename || "").toLowerCase().endsWith(".pdf");

        // v19: 저장할 row 배열 — 이미지는 1개, PDF Vision은 페이지 수만큼
        //   각 원소: { content, sourceMeta }
        let rowsToSave = [];
        let category = weakItem.category || "공장정보"; // 기존 카테고리 유지

        if (isImageFile) {
          // 단일 이미지 재학습 (v19: 5블록 + sourceMeta)
          const folderHint = file.subPath ? `\n폴더 경로: ${file.subPath}` : "";
          const sys = `당신은 ${roleInfo.label}(${role}) AI입니다.
이 이미지에서 ${role} 업무 관련 핵심 내용을 추출하세요.${folderHint}

이미지가 매뉴얼·작업 지시서·도면·사양서·표 형식이면 단계·수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출. 글자수 제한 없음. **표가 있으면 헤더 행과 모든 데이터 행을 셀 단위로 짚어 추출 — 셀 안의 모든 텍스트·숫자·단위 빠뜨리지 말 것.**

다음 5블록 형식:
[추출 텍스트] (이미지의 실제 내용. 구체값 빠뜨리지 말 것)
[핵심 정보] (이 이미지가 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일이 보이면 기재)
[챕터/섹션] (이미지 상단·헤더 영역에 보이는 챕터 또는 섹션 제목. 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)
[추천 카테고리] 공장정보|업무역할|판단기준|협업방식|교정사례 중 하나`;
          const analyzed = await callClaudeVision(sys, "이 이미지를 분석하세요.", fileData.base64, fileData.mimetype);
          const catMatch = analyzed.match(/\[추천 카테고리\]\s*([가-힣]+)/);
          if (catMatch && ["공장정보","업무역할","판단기준","협업방식","교정사례"].includes(catMatch[1])) {
            category = catMatch[1];
          }
          const newContent = `[파일: ${file.filename}] ${analyzed}`;
          const section = parseChapterFromAnalysis(analyzed);
          const sourceMeta = buildSourceMeta(file.filename, "", section, file.url);
          rowsToSave.push({ content: newContent, sourceMeta });
        } else if (isPdfFile) {
          // PDF 재학습 (v19): 목차 파싱 → 페이지별 4블록 → 페이지별 row N개 저장
          // - 카테고리는 기존 weakItem.category 유지 (재학습이므로)
          if (!window.pdfjsLib) {
            await loadPdfjs();
          }
          const pdf = await window.pdfjsLib.getDocument({ data: base64ToUint8Array(fileData.base64) }).promise;
          const pageCount = pdf.numPages;
          const outlineMap = await extractPdfOutline(pdf);
          let lastSection = "";

          for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            if (relearnCancelRef.current) break;
            const pageBase64 = await pdfPageToBase64(pdf, pageNum);
            const folderHint = file.subPath ? `\n폴더 경로: ${file.subPath}` : "";
            const pagePrompt = `${roleInfo.label}(${role}) AI입니다. PDF 페이지 ${pageNum}/${pageCount} 분석.${folderHint}

페이지가 매뉴얼·작업 지시서·도면·사양서·표 형식이면 단계 번호·구체 수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출. 글자수 제한 없음. **표가 있으면 헤더 행과 모든 데이터 행을 셀 단위로 짚어 추출 — 항목명·대수·사양·비고 등 셀 안의 모든 텍스트·숫자·단위 빠뜨리지 말 것.**

다음 4블록 형식:
[추출 텍스트] (페이지의 실제 내용. 구체값 빠뜨리지 말 것)
[핵심 정보] (이 페이지가 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일, 페이지 번호 등이 보이면 기재)
[챕터/섹션] (페이지 상단·헤더 영역에 보이는 챕터 또는 섹션 제목. 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)`;

            let pageRes = "";
            let isError = false;
            try {
              pageRes = await callClaudeVision(pagePrompt, "이 PDF 페이지를 분석하세요.", pageBase64, "image/jpeg");
            } catch (e) {
              isError = true;
              pageRes = `(분석 실패: ${e.message || "알 수 없는 오류"})`;
            }

            if (isError) continue; // 분석 실패 페이지는 row 만들지 않음

            // 챕터 결정: 목차 → Vision → 직전 페이지 상속 → 빈 칸
            let section = outlineMap[pageNum] || "";
            if (!section) section = parseChapterFromAnalysis(pageRes);
            if (!section) section = lastSection;
            if (section) lastSection = section;

            const pageContent = `[파일: ${file.filename}] [PDF 페이지 ${pageNum}/${pageCount}]\n${pageRes}`;
            const sourceMeta = buildSourceMeta(
              file.filename,
              String(pageNum),
              section,
              file.url ? `${file.url}#page=${pageNum}` : ""
            );
            rowsToSave.push({ content: pageContent, sourceMeta });
          }
        } else {
          failCount++;
          errors.push(`${file.filename}: 지원 안 되는 형식`);
          continue;
        }

        if (rowsToSave.length === 0) {
          failCount++;
          errors.push(`${file.filename}: 분석 결과 없음`);
          continue;
        }

        // 2. 기존 빈약 항목 + 같은 파일의 동료 row 모두 삭제 (v14)
        //    한 파일이 시트에 여러 row로 분리 저장된 구조 반영
        //    - 메타 row, [종합 요약] row, [페이지N] row 등 동료들 모두 정리
        //    - 식별: 같은 파일명이 content에 포함된 모든 row (백워드 호환)
        try {
          await deleteKnowledge(role, weakItem.category, weakItem.content);

          // 같은 파일의 동료 row들도 삭제
          const companionRows = knowledge.filter(k => {
            if (!k.content || k.content === weakItem.content) return false;
            return k.content.includes(file.filename);
          });
          for (const companion of companionRows) {
            try {
              await deleteKnowledge(role, companion.category, companion.content);
              console.log(`[재학습] 동료 row 삭제: ${companion.content.slice(0, 60)}...`);
            } catch (compErr) {
              console.warn("[재학습] 동료 row 삭제 실패:", compErr);
            }
          }
        } catch (delErr) {
          console.warn("[재학습] 기존 항목 삭제 실패 (계속 진행):", delErr);
        }

        // 3. 새 학습 결과 저장 (v19: 페이지별 N개 row + sourceMeta)
        let rowOkCount = 0;
        for (const row of rowsToSave) {
          try {
            const ok = await saveToSheet(role, category, row.content, row.sourceMeta);
            if (ok) rowOkCount++;
          } catch (saveErr) {
            console.error(`[재학습] row 저장 실패:`, saveErr);
          }
        }
        if (rowOkCount > 0) {
          successCount++;
        } else {
          failCount++;
          errors.push(`${file.filename}: 모든 row 저장 실패`);
        }

      } catch (e) {
        failCount++;
        errors.push(`${file.filename}: ${e.message || "알 수 없는 오류"}`);
        console.error("[재학습] 처리 실패:", file.filename, e);
      }
    }

    // 완료 — 결과 보고
    setRelearnResult({
      total: matched.length,
      success: successCount,
      failed: failCount,
      notFound: notFound,
      errors,
      cancelled: relearnCancelRef.current,
    });
    setRelearning(false);

    // 시트 다시 로드
    await loadKB();
  };

  const cancelRelearn = () => {
    relearnCancelRef.current = true;
  };

  // base64 → Uint8Array (PDF 처리용)
  const base64ToUint8Array = (b64) => {
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes;
  };

  // loadKB — 캐시 우선 + 백그라운드 갱신 (Step 7-12)
  // - 캐시 있으면 즉시 setKnowledge (사용자 체감 빠름)
  // - 백그라운드에서 신선한 데이터 fetch → 차이 있으면 다시 setKnowledge
  // - 캐시 없으면 일반 로드
  const loadKB = async (forceFresh = false) => {
    if (!role) return;

    if (forceFresh) {
      // 명시적 새로고침 — 캐시 무시
      setLoadingKB(true);
      try {
        const fresh = await loadFromSheetFresh(role);
        setKnowledge(fresh);
      } catch {}
      finally { setLoadingKB(false); }
      return;
    }

    // 캐시 즉시 표시 (있으면)
    const cached = readCache(role);
    if (cached) {
      setKnowledge(cached.data);
      setLoadingKB(false);
      // 백그라운드 갱신 (UI 블록 안 함)
      (async () => {
        try {
          const fresh = await fetchKnowledgeFromSheet(role);
          if (fresh.length > 0) {
            writeCache(role, fresh);
            // 데이터 달라졌으면 갱신 (단순 비교: 길이 또는 마지막 항목)
            const lastCached = cached.data[cached.data.length - 1]?.content || "";
            const lastFresh = fresh[fresh.length - 1]?.content || "";
            if (fresh.length !== cached.data.length || lastFresh !== lastCached) {
              setKnowledge(fresh);
            }
          }
        } catch {}
      })();
      return;
    }

    // 캐시 없음 — 일반 로드
    setLoadingKB(true);
    try {
      const data = await loadFromSheet(role);
      setKnowledge(data);
    } catch {}
    finally { setLoadingKB(false); }
  };

  // ─── 일관성 자동 점검: knowledge 변경 감지 → 신규 항목 백그라운드 비교 ───
  // 동작 원리:
  // 1. knowledge가 처음 로드되면 lastCheckedSignature를 저장하고 점검 안 함 (기존 데이터)
  // 2. 이후 knowledge가 늘어나면 새 항목들만 추출해 checkConsistencyForItem 호출
  // 3. role이 바뀌면 autoConflicts와 signature 모두 초기화
  useEffect(() => {
    // 역할 변경 시 초기화
    setAutoConflicts([]);
    lastCheckedSignatureRef.current = null;
    checkingRef.current = false;
    setAutoCheckBusy(false);
  }, [role]);

  useEffect(() => {
    if (!role || !knowledge || knowledge.length === 0) return;
    if (checkingRef.current) return; // 진행 중이면 스킵

    // signature: 항목 식별 (category|content|updated_at)
    const buildSig = (k) => `${k.category}|${k.content}|${k.updated_at || ""}`;
    const currentSigs = new Set(knowledge.map(buildSig));

    // 첫 로드: signature만 저장하고 점검 X
    if (lastCheckedSignatureRef.current === null) {
      lastCheckedSignatureRef.current = currentSigs;
      return;
    }

    // 신규 항목 추출
    const newItems = knowledge.filter(k => !lastCheckedSignatureRef.current.has(buildSig(k)));
    if (newItems.length === 0) {
      // 추가된 항목 없음 (삭제만 일어났을 수 있음) → signature만 갱신
      lastCheckedSignatureRef.current = currentSigs;
      return;
    }

    // 백그라운드 점검 (non-blocking)
    checkingRef.current = true;
    setAutoCheckBusy(true);
    (async () => {
      try {
        const allFindings = [];
        // 신규 항목이 너무 많으면 최근 5건까지만 (대량 일괄 학습 시 토큰 폭주 방지)
        const targets = newItems.slice(-5);
        for (const item of targets) {
          // 비교 대상은 점검 시점의 신규 외 기존 데이터
          const existing = knowledge.filter(k => buildSig(k) !== buildSig(item));
          const findings = await checkConsistencyForItem(item, existing);
          if (findings.length > 0) allFindings.push(...findings);
        }
        if (allFindings.length > 0) {
          setAutoConflicts(prev => {
            // 같은 쌍 중복 추가 방지
            const seen = new Set(prev.map(c =>
              `${c.itemA.category}|${c.itemA.content}|${c.itemB.category}|${c.itemB.content}`
            ));
            const fresh = allFindings.filter(c =>
              !seen.has(`${c.itemA.category}|${c.itemA.content}|${c.itemB.category}|${c.itemB.content}`)
            );
            return [...prev, ...fresh];
          });
        }
      } catch (e) {
        console.warn("[자동 점검] 실패:", e.message);
      } finally {
        lastCheckedSignatureRef.current = currentSigs;
        checkingRef.current = false;
        setAutoCheckBusy(false);
      }
    })();
  }, [knowledge, role]);

  // 충돌을 해결됨으로 표시 (TabStatus에서 사용)
  const markAutoConflictResolved = (idx, resolvedAs) => {
    setAutoConflicts(prev => prev.map((c, i) =>
      i === idx ? { ...c, resolved: true, resolvedAs } : c
    ));
  };

  // 학습자료 폴더 스캔 (학습 화면 진입 시 자동)
  const doFolderScan = async () => {
    if (!role) return;
    setScanning(true);
    try {
      const result = await scanLearningFolder(role);
      setFolderScan(result);
    } catch {}
    finally { setScanning(false); }
  };

  useEffect(() => { loadKB(); }, [role]);
  useEffect(() => { doFolderScan(); }, [role]);

  // 새 파일 일괄 학습
  // PDF가 포함되어 있으면 먼저 모달로 처리 방식 선택받은 후 진행
  const requestSync = () => {
    const allFiles = [
      ...folderScan.roleFiles,
      ...folderScan.commonFiles,
    ];
    const hasPdf = allFiles.some(f => (f.mimetype || "").includes("pdf") || (f.filename || "").toLowerCase().endsWith(".pdf"));
    if (hasPdf) {
      // PDF가 있으면 처리 방식 선택 모달
      setShowPdfModeDialog(true);
    } else {
      // 이미지만 있으면 바로 진행
      startSync();
    }
  };

  const startSync = async () => {
    setShowPdfModeDialog(false);
    setSyncingFiles(true);
    setSyncResult(null);
    const allFiles = [
      ...folderScan.roleFiles.map(f => ({ ...f, source: "role" })),
      ...folderScan.commonFiles.map(f => ({ ...f, source: "common" })),
    ];
    setSyncProgress({ current: 0, total: allFiles.length, currentFile: "" });

    let successCount = 0;
    let failCount = 0;
    let pdfTextCount = 0;
    let pdfVisionCount = 0;
    const errors = [];

    for (let i = 0; i < allFiles.length; i++) {
      const f = allFiles[i];
      // 진행 표시: 폴더 경로 + 파일명
      const displayName = f.subPath ? `${f.subPath}/${f.filename}` : f.filename;
      setSyncProgress({ current: i + 1, total: allFiles.length, currentFile: displayName });

      try {
        // 1. 파일 다운로드
        const fetchResult = await fetchDriveFile(f.fileId);
        if (!fetchResult.success) {
          failCount++;
          errors.push(`${displayName}: ${fetchResult.error}`);
          console.error(`[Sync] 다운로드 실패: ${displayName}`, fetchResult.error);
          continue;
        }
        const fileData = fetchResult.data;

        const isImageFile = (fileData.mimetype || "").startsWith("image/");
        const isPdfFile = (fileData.mimetype || "").includes("pdf") || (f.filename || "").toLowerCase().endsWith(".pdf");

        if (isImageFile) {
          // ─── 이미지 처리 (v19: 5블록 + sourceMeta) ───
          const folderHint = f.subPath ? `\n폴더 경로: ${f.subPath} (분류 힌트로 활용)` : "";
          const sys = `당신은 ${roleInfo.label}(${role}) AI입니다.
이 이미지에서 ${role} 업무 관련 핵심 내용을 추출하세요.${folderHint}

이미지가 매뉴얼·작업 지시서·도면·사양서·표 형식이면 단계·수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출. 글자수 제한 없음. **표가 있으면 헤더 행과 모든 데이터 행을 셀 단위로 짚어 추출 — 셀 안의 모든 텍스트·숫자·단위 빠뜨리지 말 것.**

다음 5블록 형식:
[추출 텍스트] (이미지의 실제 내용. 단계·수치·버튼명·부품명·치수 등 구체값 빠뜨리지 말 것)
[핵심 정보] (이 이미지가 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일이 보이면 기재)
[챕터/섹션] (이미지 상단·헤더 영역에 보이는 챕터 또는 섹션 제목. 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)
[추천 카테고리] 공장정보|업무역할|판단기준|협업방식|교정사례 중 하나`;

          const analyzed = await callClaudeVision(sys, "이 이미지를 분석하세요.", fileData.base64, fileData.mimetype);
          const catMatch = analyzed.match(/\[추천 카테고리\]\s*([가-힣]+)/);
          const recommendedCat = catMatch ? catMatch[1] : "판단기준";
          const sourceTag = f.subPath ? `[자동학습-${f.subPath}/${f.filename}]` : `[자동학습-${f.filename}]`;
          const content = `${sourceTag} [이미지URL] ${f.url}\n${analyzed}`;
          // v19: sourceMeta (file/page=빈칸/section/url=Drive 이미지 URL)
          const section = parseChapterFromAnalysis(analyzed);
          const sourceMeta = buildSourceMeta(f.filename, "", section, f.url);
          if (f.source === "common") {
            await saveCommonKnowledge(recommendedCat, content, sourceMeta);
          } else {
            await saveToSheet(role, recommendedCat, content, sourceMeta);
          }
          await markFileProcessed(f.source === "common" ? "_COMMON_" : role, f.fileId, f.filename);
          successCount++;
        } else if (isPdfFile) {
          // ─── PDF 처리 (학습앱 직접 업로드와 동일 로직) ───
          // base64 → Blob → File로 변환해서 pdf.js에 전달
          const byteChars = atob(fileData.base64);
          const byteNumbers = new Array(byteChars.length);
          for (let j = 0; j < byteChars.length; j++) {
            byteNumbers[j] = byteChars.charCodeAt(j);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: "application/pdf" });
          const fileObj = new File([blob], f.filename, { type: "application/pdf" });

          const pdf = await loadPdfDocument(fileObj);
          const pageCount = pdf.numPages;

          let pdfResult = "";
          let usedMode = "";

          // 텍스트 추출 우선 모드면 먼저 시도
          if (syncPdfMode === "auto") {
            setSyncProgress({ current: i + 1, total: allFiles.length, currentFile: `${displayName} (텍스트 추출 시도...)` });
            const fullText = await extractPdfText(pdf);

            if (fullText && fullText.trim().length >= 50) {
              // 텍스트 추출 성공 (v19: 5블록 형식)
              const folderHint = f.subPath ? `\n폴더 경로: ${f.subPath} (분류 힌트)` : "";
              const sys = `${roleInfo.label}(${role}) AI입니다. PDF에서 추출한 텍스트입니다.${folderHint}
한국어로 핵심 내용만 정리하되, 학습 가치 있는 구체 정보(수치·부품명·단계 등)는 빠뜨리지 마세요.
표/구조가 있으면 살려서 정리하세요.

다음 5블록 형식:
[추출 텍스트] (원문에서 학습 가치 있는 내용. 1000자 이내 권장)
[핵심 정보] (이 문서가 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일이 보이면 기재)
[챕터/섹션] (이 문서의 주요 챕터/섹션 제목. 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)
[추천 카테고리] 공장정보|업무역할|판단기준|협업방식|교정사례 중 하나`;
              const truncated = fullText.slice(0, 12000);
              pdfResult = await callClaude(sys, `다음 PDF 내용에서 핵심을 추출하세요:\n\n${truncated}`);
              pdfResult = `[PDF: ${f.filename} - 텍스트 추출, ${pageCount}페이지]\n${pdfResult}`;
              usedMode = "text";
              pdfTextCount++;
            } else {
              // 텍스트 부족 → 그림 분석으로 폴백
              usedMode = "vision_fallback";
            }
          }

          // 그림 분석 모드 (또는 폴백) — v19: 페이지별 N개 row 저장 + 챕터 보존
          if (syncPdfMode === "vision" || usedMode === "vision_fallback") {
            // 1) 목차 파싱
            const outlineMap = await extractPdfOutline(pdf);

            // 2) 페이지별 분석
            const pagePayloads = []; // { pageNum, pageContent, section, isError, imageUrl }
            const pageUrls = [];
            let lastSection = "";
            let firstPageRecommendedCat = ""; // 첫 페이지에서 추출 (PDF 전체 카테고리)

            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
              setSyncProgress({
                current: i + 1, total: allFiles.length,
                currentFile: `${displayName} (페이지 ${pageNum}/${pageCount} 분석 중...)`,
              });

              const pageBase64 = await pdfPageToBase64(pdf, pageNum);
              const pageFilename = `${f.filename.replace(/\.pdf$/i, "")}_p${pageNum}.jpg`;

              // 드라이브 업로드
              let pageUrl = "";
              try {
                const uploadResult = await uploadImageToDrive(role, pageFilename, pageBase64, "image/jpeg");
                if (uploadResult && uploadResult.url) pageUrl = uploadResult.url;
              } catch (e) { /* 업로드 실패해도 분석은 계속 */ }
              pageUrls.push(pageUrl);

              // Vision 분석 (v19: 4블록, 첫 페이지만 [추천 카테고리]까지 5블록)
              const folderHint = f.subPath ? `\n폴더 경로: ${f.subPath}` : "";
              const isFirstPage = pageNum === 1;
              const pagePrompt = isFirstPage
                ? `${roleInfo.label}(${role}) AI입니다. PDF 페이지 ${pageNum}/${pageCount} 분석.${folderHint}

페이지가 매뉴얼·작업 지시서·도면·사양서·표 형식이면 단계 번호·구체 수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출. 글자수 제한 없음. **표가 있으면 헤더 행과 모든 데이터 행을 셀 단위로 짚어 추출.**

다음 5블록 형식:
[추출 텍스트] (페이지의 실제 내용. 단계·수치·버튼명·부품명·치수 등 구체값 빠뜨리지 말 것)
[핵심 정보] (이 페이지가 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일이 보이면 기재)
[챕터/섹션] (페이지 상단·헤더 영역에 보이는 챕터 또는 섹션 제목. 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)
[추천 카테고리] 공장정보|업무역할|판단기준|협업방식|교정사례 중 하나 (PDF 전체 카테고리)`
                : `${roleInfo.label}(${role}) AI입니다. PDF 페이지 ${pageNum}/${pageCount} 분석.${folderHint}

페이지가 매뉴얼·작업 지시서·도면·사양서·표 형식이면 단계 번호·구체 수치·버튼/레버 이름·부품명·치수를 빠짐없이 한국어로 추출. 글자수 제한 없음. **표가 있으면 헤더 행과 모든 데이터 행을 셀 단위로 짚어 추출.**

다음 4블록 형식:
[추출 텍스트] (페이지의 실제 내용. 단계·수치·버튼명·부품명·치수 등 구체값 빠뜨리지 말 것)
[핵심 정보] (이 페이지가 다루는 공정·설비·이슈 — 한 문장)
[메타데이터] (문서 제목, Rev, 작성일이 보이면 기재)
[챕터/섹션] (페이지 상단·헤더 영역에 보이는 챕터 또는 섹션 제목. 보이지 않으면 빈 칸. "없음" 같은 단어 쓰지 말 것)`;

              let pageContent = "";
              let isError = false;
              try {
                pageContent = await callClaudeVision(pagePrompt, "이 PDF 페이지를 분석하세요.", pageBase64, "image/jpeg");
              } catch (e) {
                isError = true;
                pageContent = `(분석 실패: ${e.message || "알 수 없는 오류"})`;
              }

              // 첫 페이지: 카테고리 추출 (PDF 전체 카테고리로 사용)
              if (isFirstPage && !isError) {
                const catMatch = pageContent.match(/\[추천 카테고리\]\s*([가-힣]+)/);
                if (catMatch && ["공장정보","업무역할","판단기준","협업방식","교정사례"].includes(catMatch[1])) {
                  firstPageRecommendedCat = catMatch[1];
                }
              }

              // 챕터 결정: 목차 → Vision 응답 → 직전 페이지 상속 → 빈 칸
              let section = outlineMap[pageNum] || "";
              if (!section && !isError) {
                section = parseChapterFromAnalysis(pageContent);
              }
              if (!section) section = lastSection;
              if (section) lastSection = section;

              pagePayloads.push({ pageNum, pageContent, section, isError, imageUrl: pageUrl });
            }

            // 3) PDF 전체 카테고리 결정 (첫 페이지 추천, 폴백: 판단기준)
            const recommendedCat = firstPageRecommendedCat || "판단기준";

            // 4) 페이지별 row 저장 (각 페이지 = 1 row)
            const fallbackTag = usedMode === "vision_fallback" ? " (텍스트 부족으로 자동 전환)" : "";
            const sourceTag = f.subPath ? `[자동학습-${f.subPath}/${f.filename}]` : `[자동학습-${f.filename}]`;
            let pageOkCount = 0;
            for (const p of pagePayloads) {
              if (p.isError) continue; // 분석 실패 페이지 건너뜀
              const pageContent = `${sourceTag} [PDF 페이지 ${p.pageNum}/${pageCount}${fallbackTag}]\n${p.pageContent}`;
              const sourceMeta = buildSourceMeta(
                f.filename,
                String(p.pageNum),
                p.section,
                f.url ? `${f.url}#page=${p.pageNum}` : ""
              );
              try {
                if (f.source === "common") {
                  await saveCommonKnowledge(recommendedCat, pageContent, sourceMeta);
                } else {
                  await saveToSheet(role, recommendedCat, pageContent, sourceMeta);
                }
                pageOkCount++;
              } catch (saveErr) {
                console.error(`[Sync] 페이지 ${p.pageNum} 저장 실패:`, saveErr);
              }
            }

            await markFileProcessed(f.source === "common" ? "_COMMON_" : role, f.fileId, f.filename);
            pdfVisionCount++;
            if (pageOkCount > 0) {
              successCount++;
            } else {
              failCount++;
              errors.push(`${displayName}: 모든 페이지 저장 실패`);
            }
            continue; // Vision 모드 처리 완료 — 아래 텍스트 모드 저장 분기 건너뜀
          }

          // 텍스트 모드 저장 (Vision 모드는 위에서 continue로 빠짐)
          // v19: sourceMeta 추가 (page 빈 칸, section은 응답에서 추출, url=f.url)
          const catMatch = pdfResult.match(/\[추천 카테고리\]\s*([가-힣]+)/);
          const recommendedCat = catMatch ? catMatch[1] : "판단기준";
          const sourceTag = f.subPath ? `[자동학습-${f.subPath}/${f.filename}]` : `[자동학습-${f.filename}]`;
          const content = `${sourceTag}\n${pdfResult}`;
          const section = parseChapterFromAnalysis(pdfResult);
          const sourceMeta = buildSourceMeta(f.filename, "", section, f.url);

          if (f.source === "common") {
            await saveCommonKnowledge(recommendedCat, content, sourceMeta);
          } else {
            await saveToSheet(role, recommendedCat, content, sourceMeta);
          }
          await markFileProcessed(f.source === "common" ? "_COMMON_" : role, f.fileId, f.filename);
          successCount++;
        } else {
          // 그 외 파일 (Word/Excel 등) - 미지원
          failCount++;
          errors.push(`${displayName}: 미지원 파일 형식 (${fileData.mimetype}) - PDF로 변환 권장`);
          await markFileProcessed(f.source === "common" ? "_COMMON_" : role, f.fileId, f.filename);
          continue;
        }
      } catch (e) {
        failCount++;
        errors.push(`${displayName}: ${e.message}`);
      }
    }

    setSyncResult({ successCount, failCount, errors, pdfTextCount, pdfVisionCount });
    setSyncingFiles(false);
    await doFolderScan();
    await loadKB();
  };

  // role 없을 때 - 에이전트 선택 화면
  if (!role) {
    return (
      <div style={{
        minHeight:"100vh",
        background:"linear-gradient(150deg,#03060d,#060d1c 55%,#040810)",
        fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
        padding:"40px 16px",
      }}>
        <div style={{ maxWidth:660, margin:"0 auto" }}>
          {/* 헤더 */}
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontSize:40, marginBottom:14 }}>🏭</div>
            <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>
              Factory Engineer AI 학습
            </div>
            <div style={{ fontSize:13, color:"#64748b" }}>
              역할을 선택해서 접속하세요
            </div>
          </div>

          {/* 에이전트 선택 카드 */}
          {["Cell","Elec","공통"].map(line => (
            <div key={line} style={{ marginBottom:24 }}>
              <div style={{ fontSize:12, color:"#64748b", fontWeight:800,
                letterSpacing:2, marginBottom:12, textAlign:"center" }}>
                {line === "공통" ? "공통" : `${line} 라인`}
              </div>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                {Object.entries(ROLE_CONFIG)
                  .filter(([_, info]) => info.line === line)
                  .map(([r, info]) => (
                    <a key={r} href={`?role=${r}`} onClick={(e)=>{e.preventDefault();window.location.href=`?role=${r}`;}} style={{
                      display:"block", padding:"14px 18px",
                      background:info.bg, border:`1.5px solid ${info.color}40`,
                      borderRadius:12, color:info.color,
                      fontSize:13, fontWeight:800, textDecoration:"none",
                      transition:"all 0.2s", textAlign:"center",
                    }}>
                      <div style={{ fontSize:24, marginBottom:5 }}>{info.icon}</div>
                      <div>{r}</div>
                      <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>{info.label}</div>
                    </a>
                  ))
                }
              </div>
            </div>
          ))}

          {/* 학습 현황 보기 토글 */}
          <div style={{ marginTop:32, marginBottom:8 }}>
            <button onClick={() => setShowDashboard(s => !s)} style={{
              width:"100%", padding:"14px 20px",
              background: showDashboard ? "rgba(167,139,250,0.12)" : "rgba(15,23,42,0.7)",
              border: `1.5px solid ${showDashboard ? "rgba(167,139,250,0.4)" : "rgba(51,65,85,0.5)"}`,
              borderRadius:12,
              color: showDashboard ? "#a78bfa" : "#94a3b8",
              fontSize:13, fontWeight:800, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"space-between",
              transition:"all 0.2s",
            }}>
              <span>📊 전체 학습 현황 보기</span>
              <span style={{
                fontSize:14,
                transform: showDashboard ? "rotate(180deg)" : "rotate(0deg)",
                transition:"transform 0.3s",
              }}>▼</span>
            </button>
          </div>

          {/* 토글 펼침 영역 */}
          {showDashboard && (
            <div style={{
              marginTop:14,
              padding:"18px 16px",
              background:"rgba(8,14,26,0.6)",
              border:"1px solid rgba(51,65,85,0.4)",
              borderRadius:12,
              animation:"fadeUp 0.3s ease both",
            }}>
              <HomeDashboard/>
            </div>
          )}
        </div>

        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
          *{box-sizing:border-box}
          button:hover:not(:disabled){filter:brightness(1.1)}
          a:hover{filter:brightness(1.1)}
          ::-webkit-scrollbar{width:3px}
          ::-webkit-scrollbar-thumb{background:rgba(59,130,246,0.2);border-radius:2px}
        `}</style>
      </div>
    );
  }

  const panels = [
    <TabChat role={role} roleInfo={roleInfo}/>,
    <TabRules role={role} roleInfo={roleInfo}/>,
    <TabCorrection role={role} roleInfo={roleInfo} knowledge={knowledge}/>,
    <TabDocument role={role} roleInfo={roleInfo}/>,
    <TabLibrary role={role} roleInfo={roleInfo} knowledge={knowledge} onReload={loadKB} loading={loadingKB}/>,
    <TabStatus role={role} roleInfo={roleInfo} knowledge={knowledge} onReload={loadKB} loading={loadingKB}
      autoConflicts={autoConflicts}
      autoCheckBusy={autoCheckBusy}
      onResolveAutoConflict={markAutoConflictResolved}
      onStartRelearn={() => setShowRelearnDialog(true)}
      relearning={relearning}
      relearnProgress={relearnProgress}/>,
  ];

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(150deg,#03060d,#060d1c 55%,#040810)",
      fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
      color:"#e2e8f0",
    }}>
      {/* Header */}
      <div style={{
        background:"rgba(3,6,13,0.96)", backdropFilter:"blur(12px)",
        borderBottom:`1px solid ${roleInfo.color}20`,
        padding:"12px 20px", position:"sticky", top:0, zIndex:100,
        display:"flex", alignItems:"center", gap:12,
      }}>
        <div style={{
          width:34, height:34, borderRadius:8,
          background:roleInfo.bg, border:`1.5px solid ${roleInfo.color}44`,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
        }}>{roleInfo.icon}</div>
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:"#f1f5f9" }}>
            {roleInfo.label} AI 학습
          </div>
          <div style={{ fontSize:9, color:roleInfo.color, letterSpacing:2, fontWeight:700 }}>
            {role} ENGINEER · TRAINING MODE
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={() => { window.location.href = window.location.pathname; }} style={{
            background:"rgba(51,65,85,0.4)", border:"1px solid rgba(71,85,105,0.5)",
            color:"#94a3b8", borderRadius:6, padding:"5px 11px",
            fontSize:11, fontWeight:700, cursor:"pointer",
            display:"inline-flex", alignItems:"center", gap:4,
          }} title="에이전트 선택 화면으로">
            🏠 홈
          </button>
          <span style={{
            background:roleInfo.bg, border:`1px solid ${roleInfo.color}40`,
            color:roleInfo.color, borderRadius:6, padding:"3px 10px",
            fontSize:11, fontWeight:800,
          }}>{role}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display:"flex", borderBottom:"1px solid rgba(51,65,85,0.3)",
        background:"rgba(3,6,13,0.85)", overflowX:"auto",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:"1 0 auto", padding:"11px 6px",
            background:tab===t.id?`${roleInfo.color}0d`:"transparent",
            border:"none",
            borderBottom:`2px solid ${tab===t.id?roleInfo.color:"transparent"}`,
            color:tab===t.id?roleInfo.color:"#374151",
            fontSize:10, fontWeight:800, cursor:"pointer",
            display:"flex", flexDirection:"column", alignItems:"center", gap:2,
          }}>
            <span style={{ fontSize:16 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ maxWidth:660, margin:"0 auto", padding:"22px 16px 60px" }}>
        {/* 학습자료 폴더 동기화 알림 카드 */}
        {(folderScan.roleFiles.length > 0 || folderScan.commonFiles.length > 0) && (
          <div style={{
            background:`${roleInfo.color}08`,
            border:`1.5px solid ${roleInfo.color}40`,
            borderRadius:12, padding:"12px 16px", marginBottom:16,
            display:"flex", alignItems:"center", gap:12,
          }}>
            <div style={{ fontSize:24 }}>📁</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700, color:roleInfo.color }}>
                새 학습자료 {folderScan.roleFiles.length + folderScan.commonFiles.length}개 발견
              </div>
              <div style={{ fontSize:10.5, color:"#64748b", marginTop:2 }}>
                {folderScan.roleFiles.length > 0 && `${role}: ${folderScan.roleFiles.length}개`}
                {folderScan.roleFiles.length > 0 && folderScan.commonFiles.length > 0 && " · "}
                {folderScan.commonFiles.length > 0 && `공통: ${folderScan.commonFiles.length}개`}
              </div>
            </div>
            <button onClick={() => setShowSyncDialog(true)} style={{
              padding:"7px 14px",
              background:`${roleInfo.color}25`,
              border:`1px solid ${roleInfo.color}60`,
              borderRadius:7, color:roleInfo.color,
              fontSize:11, fontWeight:700, cursor:"pointer",
              whiteSpace:"nowrap",
            }}>
              📥 학습 시작
            </button>
          </div>
        )}

        {panels[tab]}
      </div>

      {/* 학습자료 동기화 모달 */}
      {showSyncDialog && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, bottom:0,
          background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000, padding:"16px",
        }}>
          <div style={{
            background:"#0f172a", border:`1.5px solid ${roleInfo.color}40`,
            borderRadius:14, padding:"20px", maxWidth:540, width:"100%",
            maxHeight:"90vh", overflowY:"auto",
          }}>
            {!syncingFiles && !syncResult && (
              <>
                <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>
                  📁 학습자료 일괄 학습
                </div>
                <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:16, lineHeight:1.6 }}>
                  드라이브 학습자료 폴더에서 발견된 새 파일을 일괄 학습합니다.
                  <br/>
                  현재 <strong style={{ color:"#fbbf24" }}>이미지 파일만</strong> 자동 학습 지원됩니다.
                  <br/>
                  <span style={{ color:"#64748b", fontSize:10.5 }}>
                    (PDF는 옵션 선택이 필요하므로 학습앱에서 직접 업로드, Word/Excel은 PDF 변환 후 업로드 권장)
                  </span>
                </div>

                {/* role 폴더 파일 */}
                {folderScan.roleFiles.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:roleInfo.color, fontWeight:700, marginBottom:6 }}>
                      📂 {role} 폴더 ({folderScan.roleFiles.length}개)
                    </div>
                    {folderScan.roleFiles.map((f, i) => (
                      <div key={i} style={{
                        background:"rgba(15,23,42,0.6)",
                        border:"1px solid rgba(51,65,85,0.4)",
                        borderRadius:6, padding:"6px 10px", marginBottom:4,
                        fontSize:11, color:"#cbd5e1",
                      }}>
                        {f.subPath && (
                          <span style={{
                            fontSize:9.5, color:roleInfo.color,
                            background:`${roleInfo.color}15`,
                            padding:"1px 6px", borderRadius:3, marginRight:6,
                            fontWeight:700,
                          }}>📁 {f.subPath}</span>
                        )}
                        {f.filename}
                        <span style={{ fontSize:9.5, color:"#64748b", marginLeft:6 }}>
                          ({(f.size/1024).toFixed(0)}KB · {f.mimetype})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 공통 폴더 파일 */}
                {folderScan.commonFiles.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:"#34d399", fontWeight:700, marginBottom:6 }}>
                      🌐 공통 폴더 ({folderScan.commonFiles.length}개)
                    </div>
                    <div style={{ fontSize:10, color:"#64748b", marginBottom:6 }}>
                      모든 에이전트가 참조하는 공통 학습 데이터로 저장됩니다
                    </div>
                    {folderScan.commonFiles.map((f, i) => (
                      <div key={i} style={{
                        background:"rgba(15,23,42,0.6)",
                        border:"1px solid rgba(52,211,153,0.25)",
                        borderRadius:6, padding:"6px 10px", marginBottom:4,
                        fontSize:11, color:"#cbd5e1",
                      }}>
                        {f.subPath && (
                          <span style={{
                            fontSize:9.5, color:"#34d399",
                            background:"rgba(52,211,153,0.15)",
                            padding:"1px 6px", borderRadius:3, marginRight:6,
                            fontWeight:700,
                          }}>📁 {f.subPath}</span>
                        )}
                        {f.filename}
                        <span style={{ fontSize:9.5, color:"#64748b", marginLeft:6 }}>
                          ({(f.size/1024).toFixed(0)}KB · {f.mimetype})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={requestSync} style={{
                    flex:1, padding:"10px",
                    background:`linear-gradient(135deg,${roleInfo.color},${roleInfo.color}cc)`,
                    border:"none", borderRadius:8, color:"#fff",
                    fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>
                    📥 일괄 학습 시작
                  </button>
                  <button onClick={() => setShowSyncDialog(false)} style={{
                    padding:"10px 16px",
                    background:"rgba(51,65,85,0.4)",
                    border:"1px solid rgba(71,85,105,0.5)",
                    borderRadius:8, color:"#94a3b8",
                    fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>
                    취소
                  </button>
                </div>
              </>
            )}

            {syncingFiles && (
              <>
                <div style={{ fontSize:16, fontWeight:800, color:"#f1f5f9", marginBottom:12 }}>
                  📥 학습 중...
                </div>
                <div style={{ fontSize:11, color:"#94a3b8", marginBottom:8 }}>
                  {syncProgress.current}/{syncProgress.total} · {syncProgress.currentFile}
                </div>
                <div style={{ height:6, background:"rgba(51,65,85,0.5)", borderRadius:3, overflow:"hidden" }}>
                  <div style={{
                    height:"100%",
                    width: syncProgress.total > 0 ? `${(syncProgress.current/syncProgress.total)*100}%` : "0%",
                    background:`linear-gradient(90deg,${roleInfo.color},${roleInfo.color}99)`,
                    transition:"width 0.3s",
                  }}/>
                </div>
                <div style={{ fontSize:10, color:"#64748b", marginTop:14, textAlign:"center" }}>
                  파일 분석 중입니다. 잠시만 기다려주세요...
                </div>
              </>
            )}

            {syncResult && (
              <>
                <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:12 }}>
                  ✅ 학습 완료
                </div>
                <div style={{
                  background:"rgba(15,23,42,0.6)", border:"1px solid rgba(51,65,85,0.4)",
                  borderRadius:8, padding:"12px 14px", marginBottom:12,
                }}>
                  <div style={{ fontSize:12, color:"#34d399", fontWeight:700, marginBottom:4 }}>
                    성공: {syncResult.successCount}개
                  </div>
                  {(syncResult.pdfTextCount > 0 || syncResult.pdfVisionCount > 0) && (
                    <div style={{ fontSize:10, color:"#94a3b8", marginTop:4, marginBottom:4 }}>
                      {syncResult.pdfTextCount > 0 && `📝 PDF 텍스트 추출: ${syncResult.pdfTextCount}개  `}
                      {syncResult.pdfVisionCount > 0 && `🖼️ PDF 그림 분석: ${syncResult.pdfVisionCount}개`}
                    </div>
                  )}
                  {syncResult.failCount > 0 && (
                    <div style={{ fontSize:12, color:"#f87171", fontWeight:700 }}>
                      실패: {syncResult.failCount}개
                    </div>
                  )}
                </div>

                {syncResult.errors.length > 0 && (
                  <div style={{
                    background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.2)",
                    borderRadius:8, padding:"10px 12px", marginBottom:12,
                    maxHeight:160, overflowY:"auto",
                  }}>
                    <div style={{ fontSize:10, color:"#f87171", fontWeight:700, marginBottom:6 }}>
                      실패 상세
                    </div>
                    {syncResult.errors.map((err, i) => (
                      <div key={i} style={{ fontSize:10, color:"#fca5a5", marginBottom:3 }}>
                        • {err}
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => {
                  setShowSyncDialog(false);
                  setSyncResult(null);
                }} style={{
                  width:"100%", padding:"10px",
                  background:`linear-gradient(135deg,${roleInfo.color},${roleInfo.color}cc)`,
                  border:"none", borderRadius:8, color:"#fff",
                  fontSize:13, fontWeight:700, cursor:"pointer",
                }}>
                  확인
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── 빈약 데이터 재학습 모달 (Step 7-11) ─── */}
      {showRelearnDialog && (() => {
        const weakItems = knowledge.filter(k => isWeakAutoItem(k.content));
        const fileNameSet = new Set();
        weakItems.forEach(w => {
          const c = w.content || "";
          const m1 = c.match(/^\[파일:\s*([^\]]+?)\]/);
          const m2 = c.match(/^\[PDF:\s*([^\]\s-]+\.pdf)/i);
          const fname = m1 ? m1[1].trim() : (m2 ? m2[1].trim() : null);
          if (fname) fileNameSet.add(fname);
        });
        const uniqueFiles = fileNameSet.size;
        const costEst = (weakItems.length * 0.003).toFixed(3); // 대략 항목당 $0.003

        return (
          <div style={{
            position:"fixed", top:0, left:0, right:0, bottom:0,
            background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)",
            display:"flex", alignItems:"center", justifyContent:"center",
            zIndex:1000, padding:"16px",
          }}>
            <div style={{
              background:"#0f172a", border:`1.5px solid ${roleInfo.color}40`,
              borderRadius:14, padding:"20px", maxWidth:540, width:"100%",
              maxHeight:"90vh", overflowY:"auto",
            }}>
              {!relearning && !relearnResult && (
                <>
                  <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>
                    🔄 빈약 학습 데이터 재학습
                  </div>
                  <div style={{ fontSize:12, color:"#94a3b8", marginBottom:14, lineHeight:1.6 }}>
                    빈약하게 학습된 항목을 Drive 폴더의 원본 파일로 다시 분석합니다.
                    새 v10 프롬프트 (글자수 제한 없음 + 3블록 형식) + 청크 분할 자동 적용.
                  </div>

                  <div style={{
                    background:"rgba(15,23,42,0.6)", borderRadius:8,
                    padding:"12px 14px", marginBottom:14,
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:11, color:"#64748b" }}>대상 항목</span>
                      <span style={{ fontSize:12, color:"#cbd5e1", fontWeight:700 }}>{weakItems.length}건</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:11, color:"#64748b" }}>고유 파일 수</span>
                      <span style={{ fontSize:12, color:"#cbd5e1", fontWeight:700 }}>{uniqueFiles}개</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:11, color:"#64748b" }}>예상 비용</span>
                      <span style={{ fontSize:12, color:"#a5b4fc", fontWeight:700 }}>약 ${costEst}</span>
                    </div>
                  </div>

                  <div style={{
                    fontSize:10.5, color:"#fbbf24",
                    background:"rgba(245,158,11,0.08)",
                    border:"1px solid rgba(245,158,11,0.2)",
                    borderRadius:6, padding:"8px 10px", marginBottom:14, lineHeight:1.6,
                  }}>
                    ⚠️ Drive 학습자료 폴더에 원본 파일이 있어야 합니다.
                    파일이 없는 항목은 자동 스킵되고 결과에 보고됩니다.
                    기존 빈약 항목은 새 학습 성공 시 자동 삭제됩니다.
                  </div>

                  <div style={{ display:"flex", gap:8 }}>
                    <button
                      onClick={() => setShowRelearnDialog(false)}
                      style={{
                        flex:1, padding:"10px",
                        background:"rgba(51,65,85,0.4)",
                        border:"1px solid rgba(51,65,85,0.5)",
                        borderRadius:6, color:"#94a3b8",
                        fontSize:12, fontWeight:600, cursor:"pointer",
                      }}
                    >취소</button>
                    <button
                      onClick={() => startRelearn(weakItems)}
                      style={{
                        flex:2, padding:"10px",
                        background:"rgba(99,102,241,0.2)",
                        border:"1px solid rgba(99,102,241,0.5)",
                        borderRadius:6, color:"#a5b4fc",
                        fontSize:12, fontWeight:700, cursor:"pointer",
                      }}
                    >📥 재학습 시작</button>
                  </div>
                </>
              )}

              {relearning && (
                <>
                  <div style={{ fontSize:16, fontWeight:800, color:"#f1f5f9", marginBottom:14 }}>
                    🔄 재학습 진행 중
                  </div>
                  <div style={{ fontSize:11, color:"#cbd5e1", marginBottom:8 }}>
                    {relearnProgress.current}/{relearnProgress.total} — {relearnProgress.currentFile || "준비 중..."}
                  </div>
                  <div style={{
                    height:8, background:"rgba(51,65,85,0.4)", borderRadius:4, overflow:"hidden",
                    marginBottom:14,
                  }}>
                    <div style={{
                      width: relearnProgress.total > 0
                        ? `${(relearnProgress.current / relearnProgress.total) * 100}%` : "0%",
                      height:"100%", background:"#a5b4fc",
                      transition:"width 0.3s ease",
                    }}/>
                  </div>
                  <button
                    onClick={cancelRelearn}
                    style={{
                      width:"100%", padding:"8px",
                      background:"rgba(239,68,68,0.1)",
                      border:"1px solid rgba(239,68,68,0.3)",
                      borderRadius:6, color:"#f87171",
                      fontSize:11, fontWeight:600, cursor:"pointer",
                    }}
                  >⏹ 중단</button>
                </>
              )}

              {relearnResult && (
                <>
                  <div style={{ fontSize:16, fontWeight:800, color:"#f1f5f9", marginBottom:14 }}>
                    {relearnResult.cancelled ? "⏹ 재학습 중단됨" : "✅ 재학습 완료"}
                  </div>
                  <div style={{
                    background:"rgba(15,23,42,0.6)", borderRadius:8,
                    padding:"12px 14px", marginBottom:14, fontSize:11.5,
                  }}>
                    <div style={{ marginBottom:6, color:"#34d399" }}>
                      ✓ 성공: <b>{relearnResult.success}</b>건
                    </div>
                    {relearnResult.failed > 0 && (
                      <div style={{ marginBottom:6, color:"#f87171" }}>
                        ✗ 실패: <b>{relearnResult.failed}</b>건
                      </div>
                    )}
                    {relearnResult.notFound.length > 0 && (
                      <div style={{ color:"#fbbf24" }}>
                        ⚠ Drive 파일 없음: <b>{relearnResult.notFound.length}</b>건
                      </div>
                    )}
                  </div>

                  {relearnResult.notFound.length > 0 && (
                    <div style={{
                      fontSize:10.5, color:"#fbbf24",
                      background:"rgba(245,158,11,0.08)",
                      border:"1px solid rgba(245,158,11,0.2)",
                      borderRadius:6, padding:"8px 10px", marginBottom:10, lineHeight:1.6,
                    }}>
                      💡 Drive 파일 없음 항목은 학습앱 자동학습이 아닌 다른 경로로 들어온 데이터입니다.
                      (외부 도구 학습, 임시 업로드, 채팅 학습 등) 학습앱은 이 파일들의 원본을 찾을 수 없어 재학습할 수 없습니다.
                    </div>
                  )}

                  {(relearnResult.errors.length > 0 || relearnResult.notFound.length > 0) && (
                    <div style={{
                      maxHeight:200, overflowY:"auto",
                      background:"rgba(15,23,42,0.5)", borderRadius:6,
                      padding:"8px 10px", marginBottom:14, fontSize:10.5,
                      color:"#94a3b8", lineHeight:1.6,
                    }}>
                      {relearnResult.errors.map((e, i) => (
                        <div key={`err-${i}`} style={{ color:"#fca5a5" }}>· {e}</div>
                      ))}
                      {relearnResult.notFound.map((n, i) => (
                        <div key={`nf-${i}`} style={{ color:"#fbbf24" }}>
                          · {n.reason}: {(n.item.content || "").slice(0, 50)}...
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => { setShowRelearnDialog(false); setRelearnResult(null); }}
                    style={{
                      width:"100%", padding:"10px",
                      background:"rgba(99,102,241,0.15)",
                      border:"1px solid rgba(99,102,241,0.4)",
                      borderRadius:6, color:"#a5b4fc",
                      fontSize:12, fontWeight:700, cursor:"pointer",
                    }}
                  >확인</button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* PDF 처리 방식 선택 모달 (Step 5-C 보강) */}
      {showPdfModeDialog && (() => {
        // PDF 파일 통계 계산
        const allFiles = [...folderScan.roleFiles, ...folderScan.commonFiles];
        const pdfFiles = allFiles.filter(f =>
          (f.mimetype || "").includes("pdf") || (f.filename || "").toLowerCase().endsWith(".pdf")
        );
        const pdfCount = pdfFiles.length;

        return (
          <div style={{
            position:"fixed", top:0, left:0, right:0, bottom:0,
            background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)",
            display:"flex", alignItems:"center", justifyContent:"center",
            zIndex:1100, padding:"16px",
          }}>
            <div style={{
              background:"#0f172a", border:`1.5px solid ${roleInfo.color}40`,
              borderRadius:14, padding:"20px", maxWidth:520, width:"100%",
            }}>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>
                📄 PDF 처리 방식 선택
              </div>
              <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:14, lineHeight:1.6 }}>
                발견된 PDF {pdfCount}개의 처리 방식을 선택하세요.
                <br/>
                <span style={{ color:"#64748b", fontSize:10.5 }}>
                  (이미지 파일은 이 설정과 무관하게 정상 처리됩니다)
                </span>
              </div>

              {/* 텍스트 추출 우선 */}
              <div onClick={() => setSyncPdfMode("auto")} style={{
                padding:"12px 14px", cursor:"pointer", marginBottom:8,
                background: syncPdfMode === "auto" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
                border: `1.5px solid ${syncPdfMode === "auto" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
                borderRadius:8,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <div style={{
                    width:14, height:14, borderRadius:"50%",
                    border:`2px solid ${syncPdfMode === "auto" ? roleInfo.color : "#475569"}`,
                    background: syncPdfMode === "auto" ? roleInfo.color : "transparent",
                  }}/>
                  <span style={{ fontSize:13, fontWeight:700,
                    color: syncPdfMode === "auto" ? roleInfo.color : "#cbd5e1" }}>
                    📝 텍스트 추출 우선 (자동 폴백) ⭐
                  </span>
                </div>
                <div style={{ fontSize:10.5, color:"#94a3b8", lineHeight:1.6, paddingLeft:20 }}>
                  • 텍스트 PDF: 빠르고 저렴하게 처리 (페이지당 약 $0.0005)
                  <br/>
                  • 스캔 PDF: 자동으로 그림 분석으로 전환 (페이지당 $0.02)
                  <br/>
                  <span style={{ color:"#34d399" }}>✓ 작업 표준서, 규정, 매뉴얼에 적합</span>
                </div>
              </div>

              {/* 모두 그림 분석 */}
              <div onClick={() => setSyncPdfMode("vision")} style={{
                padding:"12px 14px", cursor:"pointer", marginBottom:14,
                background: syncPdfMode === "vision" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
                border: `1.5px solid ${syncPdfMode === "vision" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
                borderRadius:8,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <div style={{
                    width:14, height:14, borderRadius:"50%",
                    border:`2px solid ${syncPdfMode === "vision" ? roleInfo.color : "#475569"}`,
                    background: syncPdfMode === "vision" ? roleInfo.color : "transparent",
                  }}/>
                  <span style={{ fontSize:13, fontWeight:700,
                    color: syncPdfMode === "vision" ? roleInfo.color : "#cbd5e1" }}>
                    🖼️ 모두 그림 분석
                  </span>
                </div>
                <div style={{ fontSize:10.5, color:"#94a3b8", lineHeight:1.6, paddingLeft:20 }}>
                  • 모든 PDF의 모든 페이지를 Vision API로 분석 (페이지당 $0.02)
                  <br/>
                  • 페이지별 이미지를 드라이브에 자동 저장
                  <br/>
                  <span style={{ color:"#34d399" }}>✓ 시각 정보 중요한 자료(검사기준서, 도면, 다이어그램)에 적합</span>
                  <br/>
                  <span style={{ color:"#fbbf24" }}>⚠️ 비용 ↑, 처리 시간 ↑</span>
                </div>
              </div>

              <div style={{ display:"flex", gap:8 }}>
                <button onClick={startSync} style={{
                  flex:1, padding:"10px",
                  background:`linear-gradient(135deg,${roleInfo.color},${roleInfo.color}cc)`,
                  border:"none", borderRadius:8, color:"#fff",
                  fontSize:13, fontWeight:700, cursor:"pointer",
                }}>
                  📥 학습 시작
                </button>
                <button onClick={() => setShowPdfModeDialog(false)} style={{
                  padding:"10px 16px",
                  background:"rgba(51,65,85,0.4)",
                  border:"1px solid rgba(71,85,105,0.5)",
                  borderRadius:8, color:"#94a3b8",
                  fontSize:13, fontWeight:700, cursor:"pointer",
                }}>
                  취소
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        *{box-sizing:border-box}
        textarea:focus,input:focus{border-color:rgba(59,130,246,0.5)!important}
        button:hover:not(:disabled){filter:brightness(1.1)}
        a:hover{filter:brightness(1.1)}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(59,130,246,0.2);border-radius:2px}
      `}</style>
    </div>
  );
}
