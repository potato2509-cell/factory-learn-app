/**
 * 통합 Apps Script — 학습앱 + Teams Proxy
 *
 * 변경 이력:
 *   v7 (2026-05-13, Step 7-11 v7):
 *     - 기존 doGet/doPost가 두 번씩 정의되어 있던 구조를 통합
 *     - 첫 번째 doGet/doPost (학습앱)에 두 번째 (Teams Proxy)를 흡수
 *     - 분기 기준:
 *       · doPost: payload.secret 있으면 Teams Proxy, 없으면 학습앱
 *       · doGet:  e.parameter.action 있으면 학습앱, 없으면 alive 메시지
 *     - scan_learning_folder_all 액션 포함 (Step 7-11 v6 재학습용)
 *
 *   v8 (2026-05-14, Step 7-13):
 *     - PLC 3종 에이전트 추가 (Cell_PLC, Elec_PLC, FA_PLC)
 *     - TAB_MAP: 3줄 추가
 *     - DASHBOARD_ROLES: 3항목 추가
 *
 *   v9 (2026-05-14, 트랙 1 단계 1·2 — 출처 메타 시스템 기반):
 *     - SOURCE_META_COLUMNS 상수 추가 (D~G열: source_file, source_page, source_section, source_url)
 *     - addSourceColumnsToAllSheets 신규 함수 (1회 실행용 마이그레이션)
 *     - saveKnowledge: sourceMeta 인자 받아 D~G열 저장 (하위 호환 — sourceMeta 없으면 빈 칸)
 *     - saveCommonKnowledge: 동일하게 sourceMeta 인자 받음
 *     - ensureCommonKnowledgeSheet: 신규 생성 시 헤더 7개로
 *
 *   v10 (2026-05-14, 트랙 1 단계 8-A — 출처 메타 읽기):
 *     - getKnowledge: D~G열 4개 필드 반환 추가 (source_file/source_page/source_section/source_url)
 *     - getCommonKnowledge: 동일하게 D~G열 반환 추가
 *     - 둘 다 D~G가 빈 칸이어도 안전 (구버전 row는 모두 "" 반환)
 *     - 시트 구조 변경 없음, 마이그레이션 불필요 (재배포만 하면 됨)
 *
 *   v11 (2026-05-17, 트랙 1 단계 5 — PPT 자동 변환 지원):
 *     - getDriveFileContent: PPT/PPTX 감지 시 Drive Advanced API로 PDF 변환
 *       · 변환된 PDF는 원본 PPT와 같은 폴더에 생성 (Q8-가)
 *       · 파일명 충돌 시 변환 스킵 + 에러 보고 (Q9-가, 안전 우선)
 *       · 변환 성공 시 원본 PPT는 휴지통 이동 (Q11-가, 30일 내 복구 가능)
 *       · 단계별 안전망: 어느 단계 실패해도 PPT 데이터 손실 없음 (Q10)
 *     - 클라이언트(App.jsx)는 변경 없이 동일 호출 — 백엔드가 PPT를 PDF로 자동 환원
 *       응답 객체에 새 필드 converted_from_pptx (true 시 클라이언트가 학습 흐름 동일하게 진행)
 *
 *   ⚠️ v11 활성화 전 필수 작업: Drive 고급 서비스 활성화
 *     Apps Script 에디터 → 서비스(+) → "Drive API" 추가 → ID: Drive, 버전: v2 → 확인
 *     활성화 안 되면 PPT 변환 단계에서 에러 발생 (Drive.Files 미정의)
 *
 * 📍 대상 프로젝트: Factory Agent KB (학습앱 백엔드)
 *
 * v11 배포 방법 (마이그레이션 불필요):
 *   1. Apps Script 에디터 (Factory Agent KB) 열기
 *   2. 기존 v10 코드 전체 선택 → 삭제
 *   3. 이 파일 내용 전체 복사 → 붙여넣기
 *   4. ★ 서비스 패널에서 Drive API v2 활성화 확인 (위 ⚠️ 참조)
 *   5. Ctrl+S 저장
 *   6. ★ 배포 → 배포 관리 → 편집 → 새 버전 → 배포 (외부 URL 반영 필수)
 */

// ════════════════════════════════════════════════════════════════════════════
// 상수
// ════════════════════════════════════════════════════════════════════════════

const SHEET_ID = "1Kc_aRh-MLJPJvgmkcqhU4Gw20n5MhEkfnsqoNf8QOLY";

// 출처 메타 컬럼 (v9 신규, 트랙 1: PDF/PPT/XLSX 학습 시 시트 D~G열로 저장)
const SOURCE_META_COLUMNS = ["source_file", "source_page", "source_section", "source_url"];

const TAB_MAP = {
  PE: "PE_Knowledge",
  ME: "ME_Knowledge",
  TE: "TE_Knowledge",
  Cell_PE: "Cell_PE_Knowledge",
  Cell_ME: "Cell_ME_Knowledge",
  Cell_TE: "Cell_TE_Knowledge",
  Elec_PE: "Elec_PE_Knowledge",
  Elec_ME: "Elec_ME_Knowledge",
  Elec_TE: "Elec_TE_Knowledge",
  FA: "FA_Knowledge",
  Vision: "Vision_Knowledge",
  Cell_PLC: "Cell_PLC_Knowledge",
  Elec_PLC: "Elec_PLC_Knowledge",
  FA_PLC: "FA_PLC_Knowledge",
};

const DASHBOARD_ROLES = [
  "Cell_PE", "Cell_ME", "Cell_TE",
  "Elec_PE", "Elec_ME", "Elec_TE",
  "FA", "Vision",
  "Cell_PLC", "Elec_PLC", "FA_PLC",
];

const RECENT_DAYS = 7;
const SUMMARY_CATEGORY = "_요약";
const ROOT_FOLDER_ID = "1aTrM2DEQ8SXy_UEYExpFCzL2afrGRzUW";
const COMMON_FOLDER_NAME = "_공통";
const COMMON_KNOWLEDGE_SHEET = "Common_Knowledge";
const PROCESSED_FILES_SHEET = "Processed_Files";

