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

// ─── STEP 4: 학습 현황 ────────────────────────────────────────────────────────
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

// ─── 메인 앱 ─────────────────────────────────────────────────────────────────
const TABS = [
  { id:0, icon:"💬", label:"채팅 학습" },
  { id:1, icon:"📋", label:"업무 규칙" },
  { id:2, icon:"🎯", label:"상황 교정" },
  { id:3, icon:"🧠", label:"학습 현황" },
];

export default function App() {
  const role = getRole();
  const roleInfo = role ? ROLE_CONFIG[role] : null;
  const [tab, setTab] = useState(0);
  const [knowledge, setKnowledge] = useState([]);
  const [loadingKB, setLoadingKB] = useState(false);

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

  // role 없을 때
  if (!role) {
    return (
      <div style={{
        minHeight:"100vh",
        background:"linear-gradient(150deg,#03060d,#060d1c 55%,#040810)",
        fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <div style={{ textAlign:"center", padding:40 }}>
          <div style={{ fontSize:40, marginBottom:16 }}>🏭</div>
          <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:8 }}>
            Factory Engineer AI 학습
          </div>
          <div style={{ fontSize:13, color:"#64748b", marginBottom:32 }}>
            역할을 선택해서 접속하세요
          </div>
          {["Cell","Elec"].map(line => (
            <div key={line} style={{ marginBottom:24 }}>
              <div style={{ fontSize:12, color:"#64748b", fontWeight:800,
                letterSpacing:2, marginBottom:12, textAlign:"center" }}>
                {line} 라인
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
        </div>
      </div>
    );
  }

  const panels = [
    <TabChat role={role} roleInfo={roleInfo}/>,
    <TabRules role={role} roleInfo={roleInfo}/>,
    <TabCorrection role={role} roleInfo={roleInfo} knowledge={knowledge}/>,
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
        <div style={{ marginLeft:"auto" }}>
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
