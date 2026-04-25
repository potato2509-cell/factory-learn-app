import { useState, useRef, useEffect } from "react";

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

// 파일을 Base64로 변환
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

async function saveToSheet(role, category, content) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_knowledge", role, category, content }),
    });
    return true;
  } catch { return false; }
}

async function loadFromSheet(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_knowledge&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 대시보드 - 전체 8개 에이전트 진행률 로드
async function loadAllProgress() {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_all_progress`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// JSON 파싱
function safeJSON(raw) {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("JSON 없음");
  return JSON.parse(cleaned.slice(s, e + 1));
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
    content:`안녕하세요! 저는 ${roleInfo.label}(${role}) AI입니다.\n\n지금부터 공장 상황과 업무 방식을 배워갈게요. 편하게 알려주세요.\n\n예를 들어:\n• 어떤 공장인지, 어떤 제품을 만드는지\n• 주요 공정 흐름\n• 평소 신경 쓰는 부분`,
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bottomRef = useRef();
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");
    const newMsgs = [...msgs, { role:"user", content:msg }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      const history = newMsgs.slice(0,-1).map(m => ({ role:m.role, content:m.content }));
      const system = `당신은 ${roleInfo.label} AI로 훈련 중입니다.
사용자가 공장 상황과 ${role} 업무를 알려주면 자연스럽게 대화하며 더 깊이 파악하세요.
모르는 부분은 추가 질문하고, 중요한 내용은 확인하세요.
수율/KPI 수치보다 실제 업무 흐름, 협업 방식, 현장 문제에 집중하세요.
150자 이내로 간결하게 한국어로 답하세요.`;
      const reply = await callClaude(system, msg);
      setMsgs(m => [...m, { role:"assistant", content:reply }]);
    } catch {
      setMsgs(m => [...m, { role:"assistant", content:"⚠️ 오류 발생. 다시 시도해주세요." }]);
    } finally { setLoading(false); }
  };

  const saveChat = async () => {
    setSaving(true);
    try {
      const conv = msgs.map(m => `${m.role==="user"?"사용자":"AI"}: ${m.content}`).join("\n");
      const system = `대화에서 ${roleInfo.label} 업무 정보를 추출해 JSON만 출력:
{"공장정보":"공장/제품/공정 요약","업무역할":"${role} 담당 업무","협업방식":"타 엔지니어 소통 방식"}`;
      const raw = await callClaude(system, conv);
      const parsed = safeJSON(raw);
      for (const [cat, content] of Object.entries(parsed)) {
        if (content) await saveToSheet(role, cat, content);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("저장 실패. 다시 시도해주세요."); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>💬 공장 & 업무 대화로 학습</div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          공장/제품/공정/업무 방식을 자유롭게 알려주세요
        </div>
      </div>

      {/* 가이드 버튼 */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
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
};

function TabRules({ role, roleInfo }) {
  const fields = RULE_FIELDS[role] || RULE_FIELDS[Object.keys(RULE_FIELDS)[0]];
  const [values, setValues] = useState(Object.fromEntries(fields.map((_,i) => [i, ""])));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      for (const [idx, content] of Object.entries(values)) {
        if (content.trim()) {
          const field = fields[parseInt(idx)];
          await saveToSheet(role, field.key, `[${field.label}] ${content}`);
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("저장 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>📋 업무 규칙 & 판단 기준</div>
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
      await saveToSheet(role, "교정사례", content);
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
    </div>
  );
}

// ─── STEP 4: 문서·사진 학습 ──────────────────────────────────────────────────
function TabDocument({ role, roleInfo }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [analyzed, setAnalyzed] = useState("");
  const [category, setCategory] = useState("판단기준");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();

  const CATEGORIES = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];
  const isImage = file && file.type.startsWith("image/");
  const isPDF = file && file.type === "application/pdf";
  const isDoc = file && (file.name.endsWith(".docx") || file.name.endsWith(".doc"));
  const isExcel = file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"));

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setAnalyzed("");
    setError("");
    // 이미지 미리보기
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview("");
    }
  };

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setAnalyzed("");
    try {
      const sys = `당신은 ${roleInfo.label}(${role}) AI입니다.
업로드된 파일 내용에서 ${role} 업무와 관련된 핵심 정보를 추출하세요.
카테고리: ${category}
한국어로 핵심 내용만 간결하게 정리하세요. 200자 이내로.`;

      let result = "";

      if (isImage) {
        // 이미지 처리 - Claude Vision
        const base64 = await fileToBase64(file);
        result = await callClaudeVision(
          sys,
          `이 이미지에서 ${role} 업무 관련 핵심 내용을 추출해주세요.`,
          base64,
          file.type
        );
      } else {
        // 텍스트 파일 처리
        let text = await extractTextFromFile(file);
        if (!text || text.length < 10) {
          // 텍스트 추출 실패 시 파일명으로 분석
          text = `파일명: ${file.name}`;
        }
        // 너무 길면 잘라서 전달
        const truncated = text.slice(0, 2000);
        result = await callClaude(sys, `다음 내용에서 핵심을 추출하세요:
${truncated}`);
      }

      setAnalyzed(result);
    } catch(e) {
      setError(`분석 실패: ${e.message}`);
    } finally { setLoading(false); }
  };

  const save = async () => {
    if (!analyzed) return;
    setSaving(true);
    try {
      const contentToSave = `[파일: ${file.name}] ${analyzed}`;
      await saveToSheet(role, category, contentToSave);
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
      <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
        {[
          { label:"PDF", color:"#ef4444" },
          { label:"Word", color:"#3b82f6" },
          { label:"Excel", color:"#22c55e" },
          { label:"JPG/PNG", color:"#f97316" },
        ].map(t => (
          <span key={t.label} style={{
            background:`${t.color}15`, border:`1px solid ${t.color}30`,
            color:t.color, borderRadius:5, padding:"2px 10px",
            fontSize:10, fontWeight:800,
          }}>{t.label}</span>
        ))}
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
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
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

      {/* 카테고리 선택 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:10, color:"#475569", fontWeight:800, letterSpacing:1.2, marginBottom:6 }}>
          저장 카테고리
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
        {loading ? <><Spinner/>분석 중...</> : "🔍 AI 분석"}
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
          <SaveBtn onClick={save} saving={saving} saved={saved}/>
        </div>
      )}
    </div>
  );
}

// ─── STEP 5: 학습 현황 ────────────────────────────────────────────────────────
function TabStatus({ role, roleInfo, knowledge, onReload, loading }) {
  const progress = calcProgress(knowledge);

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

      <button onClick={onReload} disabled={loading} style={{
        width:"100%", padding:"10px", marginTop:8,
        background:"rgba(51,65,85,0.3)", border:"1px solid rgba(51,65,85,0.4)",
        borderRadius:8, color:"#64748b", fontSize:12, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      }}>
        {loading ? <><Spinner/>로딩 중...</> : "🔄 최신 데이터 불러오기"}
      </button>

      {/* 저장된 내용 */}
      {knowledge.length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, color:"#374151", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
            📋 저장된 학습 내용 ({knowledge.length}건)
          </div>
          {knowledge.map((k,i) => (
            <div key={i} style={{
              background:"rgba(8,14,26,0.7)", border:"1px solid rgba(51,65,85,0.3)",
              borderRadius:8, padding:"10px 13px", marginBottom:7,
            }}>
              <div style={{ fontSize:10, color:roleInfo.color, fontWeight:700, marginBottom:4 }}>
                {k.category}
              </div>
              <div style={{ fontSize:11.5, color:"#94a3b8", lineHeight:1.6 }}>
                {k.content}
              </div>
              <div style={{ fontSize:9.5, color:"#374151", marginTop:4 }}>{k.updated_at}</div>
            </div>
          ))}
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
  { id:4, icon:"🧠", label:"학습 현황" },
];

export default function App() {
  const role = getRole();
  const roleInfo = role ? ROLE_CONFIG[role] : null;
  const [tab, setTab] = useState(0);
  const [knowledge, setKnowledge] = useState([]);
  const [loadingKB, setLoadingKB] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  const loadKB = async () => {
    if (!role) return;
    setLoadingKB(true);
    try {
      const data = await loadFromSheet(role);
      setKnowledge(data);
    } catch {}
    finally { setLoadingKB(false); }
  };

  useEffect(() => { loadKB(); }, [role]);

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
    <TabStatus role={role} roleInfo={roleInfo} knowledge={knowledge} onReload={loadKB} loading={loadingKB}/>,
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
        {panels[tab]}
      </div>

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