// ════════════════════════════════════════════════════════════════════════════
// 통합 진입점 (doPost / doGet) — 한 번만 정의
// ════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return makeResponse({ success: false, error: "no payload" });
    }

    const data = JSON.parse(e.postData.contents);

    // Teams Proxy 분기: payload.secret이 있으면 Teams 발송으로 분류
    if (data.secret !== undefined) {
      return handleTeamsProxy(data);
    }

    // 학습앱 분기
    const action = data.action;
    if (action === "save_minutes") saveMinutes(data);
    else if (action === "save_knowledge") saveKnowledge(data);
    else if (action === "save_summary") saveSummary(data);
    else if (action === "replace_knowledge") replaceKnowledge(data);
    else if (action === "delete_knowledge") deleteKnowledge(data);
    else if (action === "save_defect_pattern") saveDefectPattern(data);
    else if (action === "upload_image") return uploadImageToFolder(data);
    else if (action === "mark_file_processed") markFileProcessed(data);
    else if (action === "save_common_knowledge") saveCommonKnowledge(data);
    return makeResponse({ success: true });
  } catch(err) {
    return makeResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;

    // 액션이 없으면 alive 체크 응답 (Teams Proxy 배포 검증 호환)
    if (!action) {
      return makeResponse({
        ok: true,
        msg: "AZS app alive",
        timestamp: new Date().toISOString(),
      });
    }

    const role = e.parameter.role;
    if (action === "get_knowledge") return getKnowledge(role);
    if (action === "get_minutes") return getMinutes();
    if (action === "get_all_progress") return getAllProgress();
    if (action === "get_summary") return getSummary(role);
    if (action === "count_since_summary") return countSinceLastSummary(role);
    if (action === "get_category_items") return getCategoryItems(role, e.parameter.category);
    if (action === "count_defect_images") return countDefectImages(role);
    if (action === "get_defect_image_data") return getDefectImageData(role);
    if (action === "scan_learning_folder") return scanLearningFolder(role);
    if (action === "scan_learning_folder_all") return scanLearningFolderAll(role);
    if (action === "get_drive_file") return getDriveFileContent(e.parameter.fileId);
    if (action === "get_common_knowledge") return getCommonKnowledge();

    return makeResponse({ success: false, error: "unknown action: " + action });
  } catch(err) {
    return makeResponse({ success: false, error: err.message });
  }
}

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// jsonResponse는 makeResponse의 별칭 (Teams Proxy 코드 호환)
function jsonResponse(obj, statusCode) {
  return makeResponse(obj);
}

// ════════════════════════════════════════════════════════════════════════════
// v9 신규 — 트랙 1 단계 1: 출처 메타 컬럼 마이그레이션 (1회 실행용)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 트랙 1 마이그레이션: 11개 _Knowledge 시트 + Common_Knowledge에
 * 출처 메타 컬럼 4개(D~G)를 추가합니다.
 *
 * - 재실행 안전: 이미 모든 컬럼이 있으면 skip, 일부만 있으면 누락분만 추가
 * - 기존 row 데이터는 건드리지 않음 (헤더만 추가, D~G는 빈 칸으로 남음)
 * - PE/ME/TE 레거시 시트는 대상에서 제외 (DASHBOARD_ROLES만 사용)
 *
 * 실행 방법:
 *   1. 상단 함수 선택 박스에서 addSourceColumnsToAllSheets 선택
 *   2. ▶ 실행 클릭
 *   3. 권한 승인 (첫 실행 시)
 *   4. 실행 로그(보기 → 로그) 확인 — 12개 시트 모두 ✅ 또는 ⏭ 면 성공
 *
 * 외부 URL 호출 아니므로 배포 불필요. saveKnowledge 등 외부 호출 함수는
 * 별도로 배포(배포 → 배포 관리 → 편집 → 새 버전 → 배포)가 필요함.
 */
function addSourceColumnsToAllSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // 대상: DASHBOARD_ROLES 11개의 _Knowledge 시트 + Common_Knowledge = 총 12개
  const targetSheetNames = DASHBOARD_ROLES
    .map(role => TAB_MAP[role])
    .filter(name => name)
    .concat([COMMON_KNOWLEDGE_SHEET]);

  let okCount = 0;
  let skipCount = 0;
  let missCount = 0;

  targetSheetNames.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      Logger.log("❌ 시트 없음: " + name);
      missCount++;
      return;
    }

    const lastCol = sheet.getLastColumn();
    const headers = lastCol >= 1
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || ""))
      : [];

    const allPresent = SOURCE_META_COLUMNS.every(col => headers.indexOf(col) !== -1);
    if (allPresent) {
      Logger.log("⏭ 이미 적용됨: " + name);
      skipCount++;
      return;
    }

    const toAdd = SOURCE_META_COLUMNS.filter(col => headers.indexOf(col) === -1);
    const startCol = headers.length + 1;
    sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);

    Logger.log("✅ " + name + ": " + toAdd.length + "개 컬럼 추가 (" + toAdd.join(", ") + ")");
    okCount++;
  });

  Logger.log("\n=== 완료 ===");
  Logger.log("처리: " + okCount + "개 | 이미 적용: " + skipCount + "개 | 시트 없음: " + missCount + "개");
}

// ════════════════════════════════════════════════════════════════════════════
// 학습앱 — 회의록·학습 데이터 저장/조회
// ════════════════════════════════════════════════════════════════════════════

function saveMinutes(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Meeting_Minutes");
  const now = new Date().toLocaleString("ko-KR");
  sheet.appendRow([
    data.date || "",
    data.agenda || "",
    data.issue_summary || "",
    data.pe_opinion || "",
    data.me_opinion || "",
    data.te_opinion || "",
    data.discussion || "",
    data.action_items || "",
    data.minutes_full || "",
    now,
  ]);
}

/**
 * 학습 데이터 저장 (v9: 출처 메타 인자 추가, 하위 호환)
 *
 * 호출 패턴 1 (기존 — 그대로 동작):
 *   payload = { action: "save_knowledge", role, category, content }
 *   → D~G열은 빈 칸으로 저장
 *
 * 호출 패턴 2 (v9 신규 — PDF/PPT/XLSX 학습 시):
 *   payload = {
 *     action: "save_knowledge", role, category, content,
 *     sourceMeta: {
 *       file: "Cell 정비 매뉴얼 v3.2.pdf",
 *       page: "47",                              // PDF: "47", PPT: "슬라이드 7", XLSX: "시트: Cell"
 *       section: "2. 안전 인터록 > 2.1 도어 인터록",
 *       url: "https://drive.google.com/file/d/abc123/view#page=47"
 *     }
 *   }
 *   → D~G열에 메타 4개 저장
 */
function saveKnowledge(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[data.role];
  if (!tabName) return;
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  const now = new Date().toLocaleString("ko-KR");

  // 출처 메타 (sourceMeta가 없으면 4개 모두 빈 칸 — 하위 호환)
  const meta = data.sourceMeta || {};
  sheet.appendRow([
    data.category || "",
    data.content || "",
    now,
    meta.file || "",
    meta.page || "",
    meta.section || "",
    meta.url || "",
  ]);
}

function getKnowledge(role) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[role];
  if (!tabName) return makeResponse({ success: false, error: "역할 없음: " + role });
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return makeResponse({ success: false, error: "시트 없음: " + tabName });
  const rows = sheet.getDataRange().getValues();
  // v10: D~G열 출처 메타 추가 반환 (구버전 row는 빈 칸 그대로 반환되므로 안전)
  const data = rows.slice(1).map(row => ({
    category: row[0], content: row[1], updated_at: row[2],
    source_file: row[3] || "", source_page: row[4] || "",
    source_section: row[5] || "", source_url: row[6] || "",
  }));
  return makeResponse({ success: true, data });
}

function getMinutes() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Meeting_Minutes");
  const rows = sheet.getDataRange().getValues();
  const data = rows.slice(1).map(row => ({
    date: row[0], agenda: row[1], issue_summary: row[2],
    minutes_full: row[8], created_at: row[9],
  }));
  return makeResponse({ success: true, data });
}

function parseKoreanDate(str) {
  if (!str) return null;
  if (str instanceof Date) return str;

  const s = String(str).trim();
  const match = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후)?\s*(\d{1,2}):(\d{1,2}):?(\d{0,2})/);
  if (!match) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const year = parseInt(match[1]);
  const month = parseInt(match[2]) - 1;
  const day = parseInt(match[3]);
  const ampm = match[4];
  let hour = parseInt(match[5]);
  const minute = parseInt(match[6]);
  const second = parseInt(match[7] || "0");

  if (ampm === "오후" && hour < 12) hour += 12;
  if (ampm === "오전" && hour === 12) hour = 0;

  return new Date(year, month, day, hour, minute, second);
}

function getAllProgress() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const result = [];

  DASHBOARD_ROLES.forEach(role => {
    const tabName = TAB_MAP[role];
    const sheet = tabName ? ss.getSheetByName(tabName) : null;

    if (!sheet || sheet.getLastRow() < 2) {
      result.push({
        role: role, itemCount: 0, contentLength: 0, categoryCount: 0,
        correctionCount: 0, recentRate: 0, lastUpdate: null,
      });
      return;
    }

    const lastRow = sheet.getLastRow();
    const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

    let contentLength = 0;
    let correctionCount = 0;
    let recentCount = 0;
    let latestDate = null;
    const categories = new Set();

    values.forEach(row => {
      const category = String(row[0] || "").trim();
      const content = String(row[1] || "");
      const updatedAt = row[2];

      contentLength += content.length;
      if (category) categories.add(category);
      if (category === "교정사례") correctionCount++;

      const dateObj = parseKoreanDate(updatedAt);
      if (dateObj) {
        if (dateObj >= recentCutoff) recentCount++;
        if (!latestDate || dateObj > latestDate) latestDate = dateObj;
      }
    });

    const itemCount = values.length;
    const recentRate = itemCount > 0 ? Math.round((recentCount / itemCount) * 100) : 0;
    const lastUpdate = latestDate
      ? Utilities.formatDate(latestDate, "Asia/Seoul", "yyyy-MM-dd") : null;

    result.push({
      role: role, itemCount: itemCount, contentLength: contentLength,
      categoryCount: categories.size, correctionCount: correctionCount,
      recentRate: recentRate, lastUpdate: lastUpdate,
    });
  });

  return makeResponse({ success: true, data: result });
}

function getSummary(role) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[role];
  if (!tabName) return makeResponse({ success: false, error: "역할 없음: " + role });
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) {
    return makeResponse({ success: true, data: null });
  }
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();

  let latest = null;
  let latestDate = null;
  rows.forEach(row => {
    if (String(row[0] || "").trim() === SUMMARY_CATEGORY) {
      const d = parseKoreanDate(row[2]);
      if (d && (!latestDate || d > latestDate)) {
        latestDate = d;
        latest = { content: String(row[1] || ""), updated_at: String(row[2] || "") };
      }
    }
  });
  return makeResponse({ success: true, data: latest });
}

function saveSummary(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[data.role];
  if (!tabName) return;
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0] || "").trim() === SUMMARY_CATEGORY) {
        sheet.deleteRow(i + 2);
      }
    }
  }

  const now = new Date().toLocaleString("ko-KR");
  sheet.appendRow([SUMMARY_CATEGORY, data.summary || "", now]);
}

function countSinceLastSummary(role) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[role];
  if (!tabName) return makeResponse({ success: false, error: "역할 없음: " + role });
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) {
    return makeResponse({ success: true, data: { count: 0, hasSummary: false } });
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();

  let latestSummaryDate = null;
  rows.forEach(row => {
    if (String(row[0] || "").trim() === SUMMARY_CATEGORY) {
      const d = parseKoreanDate(row[2]);
      if (d && (!latestSummaryDate || d > latestSummaryDate)) {
        latestSummaryDate = d;
      }
    }
  });

  let count = 0;
  rows.forEach(row => {
    const cat = String(row[0] || "").trim();
    if (cat === SUMMARY_CATEGORY) return;
    const d = parseKoreanDate(row[2]);
    if (!d) return;
    if (!latestSummaryDate || d > latestSummaryDate) count++;
  });

  return makeResponse({
    success: true,
    data: { count: count, hasSummary: latestSummaryDate !== null }
  });
}

function getCategoryItems(role, category) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[role];
  if (!tabName) return makeResponse({ success: false, error: "역할 없음: " + role });
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) {
    return makeResponse({ success: true, data: [] });
  }
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const data = rows
    .filter(row => String(row[0] || "").trim() === category)
    .map(row => ({
      category: row[0], content: String(row[1] || ""), updated_at: String(row[2] || ""),
    }));
  return makeResponse({ success: true, data });
}

function replaceKnowledge(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[data.role];
  if (!tabName) return;
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const oldContent = String(data.oldContent || "").trim();
  const category = String(data.category || "").trim();

  for (let i = 0; i < rows.length; i++) {
    const rowCategory = String(rows[i][0] || "").trim();
    const rowContent = String(rows[i][1] || "").trim();
    if (rowCategory === category && rowContent === oldContent) {
      const now = new Date().toLocaleString("ko-KR");
      sheet.getRange(i + 2, 1, 1, 3).setValues([[
        category, data.newContent || "", now,
      ]]);
      return;
    }
  }
}

function deleteKnowledge(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[data.role];
  if (!tabName) return;
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const targetContent = String(data.content || "").trim();
  const category = String(data.category || "").trim();

  for (let i = rows.length - 1; i >= 0; i--) {
    const rowCategory = String(rows[i][0] || "").trim();
    const rowContent = String(rows[i][1] || "").trim();
    if (rowCategory === category && rowContent === targetContent) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

function countDefectImages(role) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[role];
  if (!tabName) return makeResponse({ success: false, error: "역할 없음: " + role });
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) {
    return makeResponse({ success: true, data: { count: 0, hasPattern: false } });
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  let defectCount = 0;
  let hasPattern = false;

  rows.forEach(row => {
    const cat = String(row[0] || "").trim();
    const content = String(row[1] || "");
    if (content.includes("[이미지 유형] 불량")) defectCount++;
    if (cat === "_불량패턴") hasPattern = true;
  });

  return makeResponse({ success: true, data: { count: defectCount, hasPattern } });
}

function getDefectImageData(role) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[role];
  if (!tabName) return makeResponse({ success: false, error: "역할 없음: " + role });
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) {
    return makeResponse({ success: true, data: [] });
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const data = rows
    .filter(row => String(row[1] || "").includes("[이미지 유형] 불량"))
    .map(row => ({
      category: row[0], content: String(row[1] || ""), updated_at: String(row[2] || ""),
    }));

  return makeResponse({ success: true, data });
}

function saveDefectPattern(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[data.role];
  if (!tabName) return;
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return;

  const PATTERN_CATEGORY = "_불량패턴";
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0] || "").trim() === PATTERN_CATEGORY) {
        sheet.deleteRow(i + 2);
      }
    }
  }

  const now = new Date().toLocaleString("ko-KR");
  sheet.appendRow([PATTERN_CATEGORY, data.pattern || "", now]);
}

// ════════════════════════════════════════════════════════════════════════════
// 드라이브 연동
// ════════════════════════════════════════════════════════════════════════════

function getOrCreateFolder(rootId, pathArray) {
  let current = DriveApp.getFolderById(rootId);
  for (const name of pathArray) {
    const folders = current.getFoldersByName(name);
    if (folders.hasNext()) {
      current = folders.next();
    } else {
      current = current.createFolder(name);
    }
  }
  return current;
}

function uploadImageToFolder(data) {
  try {
    const role = data.role;
    const filename = data.filename || `image_${Date.now()}.jpg`;
    const base64 = data.base64;
    const mimetype = data.mimetype || "image/jpeg";

    if (!base64) {
      return makeResponse({ success: false, error: "base64 데이터 없음" });
    }

    const targetFolder = getOrCreateFolder(ROOT_FOLDER_ID, ["학습이미지", role]);
    const now = new Date();
    const timestamp = Utilities.formatDate(now, "Asia/Seoul", "yyyyMMdd_HHmmss");
    const finalFilename = `${role}_${timestamp}_${filename}`;

    const decoded = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(decoded, mimetype, finalFilename);
    const file = targetFolder.createFile(blob);

    return makeResponse({
      success: true,
      data: { url: file.getUrl(), fileId: file.getId(), filename: finalFilename },
    });
  } catch (err) {
    return makeResponse({ success: false, error: err.message });
  }
}

function ensureProcessedFilesSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(PROCESSED_FILES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROCESSED_FILES_SHEET);
    sheet.appendRow(["role", "file_id", "filename", "processed_at"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Common_Knowledge 시트 보장 (v9: 신규 생성 시 헤더 7개 — 출처 메타 컬럼 포함)
 *
 * 마이그레이션(addSourceColumnsToAllSheets)을 이미 실행했으면 시트가 존재하고
 * 헤더 7개를 갖추고 있어야 하므로, 이 함수는 시트가 아예 없는 예외 상황에만 호출됨.
 */
function ensureCommonKnowledgeSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(COMMON_KNOWLEDGE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(COMMON_KNOWLEDGE_SHEET);
    // v9: 헤더 7개 (기존 3개 + 출처 메타 4개)
    sheet.appendRow(["category", "content", "updated_at"].concat(SOURCE_META_COLUMNS));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function collectFilesRecursive(folder, processedIds, subPath) {
  const collected = [];
  subPath = subPath || "";

  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const fid = f.getId();
    if (!processedIds.includes(fid)) {
      collected.push({
        fileId: fid, filename: f.getName(), mimetype: f.getMimeType(),
        size: f.getSize(), url: f.getUrl(), subPath: subPath,
      });
    }
  }

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    const sub = subFolders.next();
    const newPath = subPath ? `${subPath}/${sub.getName()}` : sub.getName();
    const subFiles = collectFilesRecursive(sub, processedIds, newPath);
    for (let i = 0; i < subFiles.length; i++) {
      collected.push(subFiles[i]);
    }
  }

  return collected;
}

function scanLearningFolder(role) {
  try {
    const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const learningFolders = rootFolder.getFoldersByName("학습자료");
    if (!learningFolders.hasNext()) {
      return makeResponse({ success: true, data: { roleFiles: [], commonFiles: [] } });
    }
    const learningFolder = learningFolders.next();

    let roleFiles = [];
    const roleFolders = learningFolder.getFoldersByName(role);
    if (roleFolders.hasNext()) {
      const roleFolder = roleFolders.next();
      const processedIds = getProcessedFileIds(role);
      roleFiles = collectFilesRecursive(roleFolder, processedIds, "");
    }

    let commonFiles = [];
    const commonFolders = learningFolder.getFoldersByName(COMMON_FOLDER_NAME);
    if (commonFolders.hasNext()) {
      const commonFolder = commonFolders.next();
      const processedCommonIds = getProcessedFileIds("_COMMON_");
      commonFiles = collectFilesRecursive(commonFolder, processedCommonIds, "");
    }

    return makeResponse({ success: true, data: { roleFiles, commonFiles } });
  } catch (err) {
    return makeResponse({ success: false, error: err.message });
  }
}

// 재학습 전용 폴더 스캔 (Step 7-11 v6) — Processed_Files 필터링 없이 모든 파일 반환
function scanLearningFolderAll(role) {
  try {
    const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const learningFolders = rootFolder.getFoldersByName("학습자료");
    if (!learningFolders.hasNext()) {
      return makeResponse({ success: true, roleFiles: [], commonFiles: [] });
    }
    const learningFolder = learningFolders.next();

    // collectFilesRecursive 재활용 (processedIds 빈 배열로)
    let roleFiles = [];
    const roleFolders = learningFolder.getFoldersByName(role);
    if (roleFolders.hasNext()) {
      roleFiles = collectFilesRecursive(roleFolders.next(), [], "");
    }

    let commonFiles = [];
    const commonFolders = learningFolder.getFoldersByName(COMMON_FOLDER_NAME);
    if (commonFolders.hasNext()) {
      commonFiles = collectFilesRecursive(commonFolders.next(), [], "");
    }

    return makeResponse({ success: true, roleFiles: roleFiles, commonFiles: commonFiles });
  } catch (err) {
    return makeResponse({ success: false, error: err.message });
  }
}

function getProcessedFileIds(role) {
  const sheet = ensureProcessedFilesSheet();
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  return rows.filter(r => r[0] === role).map(r => r[1]);
}

function getDriveFileContent(fileId) {
  let stage = "init";
  try {
    if (!fileId) return makeResponse({ success: false, error: "fileId 누락" });

    stage = "getFileById";
    const file = DriveApp.getFileById(fileId);

    stage = "metadata";
    let fileName = file.getName();
    let mimeType = file.getMimeType();
    let fileSize = file.getSize();
    let targetFile = file; // 실제로 base64 변환할 파일 (PPT면 변환된 PDF로 교체됨)
    let convertedFromPptx = false;
    Logger.log(`[getDriveFileContent] ${fileName} | ${mimeType} | ${fileSize} bytes`);

    if (mimeType === "application/vnd.google-apps.shortcut") {
      return makeResponse({ success: false, error: `바로가기 파일은 지원되지 않음 (${fileName})` });
    }

    // v11: PPT/PPTX 자동 변환 (Drive Advanced API 필요)
    const isPptx = (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation")
                || (fileName.toLowerCase().endsWith(".pptx"));
    const isPpt = (mimeType === "application/vnd.ms-powerpoint")
               || (fileName.toLowerCase().endsWith(".ppt"));

    if (isPptx || isPpt) {
      stage = "ppt_convert_check_collision";
      // 1) 변환 후 PDF 파일명 생성
      const pdfFileName = fileName.replace(/\.pptx?$/i, ".pdf");

      // 2) 원본 PPT의 부모 폴더 찾기 (Q8-가: 같은 폴더에 생성)
      const parentFolders = file.getParents();
      if (!parentFolders.hasNext()) {
        return makeResponse({
          success: false,
          error: `PPT 변환 실패: 원본 파일의 부모 폴더를 찾을 수 없음 (${fileName})`,
        });
      }
      const parentFolder = parentFolders.next();

      // 3) 같은 폴더에 동일 파일명 PDF가 이미 있는지 확인 (Q9-가: 충돌 시 변환 스킵)
      const existingPdfs = parentFolder.getFilesByName(pdfFileName);
      if (existingPdfs.hasNext()) {
        const existing = existingPdfs.next();
        return makeResponse({
          success: false,
          error: `PPT → PDF 변환 스킵: 같은 폴더에 "${pdfFileName}"가 이미 존재 (PPT: ${fileName}, 기존 PDF: ${existing.getId()}). 충돌 해결 후 재시도.`,
        });
      }

      stage = "ppt_convert_to_pdf";
      // 4) Drive API로 PPT → PDF 변환
      //    참고: Drive.Files.export()는 Google Slides에만 동작. 일반 PPT는 다른 방식 필요.
      //    PPT 파일을 Google Slides로 임시 변환 → PDF export → Google Slides 삭제 흐름
      let tempSlidesId = null;
      let pdfBlob = null;
      try {
        // 4-1) PPT를 Google Slides로 임시 변환 (Drive Advanced API v2)
        const resource = {
          title: fileName + " (temp for PDF conversion)",
          mimeType: "application/vnd.google-apps.presentation",
        };
        const insertOpts = { convert: true };
        const blob = file.getBlob();
        // eslint-disable-next-line no-undef
        const tempSlides = Drive.Files.insert(resource, blob, insertOpts);
        tempSlidesId = tempSlides.id;

        // 4-2) Google Slides → PDF export
        const tempSlidesFile = DriveApp.getFileById(tempSlidesId);
        pdfBlob = tempSlidesFile.getAs("application/pdf");
      } catch (convErr) {
        // 변환 실패 — 임시 Slides 삭제 시도 후 에러 반환 (Q10 단계 1: PPT 그대로 두기)
        if (tempSlidesId) {
          try { DriveApp.getFileById(tempSlidesId).setTrashed(true); } catch (_) {}
        }
        return makeResponse({
          success: false,
          error: `PPT → PDF 변환 실패 (${fileName}): ${convErr.message}. Drive API v2 활성화 확인 필요.`,
        });
      }

      stage = "ppt_convert_save_pdf";
      // 5) 변환된 PDF를 원본 폴더에 저장
      let pdfFile = null;
      try {
        pdfFile = parentFolder.createFile(pdfBlob).setName(pdfFileName);
      } catch (saveErr) {
        // PDF 저장 실패 — 임시 Slides 삭제 + 에러 반환 (PPT 그대로 보존)
        if (tempSlidesId) {
          try { DriveApp.getFileById(tempSlidesId).setTrashed(true); } catch (_) {}
        }
        return makeResponse({
          success: false,
          error: `PPT → PDF 변환 후 저장 실패 (${fileName}): ${saveErr.message}`,
        });
      }

      // 6) 임시 Google Slides 삭제 (변환 완료 후 불필요)
      try {
        DriveApp.getFileById(tempSlidesId).setTrashed(true);
      } catch (_) { /* 임시파일 삭제 실패는 무시 (휴지통에 남아도 30일 후 자동) */ }

      stage = "ppt_trash_original";
      // 7) 원본 PPT 휴지통 이동 (Q11-가: setTrashed)
      //    이 시점에 PDF는 안전하게 생성됨. 휴지통 실패해도 학습은 진행 (Q10 단계 2).
      try {
        file.setTrashed(true);
        Logger.log(`[v11 PPT변환] 원본 PPT 휴지통 이동: ${fileName} (ID: ${fileId})`);
      } catch (trashErr) {
        Logger.log(`[v11 PPT변환] 원본 PPT 휴지통 이동 실패 (학습은 계속): ${trashErr.message}`);
      }

      // 8) 이후 흐름을 변환된 PDF 기준으로 진행
      targetFile = pdfFile;
      fileName = pdfFileName;
      mimeType = "application/pdf";
      fileSize = pdfFile.getSize();
      convertedFromPptx = true;
      Logger.log(`[v11 PPT변환] ✅ 변환 완료: ${pdfFileName} (${fileSize} bytes)`);
    }

    if (mimeType.indexOf("application/vnd.google-apps") === 0) {
      return makeResponse({ success: false, error: `Google 문서 형식은 미지원: ${mimeType} (${fileName})` });
    }

    stage = "getBlob";
    const blob = targetFile.getBlob();
    stage = "getBytes";
    const bytes = blob.getBytes();
    stage = "base64Encode";
    const base64 = Utilities.base64Encode(bytes);

    return makeResponse({
      success: true,
      data: {
        filename: fileName, mimetype: mimeType, size: fileSize,
        base64: base64, url: targetFile.getUrl(),
        converted_from_pptx: convertedFromPptx, // v11: PPT 변환 여부 플래그
        // v11: 변환된 경우 클라이언트가 두 fileId 모두 processed 표시 → 중복 학습 방지
        converted_pdf_file_id: convertedFromPptx ? targetFile.getId() : null,
      },
    });
  } catch (err) {
    Logger.log(`[getDriveFileContent ERROR] stage=${stage} fileId=${fileId} message=${err.message}`);
    return makeResponse({ success: false, error: `[${stage}] ${err.message}` });
  }
}

function markFileProcessed(data) {
  const sheet = ensureProcessedFilesSheet();
  const now = new Date().toLocaleString("ko-KR");
  sheet.appendRow([data.role || "", data.fileId || "", data.filename || "", now]);
}

/**
 * 공통 학습 데이터 저장 (v9: 출처 메타 인자 추가, saveKnowledge와 동일 패턴)
 *
 * 호출 패턴 1 (기존 — 그대로 동작):
 *   payload = { action: "save_common_knowledge", category, content }
 *   → D~G열은 빈 칸으로 저장
 *
 * 호출 패턴 2 (v9 신규 — PDF/PPT/XLSX 공통 자료 학습 시):
 *   payload = {
 *     action: "save_common_knowledge", category, content,
 *     sourceMeta: { file, page, section, url }
 *   }
 */
function saveCommonKnowledge(data) {
  const sheet = ensureCommonKnowledgeSheet();
  const now = new Date().toLocaleString("ko-KR");

  // 출처 메타 (saveKnowledge와 동일 패턴, 하위 호환)
  const meta = data.sourceMeta || {};
  sheet.appendRow([
    data.category || "",
    data.content || "",
    now,
    meta.file || "",
    meta.page || "",
    meta.section || "",
    meta.url || "",
  ]);
}

function getCommonKnowledge() {
  const sheet = ensureCommonKnowledgeSheet();
  if (sheet.getLastRow() < 2) return makeResponse({ success: true, data: [] });
  // v10: A~G 7개 열 모두 반환 (출처 메타 D~G 추가)
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  const data = rows.map(r => ({
    category: r[0], content: r[1], updated_at: r[2],
    source_file: r[3] || "", source_page: r[4] || "",
    source_section: r[5] || "", source_url: r[6] || "",
  }));
  return makeResponse({ success: true, data });
}

// ════════════════════════════════════════════════════════════════════════════
// Teams Proxy (논의앱 — AZS Daily Report 발송 + Drive 아카이빙)
// ════════════════════════════════════════════════════════════════════════════

function handleTeamsProxy(payload) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty("SHARED_SECRET");
  if (!expectedSecret) {
    return makeResponse({ ok: false, error: "SHARED_SECRET not configured" });
  }
  if (payload.secret !== expectedSecret) {
    return makeResponse({ ok: false, error: "unauthorized" });
  }

  const webhookUrl = props.getProperty("TEAMS_WEBHOOK_URL");
  if (!webhookUrl) {
    return makeResponse({ ok: false, error: "TEAMS_WEBHOOK_URL not configured" });
  }

  const action = payload.action || "send_report";
  let result;
  switch (action) {
    case "send_report": result = handleSendReport(payload, webhookUrl); break;
    case "send_alarm":  result = handleSendAlarm(payload, webhookUrl); break;
    case "send_daily":  result = handleSendDaily(payload, webhookUrl); break;
    case "ping":        result = { ok: true, msg: "pong", action: "ping" }; break;
    default: return makeResponse({ ok: false, error: "unknown teams action: " + action });
  }
  return makeResponse(result);
}

function handleSendReport(payload, webhookUrl) {
  let driveUrl = null;
  let driveError = null;
  if (payload.html) {
    try {
      driveUrl = saveHtmlToDrive(payload);
      console.log("[12-BE] Drive 적재 완료:", driveUrl);
    } catch (err) {
      driveError = err.message;
      console.error("[12-BE] Drive 적재 실패:", err);
    }
  }

  let teamsPayload;
  if (payload.version === "v3" && payload.report) {
    teamsPayload = buildSimpleCardWithLink(payload.report, driveUrl);
  } else {
    const text = String(payload.text || "").trim();
    if (!text) return { ok: false, error: "empty text" };
    teamsPayload = buildAdaptiveCardPayload({
      title: payload.title || "AZS 일일 이슈 레포트",
      date: payload.date || "",
      bodyText: text,
      accentColor: "Default",
    });
  }

  const res = UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(teamsPayload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    logSend("send_report", payload, code);
    return {
      ok: true,
      msg: driveUrl ? "report archived + sent" : "report sent",
      responseCode: code, driveUrl: driveUrl, driveError: driveError,
    };
  }
  return { ok: false, error: "Teams webhook returned " + code, body: res.getContentText().slice(0, 500) };
}

function handleSendAlarm(payload, webhookUrl) {
  const text = String(payload.text || "").trim();
  if (!text) return { ok: false, error: "empty alarm text" };

  const teamsPayload = buildAdaptiveCardPayload({
    title: "🚨 AZS 즉시 알람",
    date: "[" + (payload.rule || "unknown") + "] " + new Date().toLocaleString("ko-KR"),
    bodyText: text,
    accentColor: "Attention",
  });

  const res = UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(teamsPayload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    logSend("send_alarm", payload, code);
    return { ok: true, msg: "alarm sent", responseCode: code };
  }
  return { ok: false, error: "Teams webhook returned " + code };
}

function handleSendDaily(payload, webhookUrl) {
  return handleSendReport(payload, webhookUrl);
}

function saveHtmlToDrive(payload) {
  const props = PropertiesService.getScriptProperties();
  const rootFolderId = props.getProperty("DAILY_REPORT_DRIVE_FOLDER_ID");
  if (!rootFolderId) throw new Error("DAILY_REPORT_DRIVE_FOLDER_ID not configured");
  if (!payload.html) throw new Error("html missing");

  const dateInfo = parseReportDate(payload.date);
  const yyyy = String(dateInfo.year);
  const mm = String(dateInfo.month).padStart(2, "0");
  const dd = String(dateInfo.day).padStart(2, "0");

  const rootFolder = DriveApp.getFolderById(rootFolderId);
  const yearFolder = getOrCreateSubfolderAS(rootFolder, yyyy);
  const monthFolder = getOrCreateSubfolderAS(yearFolder, mm);

  const reportType = payload.reportType || "daily";
  const reportTypeLabel = reportType === "weekly" ? "주간"
                        : reportType === "meeting" ? "회의" : "일일";
  let filename = yyyy + "-" + mm + "-" + dd + "_AZS_" + reportTypeLabel + "레포트.html";

  if (monthFolder.getFilesByName(filename).hasNext()) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    filename = yyyy + "-" + mm + "-" + dd + "_" + hh + "-" + min + "_AZS_" + reportTypeLabel + "레포트.html";
  }

  const blob = Utilities.newBlob(payload.html, "text/html;charset=utf-8", filename);
  const file = monthFolder.createFile(blob);

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    console.warn("[12-BE] 파일 공유 설정 실패:", shareErr.message);
  }

  return file.getUrl();
}

function parseReportDate(str) {
  if (!str) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  const s = String(str).trim();
  const slashMatch = s.match(/(\d{2,4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (slashMatch) {
    let year = parseInt(slashMatch[1], 10);
    if (year < 100) year += 2000;
    return { year: year, month: parseInt(slashMatch[2], 10), day: parseInt(slashMatch[3], 10) };
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function getOrCreateSubfolderAS(parentFolder, name) {
  const existing = parentFolder.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(name);
}

function buildSimpleCardWithLink(report, driveUrl) {
  const cardBody = [];
  cardBody.push({
    type: "TextBlock", text: "📊 " + (report.title || "AZS 일일 이슈 레포트"),
    size: "Large", weight: "Bolder", wrap: true,
  });
  if (report.date) {
    cardBody.push({
      type: "TextBlock", text: "📅 " + report.date, size: "Small",
      color: "Accent", isSubtle: true, spacing: "Small", wrap: true,
    });
  }

  const stats = report.stats || {};
  const statsLine =
    "📈 부동 " + (stats.totalIssues || 0) + "건 · " +
    "장기부동(30분+) " + (stats.longDowntime30 || 0) + "건 · " +
    "반복 카테고리 " + (stats.recurringCategories || 0) + "개";
  cardBody.push({
    type: "TextBlock", text: statsLine, wrap: true,
    spacing: "Medium", separator: true,
  });

  if ((report.topIssues || []).length > 0) {
    cardBody.push({
      type: "TextBlock", text: "⏱️ 장기부동 TOP " + Math.min(3, report.topIssues.length),
      weight: "Bolder", color: "Attention", spacing: "Medium", wrap: true,
    });
    report.topIssues.slice(0, 3).forEach(function(it, i) {
      const line = (i + 1) + ". " + (it.equipment || "?") + " — " +
                   (it.problem || "(문제 미기재)") +
                   (it.durationMin ? " (" + it.durationMin + "분)" : "");
      cardBody.push({
        type: "TextBlock", text: line, wrap: true,
        spacing: "Small", size: "Small",
      });
    });
  }

  if (!driveUrl) {
    cardBody.push({
      type: "TextBlock",
      text: "⚠️ Drive 아카이빙 실패 — 상세 레포트는 React에서 직접 다운로드하세요",
      wrap: true, spacing: "Medium", size: "Small",
      color: "Warning", isSubtle: true,
    });
  }

  cardBody.push({
    type: "TextBlock", text: "— ESHM AI 자동 발송 · " + new Date().toLocaleString("ko-KR"),
    size: "Small", isSubtle: true, spacing: "Medium",
    separator: true, horizontalAlignment: "Right", wrap: true,
  });

  const cardActions = [];
  if (driveUrl) {
    cardActions.push({ type: "Action.OpenUrl", title: "📎 상세 HTML 보기", url: driveUrl });
  }

  const adaptiveCard = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard", version: "1.4", body: cardBody,
  };
  if (cardActions.length > 0) adaptiveCard.actions = cardActions;

  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: adaptiveCard }],
  };
}

function buildAdaptiveCardPayload(opts) {
  const title = opts.title || "AZS 알림";
  const date = opts.date || "";
  const bodyText = opts.bodyText || "";
  const accentColor = opts.accentColor || "Default";

  const cardBody = [{
    type: "TextBlock", text: title, size: "Large",
    weight: "Bolder", color: accentColor, wrap: true,
  }];

  if (date) {
    cardBody.push({
      type: "TextBlock", text: date, size: "Small",
      color: "Accent", isSubtle: true, spacing: "Small", wrap: true,
    });
  }

  cardBody.push({
    type: "TextBlock", text: bodyText, wrap: true,
    spacing: "Medium", separator: true,
  });

  cardBody.push({
    type: "TextBlock", text: "— ESHM AI 자동 발송 · " + new Date().toLocaleString("ko-KR"),
    size: "Small", isSubtle: true, spacing: "Medium",
    separator: true, horizontalAlignment: "Right", wrap: true,
  });

  const adaptiveCard = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard", version: "1.4", body: cardBody,
  };

  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: adaptiveCard }],
  };
}

function logSend(action, payload, code) {
  try {
    const props = PropertiesService.getScriptProperties();
    const logSheetId = props.getProperty("LOG_SHEET_ID");
    if (!logSheetId) return;
    const ss = SpreadsheetApp.openById(logSheetId);
    let sheet = ss.getSheetByName("send_log");
    if (!sheet) sheet = ss.insertSheet("send_log");
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["timestamp", "action", "title", "date", "responseCode", "issuesCount"]);
    }
    sheet.appendRow([
      new Date().toISOString(), action, payload.title || "",
      payload.date || "", code, (payload.meta && payload.meta.issuesCount) || "",
    ]);
  } catch (err) {
    console.error("logSend failed:", err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 테스트 함수 (Apps Script 에디터에서 직접 실행)
// ════════════════════════════════════════════════════════════════════════════

function testPing() {
  const props = PropertiesService.getScriptProperties();
  console.log("TEAMS_WEBHOOK_URL:", props.getProperty("TEAMS_WEBHOOK_URL") ? "YES" : "NO");
  console.log("SHARED_SECRET:", props.getProperty("SHARED_SECRET") ? "YES" : "NO");
  console.log("DAILY_REPORT_DRIVE_FOLDER_ID:", props.getProperty("DAILY_REPORT_DRIVE_FOLDER_ID") ? "YES" : "NO");
}

function testSendReport() {
  const props = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty("TEAMS_WEBHOOK_URL");
  if (!webhookUrl) { console.error("TEAMS_WEBHOOK_URL not set"); return; }
  const result = handleSendReport({
    title: "테스트 메시지", date: "2026-04-29",
    text: "📊 Apps Script Proxy 배포 테스트", meta: { issuesCount: 0 },
  }, webhookUrl);
  console.log("Result:", JSON.stringify(result));
}

function testSendReportWithHtml() {
  const props = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty("TEAMS_WEBHOOK_URL");
  if (!webhookUrl) { console.error("TEAMS_WEBHOOK_URL not set"); return; }
  if (!props.getProperty("DAILY_REPORT_DRIVE_FOLDER_ID")) {
    console.error("DAILY_REPORT_DRIVE_FOLDER_ID not set"); return;
  }
  const fakeHtml = "<html><head><meta charset='utf-8'><title>AZS 테스트</title></head><body>" +
                   "<h1>AZS 일일 레포트 테스트</h1></body></html>";
  const result = handleSendReport({
    version: "v3", html: fakeHtml, date: "2026-05-08",
    reportType: "daily", title: "AZS 일일 이슈 레포트",
    report: {
      title: "AZS 일일 이슈 레포트", date: "26/5/8",
      stats: { totalIssues: 24, longDowntime30: 7, recurringCategories: 8, conditionChangeGroups: 0 },
      topIssues: [
        { rank: 1, score: 95, equipment: "STK-1-B4", problem: "Cell Overhang", durationMin: 65 },
        { rank: 2, score: 80, equipment: "STK-2-B4", problem: "Z Servo Fault", durationMin: 60 },
        { rank: 3, score: 70, equipment: "STK-4-A5", problem: "Ejector Timeout", durationMin: 50 },
      ],
      insights: [], actions: [],
    },
  }, webhookUrl);
  console.log("Result:", JSON.stringify(result, null, 2));
}
