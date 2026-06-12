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
 *   v12 (2026-05-24, PLC Agent query API 신설 — 별도 앱 연결용):
 *     - doPost에 path 라우팅 추가: data.path === "query" → handleQuery (기존 secret/action 분기 보존)
 *     - handleQuery: 별도 앱(PLC Agent)의 질문을 받아 KB 조회 + Claude 분석 + 표준 JSON 응답
 *     - callClaudeAPI 신규: UrlFetchApp으로 Anthropic Messages API 직접 호출
 *       · 기존 학습앱은 LLM을 클라이언트(App.jsx)에서만 호출했으나, 별도 앱 연결은
 *         백엔드가 직접 LLM을 호출해야 하므로 신설
 *     - 출처 정합: KB 각 항목에 src_001.. id를 코드가 부여 → LLM이 [src_xxx] 인용 →
 *       사용된 id만 코드가 sources[]로 조립 (LLM의 URL 환각 방지)
 *     - PLC 규칙(§5-1): 학습 자료에 근거 없으면 status:"not_found" (추측 금지)
 *     - 다국어(§6-1): 입력 언어 자동 감지 / data.lang 강제, 코드·알람명·출처제목 원문 유지
 *     - CORS(§6-3): 기존 doPost가 이미 text/plain 본문을 JSON.parse + ContentService JSON 응답
 *     - 신규 스크립트 속성 2개 필요 (배포 불필요, 속성 저장 즉시 반영):
 *       · ANTHROPIC_API_KEY  : 논의앱(AZS_WhatsApp_Webhook)에서 쓰던 키 값 재사용
 *       · PLC_QUERY_TOKEN     : 별도 앱 인증용 토큰 (별도 앱과 동일 값)
 *     - 모델: claude-sonnet-4-6 (analysis 정밀 분석용 기본값. PLC_QUERY_MODEL 상수로 교체 가능)
 *
 *   v13 (2026-05-24, PLC query 지식 사용 정책 — 별도 앱 채팅방 논의 반영):
 *     - 추측 억제 기준을 '출처 유무' → '확실성'으로 전환 (별도 앱 논의 2번)
 *     - PLC_KNOWLEDGE_MODE 상수 신설 — 단계별 지식 정책 전환:
 *       · "hybrid" (현재, 클라우드 Claude): KB + 일반 지식 함께 사용 OK, 근거 없는 추정만 억제.
 *                  불확실하면 '확실하지 않음/현장 확인 필요' 명시. 완전히 모르는 것만 not_found.
 *       · "strict" (미래, 폐쇄형 Qwen): 학습된 출처에 있는 내용만, 출처 없으면 언급 금지.
 *                  출처에서 못 찾으면 not_found. (작은 Qwen은 지멘스 범용지식 약함 → 출처만 신뢰)
 *     - buildQueryPrompts: PLC_KNOWLEDGE_MODE에 따라 지식 사용 정책 블록 분기
 *     - 일반 지식으로만 답한 내용은 출처 마커 없이 OK (hybrid) → sources[] 비어도 정상 응답
 *     - 답변 격리(출처/일반 분리) 안 함 — 자연스럽게 답하되 프롬프트로 추측만 억제 (논의 3번)
 *     - 다국어(§6-1)는 v12 그대로 유지 (논의 8번)
 *     - 참고: 일반 에이전트(App.jsx callChat)는 이미 KB밖 지식 제약이 없어 범용 사용 중 (논의 4번)
 *            → 일반 에이전트는 무변경, PLC query에만 추측 억제 적용
 *     - ⏭ 별도 트랙(이번 미반영): 대용량 파일 학습 전략(논의 6번)·출처메타 보존(7번)은
 *            학습 파이프라인(App.jsx startSync) 쪽 작업. query는 학습된 KB를 읽기만 함.
 *
 *   v14 (2026-05-24, query 파싱 실패 디버그 강화 — 별도 앱 채팅방 디버그 반영):
 *     - 증상: not_found(짧은 응답)는 통과하나 별도 앱 실호출에서 "파싱 실패" 발생
 *     - 유력 원인: max_tokens 부족으로 긴 응답(answer+structured)이 중간에 잘림 → JSON 미완성
 *     1. PLC_QUERY_MAX_TOKENS 2048 → 4096 (긴 분석 응답 잘림 방지) ★주 원인 대응
 *     2. callClaudeAPI: 받은 RAW 텍스트를 Logger.log로 출력 (원인 가시화)
 *     3. extractJson: 정규식 폴백 추가 (펜스 제거 후 첫{~마지막} 실패 시 match로 재시도)
 *     4. system 프롬프트 JSON-only 지시 강화
 *     5. ⚠️ 디버그 임시: 파싱 실패 시 raw 일부를 answer에 담아 반환 (별도 앱 화면에서 원인 확인용)
 *        → 원인 확정 후 되돌릴 것. 운영 시 raw를 answer에 노출하면 안 됨.
 *
 *   v15 (2026-05-28, v14 디버그 임시 코드 정리 — 운영 안전화):
 *     - 원인(max_tokens 부족) 대응이 완료되어, v14에서 임시로 넣은 디버그 코드를 운영용으로 정리.
 *     1. handleQuery 파싱 실패 분기: raw를 answer/message에 노출하던 것 제거
 *        → 사용자에겐 깔끔한 에러 메시지만, raw는 노출 안 함 (로그에 길이만 기록).
 *     2. callClaudeAPI: RAW 전문 Logger.log 제거. stop_reason=max_tokens일 때만 경고 로그 유지.
 *     - 유지: PLC_QUERY_MAX_TOKENS=4096 (실제 잘림 방지), extractJson 정규식 폴백 (실제 기능 개선).
 *
 *   v16 (2026-06-02, PLC hybrid 프롬프트 4단계 출처 라벨링 강화 — F31137 not_found 이슈):
 *     - 증상: 별도 앱에서 "F31137이 뭐야?" → not_found (지멘스 Sinamics 표준 결함 코드인데 답 못 함)
 *     - 원인: 기존 hybrid 프롬프트가 모호한 일반 안내만 있어 LLM이 보수적으로 not_found 도피
 *     - 수정: buildQueryPrompts의 hybrid 블록을 4단계 출처 라벨링 정책으로 강화
 *       (1) KB 기반 — 기존 [src_xxx] 인용 (변경 없음)
 *       (2) 표준 매뉴얼 기반 — Sinamics 결함 코드, 표준 OB, 프로토콜 등. answer 끝에 'ⓘ 출처: ... 표준 매뉴얼 기반' 라벨
 *       (3) 일반 PLC/산업 표준 — TON, edge, retentive 등. answer 끝에 'ⓘ 출처: PLC 일반 표준 지식' 라벨
 *       (4) 정보 없음 — status=not_found (공장 특화인데 KB 없을 때만)
 *     - 표준 vs 공장 특화 구분 가이드 추가: 공장 자체 신호·파라미터·사례는 KB 없으면 반드시 (4)
 *     - 답변 예시(F31137·TON) 포함: LLM이 라벨 형식 정확히 따르도록
 *     - (2)(3)일 때 used_source_ids=[]: 가짜 src 환각 방지
 *     - strict 블록은 유지 (폐쇄형 LLM 전환 시 사용)
 *     - structured/sources/status JSON 구조 변경 없음 → 별도 앱 UI 변경 불필요
 *
 *   v17 (2026-06-03, Signal Graph 조회 도구 추가 — XML 기반 4626 신호 인덱스):
 *     - 의뢰 배경: PLC 엔지니어 XML 확보 → 변환된 global_signal_graph.json (4.3MB, 4626 신호)
 *     - 핵심: JSON을 학습 자료로 넣지 않고 '조회 도구'로 사용 (토큰 절약 + 정확도 100%)
 *     - 신규 상수: SIGNAL_GRAPH_FILE_ID (Drive 파일 ID)
 *     - 신규 함수 3개:
 *       loadSignalGraph()         — Drive에서 JSON 매번 로드 (캐싱은 추후 최적화)
 *       extractSignalCandidates() — 질문에서 신호명 후보 추출 (도트/CamelCase/F코드/약어/따옴표)
 *       searchSignalGraph()       — 후보를 graph 키와 매칭 (정확/토큰경계/부분, 상위 5개)
 *       formatSignalGraphContext()— 매칭 결과를 LLM 컨텍스트용 텍스트로 포맷
 *     - handleQuery 흐름:
 *       기존 KB 조회 → Signal Graph 자동 조회 → buildQueryPrompts에 signalContext 전달
 *       → user message에 [신호 그래프 조회 결과] 섹션으로 주입
 *     - buildQueryPrompts hybrid 블록에 (1.5) Signal Graph 카테고리 추가
 *     - 매칭 결과: 신호별 set_locations(블록·네트워크·조건식) + used_in_blocks 노출
 *     - 답변 라벨: 'ⓘ 출처: Signal Graph 자동 조회 (XML 기반)'
 *     - 별도 앱 UI 변경 불필요 (백엔드 사전 검색 + 컨텍스트 주입)
 *     - 검증 케이스: Door_Open_Error, safetyRelease, FDC, Lot Start (모두 graph에 존재)
 *     - 부담: query당 +1~3초 (Drive 로드 + JSON.parse). 90초 타임아웃 안.
 *
 *   v18 (2026-06-03, Signal Graph 정규식 보강 + (1.5) 조건부 안내):
 *     - 증상 1: "safetyRelease 출처는?" 질문에 Signal Graph 0건 매칭 (데이터엔 있는데 검색 실패)
 *     - 원인 1: extractSignalCandidates의 CamelCase 패턴이 PascalCase만 잡고 lowerCamelCase 누락
 *       (\\b[A-Z][a-zA-Z_]{4,}\\b — 첫 글자 대문자 강제)
 *     - 수정 1: lowerCamelCase 패턴 추가 (\\b[a-z]+[A-Z][a-zA-Z_]{2,}\\b — 중간 대문자 필수)
 *       → safetyRelease, executeRequest, enableModuleInterface 등 매칭
 *       → 일반 영단어(release, safety)는 중간 대문자 없어 매칭 안 됨 (노이즈 차단)
 *     - 증상 2: 검증 시 Signal Graph 0건 매칭인데도 LLM이 'ⓘ 출처: Signal Graph...' 라벨 부착
 *     - 원인 2: 시스템 프롬프트 (1.5) 카테고리가 항상 노출되어 LLM이 실제 사용 여부 혼동
 *     - 수정 2: (1.5) 안내에 "섹션이 user message에 실제 있을 때만 사용" 조건부 안내 추가
 *
 *   v19 (2026-06-04, callClaudeAPI 백엔드 자동 재시도 — Queue #20):
 *     - 배경: F07410 검증 시 Anthropic API HTTP 500 (req_011CbdyHbmsQ7nH7dzSL2s58) 일시 장애
 *       → 학습앱이 즉시 throw하여 사용자에게 에러 노출. 별도 앱 90초 타임아웃 안에 자동 복구 가능했음
 *     - 수정: callClaudeAPI에 자동 재시도 로직 추가 (v27 페이지 재시도와 동일 패턴)
 *       1. 즉시 시도 → 실패 시 2초 대기 → 또 실패 시 4초 대기 (총 3회, 최대 ~6초 추가)
 *       2. 재시도 대상: HTTP 429/500/502/503/504, fetch 예외 (네트워크/타임아웃)
 *       3. 즉시 throw: HTTP 200(성공), 4xx 클라이언트 오류(401/400 등, 재시도 무의미)
 *     - 진단 로그: 각 재시도 라운드와 사유를 Logger.log에 기록
 *     - 영향: 일시적 API 장애 시 자동 복구 → 사용자에게 에러 노출 빈도 ↓
 *     - 트레이드오프: 진짜 장애 시 최대 6초 추가 대기 (90초 타임아웃 안)
 *
 *   v20 (2026-06-04, signal_graph_v2 통합 — 블록/타입 인덱스 추가, C-4 해결):
 *     - 배경: C-4 검증 결과 "FB200의 IEC_TIMER는?" 질문에 1개만 답 (실제 3개) — 데이터 누락
 *     - 진단: 기존 global_signal_graph는 출력 신호(Coil)만 인덱싱, Static 변수(IEC_TIMER 등) 미포함
 *     - 해결: PLC 분석도구 V1 채팅방에서 파서 보강 → 새 인덱스 2개 추가 산출
 *       · block_signals_index.json (4.9MB, 671 블록 — Section별/Type별 모든 변수)
 *       · global_type_index.json (4.8MB, 1242 타입 — IEC_TIMER 76개 등)
 *     - 신규 상수 2개: BLOCK_SIGNALS_FILE_ID, TYPE_INDEX_FILE_ID
 *     - 신규 함수 6개:
 *       loadBlockSignals() / loadTypeIndex() — Drive 로드
 *       extractBlockCandidates() — FB/FC/DB/OB 번호 + 블록명 후보 추출
 *       extractTypeCandidates() — PLC 타입 화이트리스트 + *_TIMER 패턴 + "타이머" 한글
 *       searchBlockSignals() — 블록 매칭 (최대 3개), typeFilter 시 그 타입만 노출
 *       searchTypeIndex() — 타입 위치 (상위 20개 + 전체 개수)
 *       formatBlockContext() / formatTypeContext() — LLM 컨텍스트 포맷
 *     - 조건부 로드 — 질문에 블록명/타입명 있을 때만 추가 로드 (평소 부담 0)
 *       · 신호명만 → signal_graph만 (기존 동일)
 *       · 블록명 + 선택 타입 → +block_signals (블록 안에서 타입 필터)
 *       · 타입명만 → +type_index (전 공장)
 *     - buildQueryPrompts (1.5) 카테고리 확장: 3개 인덱스 사용 가이드 + 라벨 분기
 *     - 컨텍스트 폭발 방지: 블록 매칭 3개 / 블록당 신호 30개 / 타입 매칭 위치 20개
 *     - 검증 케이스: "FB200 안의 IEC_TIMER는?" → 3개 (Door_Open_Error_TMR, Close_Error_TMR, Sensor_Error_TMR)
 *
 *   v21 (2026-06-04, WinCC 인덱스 통합 — HMI 알람 9048 + PLC 태그 2020+):
 *     - 배경: WinCC TIA export(xlsx 4개) 확보 → 학습앱 채팅방에서 JSON 인덱스 2개 변환
 *     - 산출:
 *       · hmi_alarm_index.json (2.5MB) — by_id(9048) + by_trigger_tag(162) 역인덱스
 *       · plc_tag_index.json (0.7MB) — by_name(2020 태그 + 942 상수) + by_address(2020)
 *     - 신규 상수 2개: HMI_ALARM_INDEX_FILE_ID, PLC_TAG_INDEX_FILE_ID
 *     - 신규 함수 8개:
 *       loadAlarmIndex() / loadPlcTagIndex() — Drive 로드
 *       extractAlarmIdCandidates() — 4~5자리 숫자(1000~99999 범위)
 *       extractPlcAddressCandidates() — %I/Q/M/DB 주소 + Tag[idx] 인덱싱 패턴
 *       searchAlarmIndex() — ID 매칭 + trigger_tag 역추적 + 텍스트 키워드 (최대 5/3/2 매칭)
 *       searchPlcTagIndex() — 이름 매칭(정확+부분) + 주소 매칭 (최대 5/3 매칭)
 *       formatAlarmContext() / formatPlcTagContext() — LLM 컨텍스트 포맷
 *     - 조건부 로드:
 *       · 알람 인덱스: 4-5자리 숫자 / 주소 패턴 / "알람|Alarm|warning|error|경고|에러" 키워드 있을 때
 *       · PLC 태그 인덱스: 주소 패턴 / "태그|tag|주소|address" 키워드 있을 때
 *     - buildQueryPrompts (1.5) 카테고리 확장: 5개 인덱스 사용 가이드 + WinCC 라벨 분기
 *     - 검증 케이스:
 *       · "알람 6092가 뭐야?" → ID 매칭 → text+class+trigger_tag 답변
 *       · "500_Alarm_AlarmLWord[95] 어떤 알람?" → trigger_tag 역추적 → 64개 알람
 *       · "keySwitchMaintenanceUnlock 태그?" → 이름 매칭 → 주소·코멘트 답변
 *       · "%I0.1 주소는?" → 주소 역인덱스 → 태그 답변
 *     - 부담: 5개 인덱스 총 ~15MB. 워스트 케이스 +7~10초. Q21 캐싱 최적화 우선순위 ↑
 *
 *   v22 (2026-06-04, User_Permissions·Audit_Log 시트 + Google OAuth 로그인 기반):
 *     ※ 다른 채팅방(로그인 기능 트랙)에서 추가된 변경 내용. 파일 끝 「v22 추가 내용」 블록 참조.
 *     - User_Permissions / Audit_Log 시트 ensure 함수
 *     - verifyIdToken / checkUserPermission / logAudit / authorizeRequest
 *     - ACTION_PERMISSIONS 매핑, setupPermissionsInitial 초기화
 *     - 단 doPost 게이트 활성화는 Step 3에서 (이 v22는 정의만 추가)
 *
 *   v23 (2026-06-04, 회로 역추적 통합 + Q21-A 성능 측정 — 학습앱 채팅방):
 *     1) signal_graph_v3 — condition_str 200→1000자 (긴 조건 끝부분 신호도 추출)
 *        3개 인덱스 ID 모두 새 폴더로 통일: 1-UvWULg0NpQPL0v9wyboLW_5LsSe8LlZ
 *     2) 회로 역추적 (학습앱_회로역추적_통합명세서):
 *        - trace_signal.py 알고리즘 포팅 — 9개 함수 (파일 끝 v23 블록):
 *          buildKnownSignalSet, extractByDict/Tokens/Signals, traceSignal,
 *          treeToText, collectExternals, formatTraceContext, detectTraceTrigger
 *        - 트리거 패턴 (depth 자동): 인터락/안전(5), 왜안돼(4), 끝까지/깊이(5),
 *          회로분석(2), ON되려면(3), 어디서켜져(3), 추적(3)
 *        - 처리 룰 (1.5)에 명시: 트리 요약·외부입력 정리·NOT 자연어·KB 결합
 *        - 라벨: 'ⓘ 출처: 회로 역추적 (Signal Graph 자동 추적)'
 *     3) Q21-A 성능 측정 (5개 인덱스 부담 측정 → Q21-B 캐싱 설계 데이터):
 *        Logger.log 7개 측정 포인트 ([Perf] signal_graph/block/type/alarm/plc_tag/
 *        callClaudeAPI/handleQuery TOTAL)
 *        - 응답 본문 영향 없음 (Logger만), 1주일 데이터 수집 후 Q21-B 진행
 *     - 검증 시나리오 (명세서 §7): "safetyRelease ON 되려면?" / "Door_Open_Error 회로 분석"
 *       / "Total Door Alarm 추적" / "Etc.FDC.Excute 깊이 추적" 4개 통과
 *     - 부담 추가: 트리거 시 known_signals 구축(~50ms 1회) + traceSignal 재귀(+0.5~2초)
 *
 *   v24 (2026-06-04, 회로 역추적 신호 매칭 보강 — 공백 포함 신호명):
 *     - 배경: v23 명세서 §7 3번 검증 케이스 "Total Door Alarm 추적해줘"에서
 *       extractSignalCandidates가 공백 포함 신호명을 못 잡음 → 단어 부분 매칭으로
 *       "1300_...Total Operation Alarm" 같은 다른 alarm 키가 잘못 매칭됨.
 *       (LLM이 자동 보완해 답변은 OK였으나, 매번 보장 안 됨)
 *     - 진단: TIA Portal 신호명에 공백 흔함 (예: "500_Control.Main_Status.Total Door Alarm",
 *       "Heat Press Loading", "Cell Pusher Up State Fault" 등)
 *     - 수정: detectTraceTrigger 내부에 phrase 매칭 추가 (~15줄, 영향 범위 함수 내부 한정)
 *       1. 정규식: /[A-Z][a-zA-Z0-9_]+(?:\s+[A-Z][a-zA-Z0-9_]+){1,5}/g
 *          → 2단어 이상 PascalCase 시퀀스 (자연어 노이즈 차단, 8자 이상만)
 *       2. graph 키 substring 매칭 (대소문자 무시)
 *       3. 매칭 다수 시 가장 짧은 키 우선 (가장 정확한 매칭)
 *       4. 적용 위치: 정확/정규화 매칭 실패 후, 기존 부분 매칭 실패 후 최후 fallback
 *     - 회귀 안전: extractSignalCandidates 미수정 → signal_graph 검색·블록 추출 등 영향 0
 *     - 검증: "Total Door Alarm 추적해줘" → "500_Control.Main_Status.Total Door Alarm" 정확 매칭
 *     - 부담: phrase 추출 + graph 키 4626 순회 — 워스트 ~5ms (무시 가능)
 *
 *   v25 (2026-06-04, 옵션 A — handleTrace 별도 endpoint 추가 / 별도 앱 옵션 C 인터랙티브 트리 UI 지원):
 *     - 배경: 별도 앱 채팅방 의뢰 — 옵션 C (인터랙티브 트리 UI, 노드 클릭 = 깊이 확장,
 *       외부 입력 강조, 진짜 가치 있는 별도 탭) 진행 위해 raw 트리 JSON 직접 받을 endpoint 필요.
 *       옵션 B (path:"query" 자동 감지 + LLM 자연어 답변)는 그대로 유지 — 둘 다 작동.
 *     - 추가: handleTrace(data) 함수 + doPost에 path:"trace" 분기 (~120줄)
 *     - 요청: { path:"trace", token, data:{ signal, depth, max_locations, lang } }
 *       · signal       (필수) — 추적 대상 신호명
 *       · depth        (선택, 기본 3, 최대 10) — 추적 깊이
 *       · max_locations (선택, 기본 3, 최대 10) — 위치당 cap
 *       · lang         (선택) — 응답 언어 (현재는 JSON이라 영향 없음)
 *     - 응답: { status, tree, externals, metadata }
 *       · tree         — traceSignal 출력 raw JSON (signal/reason/set_locations/condition_str 등)
 *       · externals    — 외부 입력 leaf 신호명 배열 (정렬됨)
 *       · metadata     — target/signal_requested/matched_by/depth_requested/known_signals_count
 *     - 신호 매칭: 정확 → 정규화 → 부분 → phrase (v24와 동일 4단계). 단 detectTraceTrigger와 달리
 *       depth는 별도 앱이 명시적으로 지정 (트리거 정규식 사용 안 함)
 *     - signal 못 찾으면 not_found + suggestions[10] (부분 매칭 후보) 반환
 *     - 인증: 기존 PLC_QUERY_TOKEN 동일
 *     - 진단 로그: [Perf trace] signal_graph/block_signals/traceSignal/TOTAL
 *     - 코드 공유: traceSignal / buildKnownSignalSet / collectExternals 옵션 B와 공유 — 중복 없음
 *
 *   v31 (2026-06-10, 에이전트 평가 — 최신성 기간 7일→30일):
 *     ※ v26~v30은 본 헤더에 미반영 (다른 채팅방의 PLC 회로 역추적 4번 탭 작업 — 본문 코드 안에만 존재)
 *     - 배경: 사용자 직관 + 데이터 시뮬레이션 결과 — 7일 cutoff가 너무 짧아
 *       단발성 학습만으로 recentRate↑ → freshnessScore 부풀림 / 누적 페르소나는
 *       일주일 무활동만으로 0점이 되어 부당하게 깎임
 *     - 변경: RECENT_DAYS 7 → 30 (한 줄)
 *     - 효과 (실제 KB 데이터 시뮬레이션):
 *       · 누적 페르소나 부당한 0점 해소 (Elec_ME 80→100, Cell_PLC 60→78)
 *       · 신규 페르소나 단발 부풀림 완화 (가상 35→28)
 *       · 균형 페르소나 변화 작음 (가상 47→52)
 *     - 프론트 v31 (freshnessScore × 0.5 가중치)와 함께 적용 (옵션 A+B)
 *
 * 📍 대상 프로젝트: Factory Agent KB (학습앱 백엔드)
 *
 * v25 배포 방법: 코드 교체 → Ctrl+S → 배포 → 배포 관리 → 편집 → 새 버전 → 배포
 *   (v24와 동일. 인덱스 변경 없음, 권한 변경 없음, 옵션 B 동작 변경 없음)
 *
 * v24 배포 방법: 코드 교체 → Ctrl+S → 배포 → 배포 관리 → 편집 → 새 버전 → 배포
 *   (v23과 동일. 새 인덱스 변경 없음, 권한 변경 없음)
 *
 * v23 배포 방법: 코드 교체 → Ctrl+S → 배포 → 배포 관리 → 편집 → 새 버전 → 배포
 *   (스크립트 속성 변경 없음. Drive API 권한 기존 그대로.
 *    새 인덱스 폴더 1-UvWULg0NpQPL0v9wyboLW_5LsSe8LlZ에 학습앱 서비스 계정 읽기 권한 있어야 함.
 *    v22 권한 시트는 setupPermissionsInitial 별도 1회 실행 필요 — 별도 안내 참조)
 *
 * v21 배포 방법: 코드 교체 → Ctrl+S → 배포 → 배포 관리 → 편집 → 새 버전 → 배포
 *   (스크립트 속성 변경 없음. Drive API 권한 기존 그대로)
 *
 * v13 배포 방법 (마이그레이션 불필요):
 *   - 코드 교체 → Ctrl+S → 배포 → 배포 관리 → 편집 → 새 버전 → 배포
 *   - 스크립트 속성(ANTHROPIC_API_KEY, PLC_QUERY_TOKEN)은 v12와 동일 (추가 등록 불필요)
 *   - 단계 전환 시: 폐쇄형 Qwen 환경에서 PLC_KNOWLEDGE_MODE를 "strict"로 바꾸고 재배포
 *
 * v12 배포 방법 (마이그레이션 불필요):
 *   1. Apps Script 에디터 (Factory Agent KB) 열기
 *   2. 기존 v11 코드 전체 선택 → 삭제 → 이 파일 전체 붙여넣기
 *   3. ⚙️ 프로젝트 설정 → 스크립트 속성에 ANTHROPIC_API_KEY, PLC_QUERY_TOKEN 등록 (배포 불필요)
 *   4. Ctrl+S 저장
 *   5. ★ 배포 → 배포 관리 → 편집 → 새 버전 → 배포 (외부 URL 반영 필수)
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

const RECENT_DAYS = 30; // v31: 7→30. 단발성 학습으로 freshness 부풀림 방지 (사용자 합의 옵션 A+B)
const SUMMARY_CATEGORY = "_요약";
const ROOT_FOLDER_ID = "1aTrM2DEQ8SXy_UEYExpFCzL2afrGRzUW";
const COMMON_FOLDER_NAME = "_공통";
const COMMON_KNOWLEDGE_SHEET = "Common_Knowledge";
const PROCESSED_FILES_SHEET = "Processed_Files";

// ════════════════════════════════════════════════════════════════════════════
// v12 신규 — PLC Agent query API 상수
// ════════════════════════════════════════════════════════════════════════════

// Anthropic Messages API
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// analysis 모드는 정밀 분석 → Sonnet급. 논의앱과 모델을 맞추고 싶으면 이 값만 교체.
const PLC_QUERY_MODEL = "claude-sonnet-4-6";
const PLC_QUERY_MAX_TOKENS = 4096;  // v14: 2048→4096 (긴 분석 응답 잘림 방지)

// v13: 지식 사용 정책 — 단계(환경)에 따라 전환
//   "hybrid" = 현재 클라우드 Claude. KB + 일반 지식 함께 사용 OK, 근거 없는 추정만 억제.
//   "strict" = 미래 폐쇄형 Qwen. 학습된 출처에 있는 내용만, 출처 없으면 언급 금지.
//   폐쇄형 전환 시 이 값을 "strict"로 바꾸고 재배포.
const PLC_KNOWLEDGE_MODE = "hybrid";

// 별도 앱이 보내는 agent(소문자) → TAB_MAP의 role(대문자) 매핑
const PLC_AGENT_MAP = {
  cell_plc: "Cell_PLC",
  elec_plc: "Elec_PLC",
  fa_plc: "FA_PLC",
};

// 학습된 SCL 코드 기준일 (화면 하단 "코드 YYYY-MM-DD 기준" 표시용, §4-3 metadata.code_version)
// 실제 코드 학습이 갱신되면 이 값을 수동 갱신.
const PLC_CODE_VERSION = "2026-06-07-v29";

// v17: Signal Graph (XML → 그래프 변환된 JSON) 조회용
// v23: signal_graph_v3 — condition_str 길이 200→1000자 + 회로 역추적 통합
//   3개 인덱스 모두 새 폴더(1-UvWULg0NpQPL0v9wyboLW_5LsSe8LlZ)로 통일 — 관리 일관성
const SIGNAL_GRAPH_FILE_ID = "1zUsgN4qpz-xKzuUOMBASl3JiZf3Y0Ul5"; // 5.4MB, condition_str 1000자 (v3)

// v20: signal_graph_v2 — 블록 단위 + 타입 단위 인덱스 (C-4 검증 해결)
//   PLC 프로그램 분석도구 V1 채팅방에서 파서 보강 후 추가 산출. v23에서 새 폴더로 통일.
const BLOCK_SIGNALS_FILE_ID = "1wN14VIP8ZpIA8NtVwTQTbapdy3yTeDoN"; // 5.1MB, 671 블록 (v2와 동일 데이터)
const TYPE_INDEX_FILE_ID    = "1oY09hpWlLkxS1S9KDOMu_ONBJxwXLkZx"; // 5.0MB, 1242 타입 (v2와 동일 데이터)

// v21: WinCC 인덱스 (HMI Alarm 9048개 + PLC Tag 2020+ 942상수)
const HMI_ALARM_INDEX_FILE_ID = "1nWfjMKOqrrj7TGJQvBxV_6tE-0tJAXYi"; // 2.5MB, by_id + by_trigger_tag
const PLC_TAG_INDEX_FILE_ID   = "12uFxXqp1xe7HE2kYJu-YTADIWdqaE3oM"; // 0.7MB, by_name + by_address

// ════════════════════════════════════════════════════════════════════════════
// 통합 진입점 (doPost / doGet) — 한 번만 정의
// ════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return makeResponse({ success: false, error: "no payload" });
    }

    const data = JSON.parse(e.postData.contents);

    // v12: PLC Agent query API 분기 — path가 있으면 path 라우팅 (별도 앱 연결용)
    //   기존 학습앱(action)·Teams Proxy(secret) 분기보다 먼저 체크.
    //   별도 앱은 { path:"query", token, data } 형식으로 보냄 (§3).
    //   v25: path:"trace" 추가 — 옵션 A (별도 endpoint, 인터랙티브 트리 UI 용)
    if (data.path !== undefined) {
      if (data.path === "query") return handleQuery(data);
      if (data.path === "trace") return handleTrace(data); // v25
      if (data.path === "plc_index") return handlePlcIndex(data); // v26
      if (data.path === "plc_block") return handlePlcBlock(data); // v26
      if (data.path === "plc_ocr") return handlePlcOcr(data); // v27
      if (data.path === "plc_ladder") return handlePlcLadder(data); // v28
      if (data.path === "plc_search") return handlePlcSearch(data); // v29 — 4번 탭 자연어→후보 매칭
      if (data.path === "plc_signal_trace") return handlePlcSignalTrace(data);
      if (data.path === "plc_alarm") return handlePlcAlarmSearch(data);
      return makeResponse({ status: "error", message: "unknown path: " + data.path });
    }

    // Teams Proxy 분기: payload.secret이 있으면 Teams 발송으로 분류
    if (data.secret !== undefined) {
      return handleTeamsProxy(data);
    }

    // 학습앱 분기
    const action = data.action;
    if (action === "start_session") return handleStartSession(data);
    if (action === "logout") return handleLogout(data);
    const _g = authorizeBySession(data.session_token, action, data.role);
    if (!_g.ok) return makeResponse({ success: false, error: _g.reason });
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
    const _g = authorizeBySession(e.parameter.session_token, action, role);
    if (!_g.ok) return makeResponse({ success: false, error: _g.reason });
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

// ════════════════════════════════════════════════════════════════════════════
// v12 신규 — PLC Agent query API (별도 앱 연결용, 명세서 §4)
// ════════════════════════════════════════════════════════════════════════════

/**
 * query API 메인 핸들러. 별도 앱(PLC Agent)의 질문을 받아 표준 JSON으로 응답.
 * 요청: { path:"query", token, data:{ agent, mode, equipment, lang, input, context } }
 * 응답: { status, answer, structured, sources, metadata }  (§4-2)
 */
function handleQuery(data) {
  const _perfTotal = Date.now(); // v23: 성능 측정 (구 v22 Q21-A 통합)
  try {
    const props = PropertiesService.getScriptProperties();

    // 1) 인증 (§7)
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) {
      return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    }
    if (data.token !== expectedToken) {
      return makeResponse({ status: "error", message: "unauthorized" });
    }
    const apiKey = props.getProperty("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return makeResponse({ status: "error", message: "ANTHROPIC_API_KEY not configured" });
    }

    // 2) 요청 파싱
    const d = data.data || {};
    const agent = String(d.agent || "").toLowerCase();   // cell_plc | elec_plc | fa_plc
    const role = PLC_AGENT_MAP[agent];
    if (!role) {
      return makeResponse({ status: "error", message: "unknown agent: " + agent });
    }
    const mode = d.mode || "analysis";
    const equipment = d.equipment || "CL01";
    const lang = d.lang || "auto";                        // auto | ko | en | id (§6-1)
    const input = d.input || {};
    const previousTurns = (d.context && d.context.previous_turns) || [];

    // 3) 질문 텍스트 구성 (kind: text | alarm | photo) — §5-4
    let question = "";
    if (input.kind === "photo" && input.photo_ocr) {
      const o = input.photo_ocr;
      question = "[현장 사진 OCR 결과]\n"
        + "알람코드: " + (o.alarm_code || "(없음)") + "\n"
        + "알람명: " + (o.alarm_name || "(없음)") + "\n"
        + "화면 원문: " + (o.raw_text || "") + "\n\n"
        + "위 알람을 분석해 주세요.";
    } else {
      question = input.text || "";
    }
    if (!String(question).trim()) {
      return makeResponse({ status: "error", message: "empty input" });
    }

    // 4) KB 조회 + 각 항목에 src id 부여
    const items = getPlcKnowledgeData(role);
    const built = buildKbContextAndSources(items, agent);

    // v17: Signal Graph 자동 조회 (질문에서 신호명 추출 → XML 기반 인덱스 검색)
    const _perfSG_load = Date.now(); // v23 측정
    const signalGraph = loadSignalGraph();
    const _perfSG_search = Date.now();
    const signalMatches = searchSignalGraph(question, signalGraph);
    Logger.log("[Perf] signal_graph: load=" + (_perfSG_search - _perfSG_load) + "ms search="
      + (Date.now() - _perfSG_search) + "ms matches=" + signalMatches.length);
    const signalContext = formatSignalGraphContext(signalMatches);
    if (signalMatches.length > 0) {
      Logger.log("[handleQuery] Signal Graph 매칭: " + signalMatches.length + "개 — "
        + signalMatches.map(function(m){return m.name;}).join(", "));
    }

    // v23: 회로 역추적 자동 호출 (트리거 패턴 매칭 시)
    var traceContext = "";
    const traceTrigger = detectTraceTrigger(question, signalGraph);
    if (traceTrigger) {
      const _perfTrace = Date.now();
      const _perfTraceLoad = Date.now();
      const blockIdxForTrace = loadBlockSignals();
      const _perfTraceLoadMs = Date.now() - _perfTraceLoad;
      const knownSet = buildKnownSignalSet(signalGraph, blockIdxForTrace);
      const sortedKnown = Object.keys(knownSet).sort(function(a, b) { return b.length - a.length; });
      const tree = traceSignal(traceTrigger.target, signalGraph, sortedKnown, traceTrigger.depth, 3);
      traceContext = formatTraceContext(traceTrigger.target, tree, traceTrigger.depth);
      Logger.log("[Perf] traceSignal: " + (Date.now() - _perfTrace) + "ms"
        + " (block_load=" + _perfTraceLoadMs + "ms"
        + " known=" + sortedKnown.length
        + " target=" + traceTrigger.target
        + " depth=" + traceTrigger.depth + ")");
    }

    // v20: 블록/타입 인덱스 조건부 로드 (블록명/타입명이 질문에 있을 때만)
    const typeCands = extractTypeCandidates(question);
    // 블록 후보에서 타입 후보 제외 (예: "IEC_TIMER"가 양쪽에 잡히는 것 방지)
    const blockCandsRaw = extractBlockCandidates(question);
    const blockCands = blockCandsRaw.filter(function(b) { return typeCands.indexOf(b) < 0; });
    var blockContext = "", typeContext = "";
    var blockMatchedAny = false;

    if (blockCands.length > 0) {
      const _perfBlock_load = Date.now();
      const blockIdx = loadBlockSignals();
      const _perfBlock_search = Date.now();
      const blockMatches = searchBlockSignals(blockCands, blockIdx, typeCands);
      Logger.log("[Perf] block_signals: load=" + (_perfBlock_search - _perfBlock_load) + "ms search="
        + (Date.now() - _perfBlock_search) + "ms matches=" + blockMatches.length);
      blockContext = formatBlockContext(blockMatches);
      blockMatchedAny = blockMatches.length > 0;
      if (blockMatches.length > 0) {
        Logger.log("[handleQuery] 블록 인덱스 매칭: " + blockMatches.length + "개 — "
          + blockMatches.map(function(m){return m.key;}).join(", ")
          + (typeCands.length > 0 ? " / 타입 필터: " + typeCands.join(",") : ""));
      }
    }
    // 타입 인덱스 단독 조회: (a) 블록 후보 없음 또는 (b) 블록 매칭 0건 (fallback)
    if (typeCands.length > 0 && (blockCands.length === 0 || !blockMatchedAny)) {
      const _perfType_load = Date.now();
      const typeIdx = loadTypeIndex();
      const _perfType_search = Date.now();
      const typeMatches = searchTypeIndex(typeCands, typeIdx);
      Logger.log("[Perf] type_index: load=" + (_perfType_search - _perfType_load) + "ms search="
        + (Date.now() - _perfType_search) + "ms matches=" + typeMatches.length);
      typeContext = formatTypeContext(typeMatches);
      if (typeMatches.length > 0) {
        Logger.log("[handleQuery] 타입 인덱스 매칭: " + typeMatches.length + "개 — "
          + typeMatches.map(function(m){return m.type + "(" + m.total + ")";}).join(", "));
      }
    }

    // v21: WinCC 인덱스 조건부 로드 (알람 ID / PLC 주소 / 알람·태그 키워드 있을 때만)
    var alarmContext = "", plcTagContext = "";
    const alarmIdCands = extractAlarmIdCandidates(question);
    const plcAddrCands = extractPlcAddressCandidates(question);
    const hasAlarmKeyword = /알람|Alarm|warning|Warning|error|Error|경고|에러/i.test(question);
    const hasTagKeyword = /태그|tag|주소|address/i.test(question);

    // 알람 인덱스 로드 조건: 알람 ID 후보 / trigger_tag 패턴 / 알람 키워드
    if (alarmIdCands.length > 0 || plcAddrCands.length > 0 || hasAlarmKeyword) {
      const _perfAlarm_load = Date.now();
      const alarmIdx = loadAlarmIndex();
      const _perfAlarm_search = Date.now();
      const alarmResult = searchAlarmIndex(question, alarmIdx);
      const _perfAlarm_total = alarmResult.byId.length + alarmResult.byTrigger.length + alarmResult.byText.length;
      Logger.log("[Perf] alarm_index: load=" + (_perfAlarm_search - _perfAlarm_load) + "ms search="
        + (Date.now() - _perfAlarm_search) + "ms matches=" + _perfAlarm_total);
      alarmContext = formatAlarmContext(alarmResult);
      if (_perfAlarm_total > 0) {
        Logger.log("[handleQuery] 알람 인덱스 매칭: byId=" + alarmResult.byId.length
          + " byTrigger=" + alarmResult.byTrigger.length + " byText=" + alarmResult.byText.length);
      }
    }
    // PLC 태그 인덱스 로드 조건: 주소 패턴 / 태그 키워드
    if (plcAddrCands.length > 0 || hasTagKeyword) {
      const _perfPlc_load = Date.now();
      const plcIdx = loadPlcTagIndex();
      const _perfPlc_search = Date.now();
      const plcResult = searchPlcTagIndex(question, plcIdx);
      const _perfPlc_total = plcResult.byName.length + plcResult.byAddress.length;
      Logger.log("[Perf] plc_tag_index: load=" + (_perfPlc_search - _perfPlc_load) + "ms search="
        + (Date.now() - _perfPlc_search) + "ms matches=" + _perfPlc_total);
      plcTagContext = formatPlcTagContext(plcResult);
      if (_perfPlc_total > 0) {
        Logger.log("[handleQuery] PLC 태그 매칭: byName=" + plcResult.byName.length
          + " byAddress=" + plcResult.byAddress.length);
      }
    }

    const combinedSignalContext = signalContext + blockContext + typeContext + alarmContext + plcTagContext + traceContext;

    // 5) 프롬프트 조립
    const prompts = buildQueryPrompts({
      role: role, agent: agent, mode: mode, equipment: equipment,
      lang: lang, question: question, kbContext: built.kbContext,
      hasKb: items.length > 0, previousTurns: previousTurns,
      signalContext: combinedSignalContext, // v17 signal + v20 block + v20 type
    });

    // 6) LLM 호출
    const _perfLLM = Date.now();
    const rawText = callClaudeAPI(apiKey, prompts.system, prompts.userMsg);
    Logger.log("[Perf] callClaudeAPI: " + (Date.now() - _perfLLM) + "ms");

    // 7) JSON 파싱
    const parsed = extractJson(rawText);
    if (!parsed) {
      // 파싱 실패 — 원인 추적용 로그만 남기고, 사용자에겐 raw 노출 없이 깔끔한 에러 반환
      Logger.log("[handleQuery] 파싱 실패 (rawText 길이: " + String(rawText).length + ")");
      Logger.log("[Perf] handleQuery TOTAL (parse_fail): " + (Date.now() - _perfTotal) + "ms");
      return makeResponse({
        status: "error",
        message: "응답 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
        answer: "",
      });
    }

    // 8) 표준 응답 조립 (§4-2)
    const status = parsed.status === "not_found" ? "not_found" : "ok";
    const usedIds = Array.isArray(parsed.used_source_ids) ? parsed.used_source_ids : [];
    const sources = (status === "not_found") ? [] : assembleSources(usedIds, built.srcMap);

    // v29: 채팅 탭 격리 — ladder_html 첨부 로직 제거 (V1 합의: 4번 탭 전용)
    Logger.log("[Perf] handleQuery TOTAL: " + (Date.now() - _perfTotal) + "ms");
    return makeResponse({
      status: status,
      answer: parsed.answer || "",
      structured: parsed.structured || {},
      sources: sources,
      metadata: { agent: agent, mode: mode, code_version: PLC_CODE_VERSION },
    });
  } catch (err) {
    Logger.log("[Perf] handleQuery TOTAL (ERROR): " + (Date.now() - _perfTotal) + "ms");
    return makeResponse({ status: "error", message: err.message });
  }
}

/**
 * PLC KB 데이터를 배열로 반환 (getKnowledge는 makeResponse로 감싸므로 내부용 헬퍼 신설).
 * content가 빈 row는 제외.
 */
function getPlcKnowledgeData(role) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabName = TAB_MAP[role];
  if (!tabName) return [];
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1).map(function (row) {
    return {
      category: row[0], content: row[1], updated_at: row[2],
      source_file: row[3] || "", source_page: row[4] || "",
      source_section: row[5] || "", source_url: row[6] || "",
    };
  }).filter(function (it) {
    return it.content && String(it.content).trim();
  });
}

// ════════════════════════════════════════════════════════════════════════════
// v25 신규 — handleTrace (옵션 A: 별도 endpoint, 인터랙티브 트리 UI 용)
//   별도 앱이 path:"trace"로 호출 — signal/depth/max_locations 명시적 파라미터
//   응답: { status, tree, externals, metadata }
//   옵션 B (path:"query" + detectTraceTrigger 자동 감지)는 그대로 유지
//   둘 다 traceSignal 함수 공유 — 코드 중복 없음
// ════════════════════════════════════════════════════════════════════════════

/**
 * 회로 역추적 API (옵션 A).
 * 요청: { path:"trace", token, data:{ signal, depth, max_locations, lang } }
 * 응답: { status, tree, externals, metadata }
 */
function handleTrace(data) {
  const _perfTotal = Date.now();
  try {
    const props = PropertiesService.getScriptProperties();

    // 1) 인증 (handleQuery와 동일 토큰)
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) {
      return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    }
    if (data.token !== expectedToken) {
      return makeResponse({ status: "error", message: "unauthorized" });
    }

    // 2) 파라미터 파싱 + 기본값 + 한계
    const d = data.data || {};
    const signal = String(d.signal || "").trim();
    if (!signal) {
      return makeResponse({ status: "error", message: "signal parameter required" });
    }
    var depth = parseInt(d.depth, 10);
    if (isNaN(depth) || depth < 1) depth = 3;     // 기본 3
    if (depth > 10) depth = 10;                    // 최대 10 (재귀 폭주 방지)
    var maxLocs = parseInt(d.max_locations, 10);
    if (isNaN(maxLocs) || maxLocs < 1) maxLocs = 3; // 기본 3
    if (maxLocs > 10) maxLocs = 10;                 // 최대 10

    // 3) Signal Graph 로드
    const _perfSG_load = Date.now();
    const signalGraph = loadSignalGraph();
    if (!signalGraph) {
      return makeResponse({ status: "error", message: "signal_graph load failed" });
    }
    Logger.log("[Perf trace] signal_graph load=" + (Date.now() - _perfSG_load) + "ms");

    // 4) 신호 매칭 — 정확/정규화/부분/phrase 4단계 (detectTraceTrigger와 동일 로직, depth 결정 안 함)
    var target = null;
    if (signalGraph[signal]) {
      target = signal;
    } else {
      const candNorm = signal.replace(/[\s"']/g, "").toLowerCase();
      const keys = Object.keys(signalGraph);
      // 정규화 매칭
      for (var ki = 0; ki < keys.length && !target; ki++) {
        const keyNorm = keys[ki].replace(/[\s"']/g, "").toLowerCase();
        if (keyNorm === candNorm) target = keys[ki];
      }
      // 부분 매칭 (5자+)
      if (!target && candNorm.length >= 5) {
        for (var kj = 0; kj < keys.length && !target; kj++) {
          const keyNorm2 = keys[kj].replace(/[\s"']/g, "").toLowerCase();
          if (keyNorm2.indexOf(candNorm) >= 0) target = keys[kj];
        }
      }
      // phrase 매칭 — signal에 공백 있으면 substring 매칭 (v24와 동일)
      if (!target && /\s/.test(signal)) {
        const sigLow = signal.toLowerCase();
        var bestKey = null, bestLen = Infinity;
        for (var gi = 0; gi < keys.length; gi++) {
          if (keys[gi].toLowerCase().indexOf(sigLow) >= 0 && keys[gi].length < bestLen) {
            bestKey = keys[gi]; bestLen = keys[gi].length;
          }
        }
        if (bestKey) target = bestKey;
      }
    }

    // 5) signal 못 찾음 → 추천 신호 list와 함께 not_found
    if (!target) {
      const suggestions = [];
      const sigLow = signal.toLowerCase().replace(/[\s"']/g, "");
      if (sigLow.length >= 3) {
        const keys = Object.keys(signalGraph);
        for (var si = 0; si < keys.length && suggestions.length < 10; si++) {
          const kLow = keys[si].toLowerCase().replace(/[\s"']/g, "");
          if (kLow.indexOf(sigLow.slice(0, Math.min(sigLow.length, 8))) >= 0) {
            suggestions.push(keys[si]);
          }
        }
      }
      Logger.log("[Perf trace] not_found: " + signal + " TOTAL=" + (Date.now() - _perfTotal) + "ms");
      return makeResponse({
        status: "not_found",
        message: "signal not in graph: " + signal,
        suggestions: suggestions,
      });
    }

    // 6) known_signals 사전 구축 (block_signals_index 필요)
    const _perfBlock_load = Date.now();
    const blockIdx = loadBlockSignals();
    Logger.log("[Perf trace] block_signals load=" + (Date.now() - _perfBlock_load) + "ms");
    const knownSet = buildKnownSignalSet(signalGraph, blockIdx);
    const sortedKnown = Object.keys(knownSet).sort(function(a, b) { return b.length - a.length; });

    // 7) traceSignal 실행
    const _perfTrace = Date.now();
    const tree = traceSignal(target, signalGraph, sortedKnown, depth, maxLocs);
    const externalsObj = collectExternals(tree);
    const externals = Object.keys(externalsObj).sort();
    Logger.log("[Perf trace] traceSignal=" + (Date.now() - _perfTrace) + "ms target=" + target
      + " depth=" + depth + " externals=" + externals.length);

    // 8) 응답
    Logger.log("[Perf trace] TOTAL=" + (Date.now() - _perfTotal) + "ms");
    return makeResponse({
      status: "ok",
      tree: tree,
      externals: externals,
      metadata: {
        target: target,
        signal_requested: signal,
        matched_by: target === signal ? "exact" : "fuzzy",
        depth_requested: depth,
        max_locations: maxLocs,
        known_signals_count: sortedKnown.length,
        code_version: PLC_CODE_VERSION,
      },
    });
  } catch (err) {
    Logger.log("[Perf trace] ERROR TOTAL=" + (Date.now() - _perfTotal) + "ms: " + err.message);
    return makeResponse({ status: "error", message: err.message });
  }
}


// XML(TIA Portal Openness) → 그래프 변환된 JSON을 Drive에서 매번 로드 → 신호명으로 검색.
// 4626 신호 인덱스, 각 신호당 set_locations(SET되는 위치)와 used_in_blocks(사용 블록).
// 학습 자료가 아니라 조회 도구라 KB로 안 넣음 — 매번 매칭된 신호만 LLM에 컨텍스트로 주입.

/** Drive에서 Signal Graph JSON을 매번 로드 (캐싱은 추후 최적화). 실패 시 null. */
function loadSignalGraph() {
  try {
    const file = DriveApp.getFileById(SIGNAL_GRAPH_FILE_ID);
    const text = file.getBlob().getDataAsString("utf-8");
    return JSON.parse(text);
  } catch (e) {
    Logger.log("[loadSignalGraph] 로드 실패 — Signal Graph 조회 없이 진행: " + e.message);
    return null;
  }
}

/** 질문에서 신호명 후보 추출 (도트표기, CamelCase 5자+, F알람코드, 따옴표 안). */
function extractSignalCandidates(question) {
  const q = String(question || "");
  const set = {};
  const add = function(s) { if (s && s.length >= 3) set[s] = true; };
  // 도트 표기: 500_ControlNodes.safetyRelease, Etc.FDC.Excute
  (q.match(/[A-Za-z][\w_]*(?:\.[\w_ ]+)+/g) || []).forEach(add);
  // CamelCase / snake_case 단어 (5자+, 첫 글자 대문자)
  (q.match(/\b[A-Z][a-zA-Z_]{4,}\b/g) || []).forEach(add);
  // v18: lowerCamelCase 단어 (소문자로 시작 + 중간 대문자, 예: safetyRelease, executeRequest)
  //   일반 영단어(release, safety)는 중간 대문자 없어 매칭 안 됨 — 노이즈 차단
  (q.match(/\b[a-z]+[A-Z][a-zA-Z_]{2,}\b/g) || []).forEach(add);
  // F알람 코드 (F31137 등)
  (q.match(/\bF\d{4,5}\b/g) || []).forEach(add);
  // 대문자 약어 (FDC, IVS 등 2-5자)
  (q.match(/\b[A-Z]{2,5}\b/g) || []).forEach(add);
  // 따옴표 안 텍스트 (PLC IDE 표시명 패턴: "500_Control Nodes".safety Release)
  (q.match(/"([^"]+)"/g) || []).forEach(function(m) { add(m.replace(/"/g, "")); });
  return Object.keys(set);
}

/** Signal Graph에서 후보들을 매칭 (정확/토큰경계/부분), 상위 N개 반환. */
function searchSignalGraph(question, graph) {
  if (!graph) return [];
  var candidates = extractSignalCandidates(question);
  if (candidates.length === 0) return [];

  var matches = [];
  var seen = {};
  var keys = Object.keys(graph);

  for (var ci = 0; ci < candidates.length && matches.length < 5; ci++) {
    var cand = candidates[ci];
    var candNorm = cand.replace(/[\s"']/g, "").toLowerCase();
    if (candNorm.length < 3) continue;

    for (var ki = 0; ki < keys.length && matches.length < 5; ki++) {
      var key = keys[ki];
      if (seen[key]) continue;
      var keyNorm = key.replace(/[\s"']/g, "").toLowerCase();

      var matched = false;
      // 1) 정확 매칭
      if (keyNorm === candNorm) matched = true;
      // 2) 토큰 경계 매칭 (도트/언더바로 나눈 토큰 중 하나와 정확 일치)
      else if (keyNorm.split(/[._]/).indexOf(candNorm) >= 0) matched = true;
      // 3) 부분 매칭 (긴 후보 5자+만 — 짧으면 노이즈 위험)
      else if (candNorm.length >= 5 && keyNorm.indexOf(candNorm) >= 0) matched = true;

      if (matched) {
        matches.push({ name: key, data: graph[key], matchedBy: cand });
        seen[key] = true;
      }
    }
  }
  return matches;
}

/** Signal Graph 매칭 결과를 LLM 컨텍스트용 텍스트로 포맷. */
function formatSignalGraphContext(matches) {
  if (!matches || matches.length === 0) return "";
  var lines = ["", "## [신호 그래프 조회 결과] (Signal Graph 자동 검색 — TIA Portal XML 기반)",
    "질문에서 신호명 후보를 자동 추출해 Signal Graph(4626 신호 인덱스)에서 검색한 결과입니다.",
    "이 정보는 (1) KB 기반과 동일한 신뢰도(XML 원본 기반)입니다. 답변 시 출처로 정확히 인용하고,",
    "answer 끝에 'ⓘ 출처: Signal Graph 자동 조회 (XML 기반)' 라벨을 붙이세요.",
    ""];
  for (var i = 0; i < matches.length; i++) {
    var sig = matches[i];
    lines.push("### 신호: " + sig.name + "  (검색어: " + sig.matchedBy + ")");
    var sets = (sig.data && sig.data.set_locations) || [];
    if (sets.length > 0) {
      lines.push("  SET되는 위치 (" + sets.length + "개):");
      var showN = Math.min(sets.length, 10);
      for (var si = 0; si < showN; si++) {
        var loc = sets[si];
        lines.push("    [" + (si+1) + "] 블록: " + (loc.block || "?")
          + " / 네트워크 " + (loc.network_id || "?")
          + (loc.network_title ? ": " + loc.network_title : ""));
        lines.push("        모드: " + (loc.mode || "?") + ", operator: " + (loc.operator || "?"));
        if (loc.condition_str) lines.push("        조건: " + loc.condition_str);
      }
      if (sets.length > showN) lines.push("    ... 외 " + (sets.length - showN) + "개");
    }
    var uses = (sig.data && sig.data.used_in_blocks) || [];
    if (uses.length > 0) {
      var usesShow = uses.slice(0, 10).join(", ");
      lines.push("  사용되는 블록 (" + uses.length + "개): " + usesShow
        + (uses.length > 10 ? " 외 " + (uses.length - 10) + "개" : ""));
    }
    lines.push("");
  }
  return lines.join("\n");
}
// ──────────────────────────────────────────────────────────────────

// ─── v20: 블록 인덱스 + 타입 인덱스 조회 도구 (signal_graph_v2 — C-4 해결) ───────
// block_signals_index.json: 블록(671개)별 signals_by_section / signals_by_type / all_signals
// global_type_index.json:   타입(1242개)별 위치 리스트
// 조건부 로드 — 질문에 블록명/타입명이 있을 때만 추가 로드 (평소 부담 0)

/** Drive에서 block_signals_index 매번 로드. 실패 시 null. */
function loadBlockSignals() {
  try {
    const file = DriveApp.getFileById(BLOCK_SIGNALS_FILE_ID);
    const text = file.getBlob().getDataAsString("utf-8");
    return JSON.parse(text);
  } catch (e) {
    Logger.log("[loadBlockSignals] 로드 실패: " + e.message);
    return null;
  }
}

/** Drive에서 global_type_index 매번 로드. 실패 시 null. */
function loadTypeIndex() {
  try {
    const file = DriveApp.getFileById(TYPE_INDEX_FILE_ID);
    const text = file.getBlob().getDataAsString("utf-8");
    return JSON.parse(text);
  } catch (e) {
    Logger.log("[loadTypeIndex] 로드 실패: " + e.message);
    return null;
  }
}

/** 질문에서 블록 참조 후보 추출 (FB200, OB80, GlobalDB384, DAT_Door 등). */
function extractBlockCandidates(question) {
  const q = String(question || "");
  const set = {};
  // 블록 번호 패턴: FB200, FC123, DB10, OB80, GlobalDB384 등
  (q.match(/\b(?:FB|FC|DB|OB|GlobalDB|FunctionBlock|Function|DataBlock|OrganizationBlock)\d+\b/gi) || [])
    .forEach(function(s) { set[s] = true; });
  // 블록 이름 후보 — CamelCase 또는 snake_case 식별자 (긴 것만, 노이즈 차단)
  // 예: DAT_Door, LLGES_CylPressureControl
  (q.match(/\b[A-Z][a-zA-Z0-9_]{4,}\b/g) || []).forEach(function(s) { set[s] = true; });
  return Object.keys(set);
}

/** 질문에서 PLC 타입명 후보 추출 (IEC_TIMER, TON_TIME, PID_Compact 등). */
function extractTypeCandidates(question) {
  const q = String(question || "");
  const set = {};
  // 화이트리스트 — 자주 쓰는 PLC 타입명 (정확히 등장하는 것만)
  const WHITELIST = [
    "IEC_TIMER", "IEC_COUNTER", "TON_TIME", "TOF_TIME", "TP_TIME",
    "PID_Compact", "PID_CompactConfig", "PID_CompactRetain",
    "DTL", "Time", "Date",
  ];
  WHITELIST.forEach(function(t) {
    const re = new RegExp("\\b" + t + "\\b");
    if (re.test(q)) set[t] = true;
  });
  // 패턴 매칭: *_TIMER, *_COUNTER, *_FB, *_UDT 형식 (대문자 + 언더바)
  (q.match(/\b[A-Z][A-Z_]+_(?:TIMER|COUNTER|FB|UDT|STRUCT|TIME)\b/g) || [])
    .forEach(function(s) { set[s] = true; });
  // "타이머" 한글도 IEC_TIMER 후보로
  if (/타이머/.test(q) && !set["IEC_TIMER"]) set["IEC_TIMER"] = true;
  return Object.keys(set);
}

/** 블록 인덱스에서 매칭 검색. typeFilter 있으면 그 타입 신호만 노출. 최대 3블록. */
function searchBlockSignals(blockCands, blockIdx, typeFilter) {
  if (!blockIdx || blockCands.length === 0) return [];
  const matches = [];
  const seen = {};
  const keys = Object.keys(blockIdx);

  for (var ci = 0; ci < blockCands.length && matches.length < 3; ci++) {
    const cand = blockCands[ci];
    const candNorm = cand.replace(/[\s"']/g, "").toLowerCase();
    if (candNorm.length < 3) continue;

    for (var ki = 0; ki < keys.length && matches.length < 3; ki++) {
      const key = keys[ki];
      if (seen[key]) continue;
      const keyNorm = key.replace(/[\s"']/g, "").toLowerCase();

      var matched = false;
      // 정확 매칭 (전체 키 또는 블록 이름·번호 부분)
      if (keyNorm === candNorm) matched = true;
      // 키 안 토큰 매칭 — 키 형식 "DAT_Door (FB200)" → 토큰 ["dat_door", "fb200"]
      else if (keyNorm.split(/[\s()._]+/).filter(Boolean).indexOf(candNorm) >= 0) matched = true;
      // 부분 매칭 (5자+만)
      else if (candNorm.length >= 5 && keyNorm.indexOf(candNorm) >= 0) matched = true;

      if (matched) {
        matches.push({ key: key, data: blockIdx[key], matchedBy: cand, typeFilter: typeFilter });
        seen[key] = true;
      }
    }
  }
  return matches;
}

/** 타입 인덱스에서 매칭 검색. 매칭당 상위 20개 위치 + 전체 개수 반환. */
function searchTypeIndex(typeCands, typeIdx) {
  if (!typeIdx || typeCands.length === 0) return [];
  const matches = [];
  for (var ci = 0; ci < typeCands.length && matches.length < 3; ci++) {
    const cand = typeCands[ci];
    if (typeIdx[cand]) {
      const locs = typeIdx[cand];
      matches.push({
        type: cand,
        total: locs.length,
        locations: locs.slice(0, 20),
      });
    }
  }
  return matches;
}

/** 블록 검색 결과 → LLM 컨텍스트 텍스트. typeFilter 있으면 그 타입만 노출. */
function formatBlockContext(matches) {
  if (!matches || matches.length === 0) return "";
  const lines = ["", "## [블록 인덱스 조회 결과] (block_signals_index — 671블록 인덱스)",
    "질문에서 블록 참조(FB/FC/DB/OB 번호 또는 블록명)를 추출해 검색한 결과입니다.",
    "각 블록의 변수·타입 정보가 Section별/Type별로 분류돼 있습니다.",
    "답변 시 'ⓘ 출처: Signal Graph 자동 조회 (XML 기반 - 블록 인덱스)' 라벨을 붙이세요.",
    ""];

  for (var i = 0; i < matches.length; i++) {
    const m = matches[i];
    const d = m.data;
    lines.push("### 블록: " + m.key + "  (검색어: " + m.matchedBy + ")");
    lines.push("  경로: " + (d.block_path || "?") + " / 언어: " + (d.language || "?")
      + " / 신호 수: " + (d.signal_count || "?"));
    const filters = m.typeFilter || [];

    if (filters.length > 0) {
      // 타입 필터 — 해당 타입 신호만 노출
      const byType = d.signals_by_type || {};
      for (var fi = 0; fi < filters.length; fi++) {
        const t = filters[fi];
        const sigs = byType[t] || [];
        lines.push("  [타입 " + t + "] " + sigs.length + "개:");
        for (var si = 0; si < sigs.length; si++) {
          lines.push("    - " + sigs[si].name + " (Section: " + sigs[si].section + ")");
        }
      }
    } else {
      // 필터 없음 — Section별 + 타입 분포 요약 (신호 너무 많으면 상위 30개)
      const bySection = d.signals_by_section || {};
      const sections = Object.keys(bySection);
      var shown = 0;
      const MAX_SHOW = 30;
      for (var si = 0; si < sections.length && shown < MAX_SHOW; si++) {
        const sec = sections[si];
        const sigs = bySection[sec];
        lines.push("  [" + sec + "] " + sigs.length + "개:");
        const showN = Math.min(sigs.length, MAX_SHOW - shown);
        for (var sj = 0; sj < showN; sj++) {
          lines.push("    - " + sigs[sj].name + ": " + sigs[sj].type);
        }
        shown += showN;
        if (sigs.length > showN) {
          lines.push("    ... 외 " + (sigs.length - showN) + "개 (제한)");
          break;
        }
      }
      if (d.signal_count > MAX_SHOW) {
        lines.push("  (전체 " + d.signal_count + "개 중 상위 " + MAX_SHOW + "개만 노출 — 특정 타입 지정 시 정밀 조회 가능)");
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** 타입 검색 결과 → LLM 컨텍스트 텍스트. 상위 20개 위치 + 전체 개수. */
function formatTypeContext(matches) {
  if (!matches || matches.length === 0) return "";
  const lines = ["", "## [타입 인덱스 조회 결과] (global_type_index — 1242 타입)",
    "질문에서 PLC 타입명을 추출해 전 공장에서 해당 타입 변수 위치를 검색한 결과입니다.",
    "답변 시 'ⓘ 출처: Signal Graph 자동 조회 (XML 기반 - 타입 인덱스)' 라벨을 붙이세요.",
    ""];
  for (var i = 0; i < matches.length; i++) {
    const m = matches[i];
    lines.push("### 타입: " + m.type + "  (전 공장 총 " + m.total + "개)");
    const showN = Math.min(m.locations.length, 20);
    for (var li = 0; li < showN; li++) {
      const loc = m.locations[li];
      lines.push("  - " + loc.block + " / " + loc.signal
        + " (Section: " + loc.section + ")");
    }
    if (m.total > showN) {
      lines.push("  ... 외 " + (m.total - showN) + "개 (상위 " + showN + "개만 표시)");
    }
    lines.push("");
  }
  return lines.join("\n");
}
// ──────────────────────────────────────────────────────────────────

// ─── v21: WinCC 인덱스 조회 도구 — HMI Alarm + PLC Tag ────────────
// HMI Alarm 9048개 (ID/text/class/trigger_tag/bit + by_trigger_tag 역인덱스 162태그)
// PLC Tag 2020개 + 942 상수 (name/path/data_type/address/comment + by_address 역인덱스 2020개)
// 조건부 로드 — 알람/태그 관련 키워드 있을 때만

/** Drive에서 HMI Alarm 인덱스 매번 로드. 실패 시 null. */
function loadAlarmIndex() {
  try {
    const file = DriveApp.getFileById(HMI_ALARM_INDEX_FILE_ID);
    const text = file.getBlob().getDataAsString("utf-8");
    return JSON.parse(text);
  } catch (e) {
    Logger.log("[loadAlarmIndex] 로드 실패: " + e.message);
    return null;
  }
}

/** Drive에서 PLC Tag 인덱스 매번 로드. 실패 시 null. */
function loadPlcTagIndex() {
  try {
    const file = DriveApp.getFileById(PLC_TAG_INDEX_FILE_ID);
    const text = file.getBlob().getDataAsString("utf-8");
    return JSON.parse(text);
  } catch (e) {
    Logger.log("[loadPlcTagIndex] 로드 실패: " + e.message);
    return null;
  }
}

/** 질문에서 알람 ID 후보 추출 (1000~99999 범위 숫자 — 너무 작은 건 노이즈). */
function extractAlarmIdCandidates(question) {
  const q = String(question || "");
  const set = {};
  // 4~5자리 숫자 (알람 ID 범위)
  (q.match(/\b\d{4,5}\b/g) || []).forEach(function(n) {
    const num = parseInt(n, 10);
    if (num >= 1000 && num <= 99999) set[n] = true;
  });
  return Object.keys(set);
}

/** 질문에서 PLC 주소·trigger_tag 후보 추출 (%I0.1, 500_Alarm_AlarmLWord[95] 등). */
function extractPlcAddressCandidates(question) {
  const q = String(question || "");
  const set = {};
  // PLC 주소: %I0.1, %Q10.0, %M500.0, %DB10.DBX0.0 등
  (q.match(/%[IQMDB][BWDLX]?\d+(?:\.\d+)*/gi) || []).forEach(function(s) { set[s] = true; });
  // 인덱싱된 trigger_tag: 500_Alarm_AlarmLWord[95], Etc.FDC.Excute 등 (숫자/문자 모두 시작 가능)
  (q.match(/\b\w[\w_]*(?:\.[\w_ ]+)*\[\d+\]/g) || []).forEach(function(s) { set[s] = true; });
  return Object.keys(set);
}

/** 알람 인덱스 검색 — ID 매칭 + trigger_tag 역추적 + 텍스트 키워드 검색. */
function searchAlarmIndex(question, alarmIdx) {
  if (!alarmIdx) return { byId: [], byTrigger: [], byText: [] };
  const idCands = extractAlarmIdCandidates(question);
  const triggerCands = extractPlcAddressCandidates(question);
  // 텍스트 키워드 — CamelCase 단어들 (Cylinder, Magazine 등)
  const textCands = (question.match(/\b[A-Z][a-zA-Z]{4,}\b/g) || [])
    .filter(function(w) {
      const lw = w.toLowerCase();
      return lw !== "alarm" && lw !== "warning" && lw !== "error";
    });

  const result = { byId: [], byTrigger: [], byText: [] };
  const byId = alarmIdx.by_id || {};
  const byTrigger = alarmIdx.by_trigger_tag || {};

  // 1) ID 매칭 (정확)
  for (var i = 0; i < idCands.length && result.byId.length < 5; i++) {
    if (byId[idCands[i]]) {
      result.byId.push({ id: idCands[i], data: byId[idCands[i]] });
    }
  }

  // 2) Trigger tag 역추적
  for (var i = 0; i < triggerCands.length && result.byTrigger.length < 3; i++) {
    const cand = triggerCands[i];
    if (byTrigger[cand]) {
      const ids = byTrigger[cand];
      // 상위 10개 알람의 상세 + 전체 개수
      const sample = ids.slice(0, 10).map(function(aid) {
        return { id: aid, data: byId[aid] || {} };
      });
      result.byTrigger.push({ trigger: cand, total: ids.length, samples: sample });
    }
  }

  // 3) 텍스트 키워드 검색 (각 후보당 매칭 알람 카운트만 + 상위 5개)
  // 부담 큰 작업이라 키워드 1개당 최대 3개 매칭, 후보 2개까지만
  if (textCands.length > 0 && result.byId.length === 0 && result.byTrigger.length === 0) {
    const keys = Object.keys(byId);
    for (var ti = 0; ti < Math.min(textCands.length, 2); ti++) {
      const kw = textCands[ti].toLowerCase();
      var matched = 0;
      const samples = [];
      for (var ki = 0; ki < keys.length; ki++) {
        const a = byId[keys[ki]];
        if (a.text && a.text.toLowerCase().indexOf(kw) >= 0) {
          matched++;
          if (samples.length < 5) samples.push({ id: keys[ki], data: a });
        }
      }
      if (matched > 0) result.byText.push({ keyword: textCands[ti], total: matched, samples: samples });
    }
  }
  return result;
}

/** PLC 태그 인덱스 검색 — 이름/주소 매칭. */
function searchPlcTagIndex(question, plcIdx) {
  if (!plcIdx) return { byName: [], byAddress: [] };
  const byName = plcIdx.by_name || {};
  const byAddress = plcIdx.by_address || {};

  const addrCands = extractPlcAddressCandidates(question)
    .filter(function(s) { return /^%/.test(s); }); // %주소만
  // 태그 이름 후보 — CamelCase 또는 snake_case (5자+)
  const nameCandsRaw = (question.match(/\b[a-zA-Z][\w_]{4,}\b/g) || []);
  const nameCands = [];
  const seenName = {};
  for (var i = 0; i < nameCandsRaw.length; i++) {
    const n = nameCandsRaw[i];
    if (!seenName[n]) { seenName[n] = true; nameCands.push(n); }
  }

  const result = { byName: [], byAddress: [] };

  // 1) 주소 매칭
  for (var i = 0; i < addrCands.length && result.byAddress.length < 3; i++) {
    const a = addrCands[i];
    if (byAddress[a]) {
      const names = byAddress[a];
      const detail = names.slice(0, 5).map(function(n) {
        return { name: n, data: byName[n] || {} };
      });
      result.byAddress.push({ address: a, names: names, samples: detail });
    }
  }

  // 2) 이름 매칭 (정확 우선, 부분 매칭은 보조)
  for (var i = 0; i < nameCands.length && result.byName.length < 5; i++) {
    const cand = nameCands[i];
    // 정확 매칭
    if (byName[cand]) {
      result.byName.push({ name: cand, data: byName[cand], matchType: "exact" });
      continue;
    }
    // 부분 매칭 — 후보 길이 7자+만 (노이즈 차단)
    if (cand.length >= 7) {
      const candLow = cand.toLowerCase();
      const keys = Object.keys(byName);
      for (var ki = 0; ki < keys.length; ki++) {
        if (keys[ki].toLowerCase().indexOf(candLow) >= 0) {
          result.byName.push({ name: keys[ki], data: byName[keys[ki]], matchType: "partial", matchedBy: cand });
          break;
        }
      }
    }
  }
  return result;
}

/** 알람 검색 결과 → LLM 컨텍스트 텍스트. */
function formatAlarmContext(alarmResult) {
  if (!alarmResult) return "";
  if (alarmResult.byId.length === 0 && alarmResult.byTrigger.length === 0 && alarmResult.byText.length === 0) return "";
  const lines = ["", "## [HMI 알람 조회 결과] (hmi_alarm_index — 9048 알람)",
    "WinCC HMI 알람 인덱스에서 검색한 결과입니다.",
    "답변 시 'ⓘ 출처: WinCC 자동 조회 (HMI 알람 인덱스)' 라벨을 붙이세요.",
    ""];

  // ID 매칭
  for (var i = 0; i < alarmResult.byId.length; i++) {
    const m = alarmResult.byId[i];
    lines.push("### 알람 ID " + m.id);
    lines.push("  텍스트: " + (m.data.text || "?"));
    lines.push("  클래스: " + (m.data.class || "?"));
    lines.push("  트리거 태그: " + (m.data.trigger_tag || "?") + " (bit " + (m.data.trigger_bit || "?") + ")");
    if (m.data.priority) lines.push("  우선순위: " + m.data.priority);
    if (m.data.info_text) lines.push("  Info: " + m.data.info_text);
    lines.push("");
  }
  // Trigger tag 역추적
  for (var i = 0; i < alarmResult.byTrigger.length; i++) {
    const m = alarmResult.byTrigger[i];
    lines.push("### Trigger tag: " + m.trigger + " → 알람 " + m.total + "개 트리거");
    const showN = Math.min(m.samples.length, 10);
    for (var si = 0; si < showN; si++) {
      const s = m.samples[si];
      lines.push("  - ID " + s.id + ": " + (s.data.text || "?")
        + " (bit " + (s.data.trigger_bit || "?") + ", " + (s.data.class || "?") + ")");
    }
    if (m.total > showN) lines.push("  ... 외 " + (m.total - showN) + "개");
    lines.push("");
  }
  // 텍스트 키워드 검색
  for (var i = 0; i < alarmResult.byText.length; i++) {
    const m = alarmResult.byText[i];
    lines.push("### 키워드 '" + m.keyword + "' 매칭: " + m.total + "개 알람");
    for (var si = 0; si < m.samples.length; si++) {
      const s = m.samples[si];
      lines.push("  - ID " + s.id + ": " + (s.data.text || "?") + " (" + (s.data.class || "?") + ")");
    }
    if (m.total > m.samples.length) lines.push("  ... 외 " + (m.total - m.samples.length) + "개");
    lines.push("");
  }
  return lines.join("\n");
}

/** PLC 태그 검색 결과 → LLM 컨텍스트 텍스트. */
function formatPlcTagContext(plcResult) {
  if (!plcResult) return "";
  if (plcResult.byName.length === 0 && plcResult.byAddress.length === 0) return "";
  const lines = ["", "## [PLC 태그 조회 결과] (plc_tag_index — 2020 태그 + 942 상수)",
    "WinCC PLC Tag 사전에서 검색한 결과입니다.",
    "답변 시 'ⓘ 출처: WinCC 자동 조회 (PLC 태그 인덱스)' 라벨을 붙이세요.",
    ""];

  for (var i = 0; i < plcResult.byName.length; i++) {
    const m = plcResult.byName[i];
    lines.push("### 태그: " + m.name + (m.matchType === "partial" ? "  (검색어: " + m.matchedBy + ")" : ""));
    if (m.data.kind) lines.push("  종류: " + m.data.kind);
    if (m.data.path) lines.push("  경로: " + m.data.path);
    if (m.data.data_type) lines.push("  타입: " + m.data.data_type);
    if (m.data.address) lines.push("  주소: " + m.data.address);
    if (m.data.value) lines.push("  값: " + m.data.value);
    if (m.data.comment) lines.push("  코멘트: " + m.data.comment);
    lines.push("");
  }
  for (var i = 0; i < plcResult.byAddress.length; i++) {
    const m = plcResult.byAddress[i];
    lines.push("### 주소: " + m.address + " → 태그 " + m.names.length + "개");
    for (var si = 0; si < m.samples.length; si++) {
      const s = m.samples[si];
      lines.push("  - " + s.name + ": " + (s.data.comment || "(코멘트 없음)")
        + " [" + (s.data.data_type || "?") + "]");
    }
    lines.push("");
  }
  return lines.join("\n");
}
// ──────────────────────────────────────────────────────────────────

/**
 * KB 항목마다 src_NNN id를 부여하여 (1) LLM에 줄 컨텍스트 텍스트와
 * (2) id→출처메타 맵(srcMap)을 함께 만든다.
 * sources[]는 LLM이 아니라 코드가 srcMap에서 조립 → URL 환각 방지.
 */
function buildKbContextAndSources(items, agent) {
  const srcMap = {};
  const blocks = [];
  items.forEach(function (it, idx) {
    const id = "src_" + String(idx + 1).padStart(3, "0");
    const fileName = it.source_file || "(출처 미상)";
    const section = it.source_section || "";
    const title = section ? (fileName + " / " + section) : fileName;
    srcMap[id] = {
      id: id,
      type: inferSourceType(fileName),
      agent: agent,
      title: title,
      link: it.source_url || "",
    };
    const pageInfo = it.source_page ? (" (페이지 " + it.source_page + ")") : "";
    blocks.push("[" + id + "] 출처: " + title + pageInfo + "\n" + it.content);
  });
  return { kbContext: blocks.join("\n\n---\n\n"), srcMap: srcMap };
}

/**
 * 파일명으로 출처 타입 추론 (§5-5: scl|manual|pdf|ppt|spec).
 * 정확도가 완벽하지 않아도 별도 앱 배지색 용도라 무방. 기본값 manual.
 */
function inferSourceType(filename) {
  const f = String(filename || "").toLowerCase();
  if (/\.scl$|\.awl$|\bscl\b|fb_|fc_|\bob_|\bdb_/.test(f)) return "scl";
  if (/\.pdf$/.test(f)) return "pdf";
  if (/\.pptx?$/.test(f)) return "ppt";
  if (/spec|사양|규격|specification/.test(f)) return "spec";
  if (/manual|매뉴얼|정비|guide/.test(f)) return "manual";
  return "manual";
}

/**
 * system / user 프롬프트 조립. PLC 규칙·다국어·출처마커·출력스키마를 system에 명시.
 */
function buildQueryPrompts(opts) {
  let langInstruction;
  if (opts.lang === "ko") langInstruction = "반드시 한국어로 answer를 작성하세요.";
  else if (opts.lang === "en") langInstruction = "Write the answer strictly in English.";
  else if (opts.lang === "id") langInstruction = "Tulis seluruh answer dalam Bahasa Indonesia.";
  else langInstruction = "answer는 사용자 질문과 동일한 언어로 작성하세요 (한국어→한국어, Bahasa→Bahasa, English→English). 입력 언어를 자동 감지하세요.";

  // v13: 지식 사용 정책 — PLC_KNOWLEDGE_MODE에 따라 분기 (별도 앱 논의 1·2번)
  let knowledgePolicy;
  let sourceMarkerExtra = null;
  if (PLC_KNOWLEDGE_MODE === "strict") {
    knowledgePolicy = [
      "## 지식 사용 정책 (strict 모드 — 폐쇄형)",
      "- 아래 [학습 자료]에 있는 내용만 사용하세요. 학습 자료에 없는 내용은 절대 언급하지 마세요.",
      "- 일반 지식·외부 상식·추정으로 보충하지 마세요.",
      "- 학습 자료에서 답을 찾을 수 없으면 status를 \"not_found\"로 하세요.",
    ];
  } else {
    // v16: hybrid 4단계 출처 라벨링 — 표준 매뉴얼 지식까지 적극 답변 + 사용자가 출처 신뢰도 판단 가능
    knowledgePolicy = [
      "## 지식 사용 정책 (hybrid 모드 — 4단계 출처 라벨링)",
      "",
      "판단 기준은 '출처 유무'가 아니라 '확실성'입니다. 확실히 아는 것은 답하되, 답변의 출처를 아래 4단계로 명시하세요.",
      "",
      "### 4단계 출처 카테고리",
      "(1) KB 기반 — 우리 공장 학습 자료([학습 자료] 섹션)",
      "(1.5) Signal Graph & WinCC 자동 조회 — XML/WinCC 기반 인덱스 (v17/v20/v21/v23)",
      "    → 다음 섹션 중 user message에 실제로 존재할 때만 사용 (없으면 인용하지 마세요).",
      "    · [신호 그래프 조회 결과] — Coil/Contact 신호의 SET 위치 (global_signal_graph, 4626 신호)",
      "    · [블록 인덱스 조회 결과] — 블록 내 모든 변수·타입 인덱스 (block_signals_index, 671 블록)",
      "    · [타입 인덱스 조회 결과] — 타입별 전 공장 위치 (global_type_index, 1242 타입)",
      "    · [HMI 알람 조회 결과] — WinCC 알람 ID/text/trigger_tag (hmi_alarm_index, 9048 알람)",
      "    · [PLC 태그 조회 결과] — PLC 태그 사전 name/address/comment (plc_tag_index, 2962 태그·상수)",
      "    · [회로 역추적 결과] — 신호 의존 체인 재귀 추적 트리 + 외부 입력 leaf (v23 신규)",
      "    → KB 기반과 동일 신뢰도. TIA Portal XML / WinCC TIA export에서 자동 추출.",
      "    → 답변 시 알람 ID·텍스트·트리거 태그·PLC 주소·코멘트 등을 정확히 인용하세요.",
      "    → 회로 역추적 섹션이 있으면 그 안의 '처리 룰'을 반드시 따르세요 (요약·외부 입력 정리·NOT 자연어 해석·KB 결합).",
      "    → answer 끝에 어느 인덱스를 썼는지 라벨을 붙이세요:",
      "      · 신호: 'ⓘ 출처: Signal Graph 자동 조회 (XML 기반 - 신호 인덱스)'",
      "      · 블록: 'ⓘ 출처: Signal Graph 자동 조회 (XML 기반 - 블록 인덱스)'",
      "      · 타입: 'ⓘ 출처: Signal Graph 자동 조회 (XML 기반 - 타입 인덱스)'",
      "      · 알람: 'ⓘ 출처: WinCC 자동 조회 (HMI 알람 인덱스)'",
      "      · PLC 태그: 'ⓘ 출처: WinCC 자동 조회 (PLC 태그 인덱스)'",
      "      · 회로 역추적: 'ⓘ 출처: 회로 역추적 (Signal Graph 자동 추적)'",
      "      · 둘 이상 사용 시 조합: 'ⓘ 출처: Signal Graph + WinCC 자동 조회 (신호 + 알람 인덱스)' 등",
      "    → 해당 섹션이 없으면 (1.5)는 사용 불가. (1)(2)(3)(4) 중에서 답하세요.",
      "(2) 표준 매뉴얼 기반 — 지멘스/제조사 공식 매뉴얼의 표준 정보",
      "    예: 표준 Sinamics 결함 코드(F31137, F07410 등), Siemens S7 표준 OB(OB80, OB121 등), 표준 통신 프로토콜(PROFINET, OPC UA 등)",
      "(3) 일반 PLC/산업 표준 — 제조사 무관한 일반 산업 개념",
      "    예: TON 타이머 동작 원리, edge trigger, retentive 변수, RS/SR 플립플롭 등",
      "(4) 정보 없음 — 어디에도 해당 안 됨 → status=\"not_found\"",
      "",
      "### 답변 우선순위",
      "KB 검색 → 있으면 (1) → 없지만 표준 매뉴얼 정보면 (2) → 일반 산업 표준이면 (3) → 공장 특화인데 KB 없으면 (4).",
      "",
      "### 표준 vs 공장 특화 구분 — 매우 중요",
      "**답해야 함 (KB 없어도 (2)(3)으로 답):**",
      "- 표준 Sinamics/지멘스 결함 코드 (F로 시작하는 표준 코드)",
      "- 표준 PLC 개념 (TON, edge trigger, OB80, retentive, RS/SR 등)",
      "- 표준 통신 프로토콜 (PROFINET, OPC UA, PROFIsafe 등)",
      "- 일반 트러블슈팅 패턴",
      "**답하면 안 됨 (KB 없으면 반드시 (4) not_found):**",
      "- 우리 공장 자체 신호명 (예: \"500_Control Nodes\".safety Release)",
      "- 호기별 파라미터 설정값",
      "- 자체 정의 알람 코드 (우리 공장만의 E0xxx 등)",
      "- 우리 공장 사례·이력·회로 구조",
      "공장 특화 정보를 표준 매뉴얼 지식으로 추측해 답하면 사용자를 오도합니다. 이 경우 반드시 (4) not_found로 응답하세요.",
      "",
      "### 출처 라벨 표기 (필수)",
      "(1) KB 기반: 본문 문장 끝에 [src_xxx] 마커를 붙이고 used_source_ids에 담으세요 (기존과 동일).",
      "(2) 표준 매뉴얼 기반: answer 마지막에 빈 줄 한 줄 + 아래 형식의 라벨을 그대로 붙이세요:",
      "    ⓘ 출처: [제조사명] [규격/제품명] 표준 매뉴얼 기반",
      "       (KB에 학습된 우리 공장 자료 아님 / 정확한 페이지·문서 인용 어려움)",
      "(3) 일반 산업 표준: answer 마지막에 빈 줄 한 줄 + 아래 라벨을 붙이세요:",
      "    ⓘ 출처: PLC 일반 표준 지식",
      "(4) not_found: answer는 '해당 정보를 확인할 수 없어 추측으로 답변하지 않습니다' 취지. structured={}, used_source_ids=[].",
      "",
      "(2)(3)일 때는 used_source_ids를 비우세요(가짜 src를 만들지 마세요).",
      "근거 없는 추정은 금지입니다. 불확실하면 그 부분을 '확실하지 않음 / 현장 확인 필요'로 명시하세요.",
      "",
      "### 답변 예시",
      "[예시 — 표준 결함 코드 (2)]",
      "질문: F31137이 뭐야?",
      "answer 필드 값:",
      "\"F31137은 Sinamics 드라이브의 모터 인코더 위치 결정 시 내부 결함을 나타내는 표준 결함 코드입니다. 주요 원인: 인코더 케이블 불량, 인코더 자체 결함, 인코더 전원 문제, DRIVE-CLiQ 통신 문제 등.\\n\\nⓘ 출처: 지멘스 Sinamics 표준 매뉴얼 기반\\n   (KB에 학습된 우리 공장 자료 아님 / 정확한 페이지·문서 인용 어려움)\"",
      "",
      "[예시 — 일반 PLC 개념 (3)]",
      "질문: TON 타이머 동작 원리?",
      "answer 필드 값:",
      "\"TON(On-Delay) 타이머는 입력 IN이 OFF→ON으로 바뀌는 edge에서 타이머를 시작하고, 설정 시간(PT) 경과 후 출력 Q가 ON됩니다. 입력이 OFF로 바뀌면 즉시 리셋됩니다.\\n\\nⓘ 출처: PLC 일반 표준 지식\"",
    ];
    sourceMarkerExtra = null; // v16: 새 정책이 (2)(3) 라벨로 명확하므로 별도 안내 불필요
  }

  let system = [
    "당신은 " + opts.role + " PLC 분석 전문가입니다. 대상 호기: " + opts.equipment + ".",
    "정비 직원의 질문을 받아 정밀하게 분석합니다.",
    "",
  ];
  system = system.concat(knowledgePolicy);
  system = system.concat([
    "- not_found일 때는 answer에 '해당 정보를 확인할 수 없어 추측으로 답변하지 않습니다'라는 취지를 사용자 언어로 적고, structured는 {}, used_source_ids는 [] 로 두세요.",
    "",
    "## 분석 스타일 (analysis 모드)",
    "- 회로/인터락 구조를 구체적으로, 점검 순서를 명확한 단계로 제시하세요.",
    "- 디바이스/메모리 코드(M120, I0.7, Q5.2 등), 알람 코드·알람명(E0234, Stacker Vacuum Interlock 등), 출처 제목(title)은 절대 번역하지 말고 원문 그대로 유지하세요. 설명 문장만 사용자 언어로 작성합니다.",
    "",
    "## 출처 인용 규칙",
    "- [학습 자료]의 각 항목에는 [src_001] 같은 id가 붙어 있습니다.",
    "- [학습 자료]를 근거로 한 문장 끝에 해당 id를 [src_001] 형식으로 표기하세요.",
    "- recommended_checks 중 학습 자료가 근거인 항목에는 source_id를 넣으세요.",
    "- 실제로 인용한 학습 자료 id만 used_source_ids에 담으세요. 없는 id를 지어내지 마세요.",
  ]);
  if (sourceMarkerExtra) system.push(sourceMarkerExtra);
  system = system.concat([
    "",
    langInstruction,
    "",
    "## 출력 형식 — 매우 중요",
    "반드시 유효한 JSON 객체 하나만 출력하세요. 코드펜스(```), 머리말, 설명 문장, 후행 텍스트를 절대 붙이지 마세요. 응답의 첫 글자는 { 이고 마지막 글자는 } 여야 합니다.",
    "JSON 구조:",
    "{",
    '  "status": "ok" 또는 "not_found",',
    '  "answer": "자연어 분석. 학습 자료 근거 문장 끝에 [src_xxx] 마커. **굵게** 강조 가능",',
    '  "structured": {',
    '    "alarm_code": "알람 질문일 때만 (예: E0234). 아니면 이 필드 생략",',
    '    "alarm_meaning": "알람명 (선택)",',
    '    "interlocks": [ { "device": "M120", "comment": "안전 도어 닫힘", "input": "I0.7 / SX-12" } ],',
    '    "recommended_checks": [ { "order": 1, "action": "SX-12 센서 점검", "source_id": "src_003" } ]',
    "  },",
    '  "used_source_ids": ["src_001", "src_003"]',
    "}",
    "structured의 각 하위 필드는 해당 정보가 있을 때만 넣고, 없으면 생략하세요(빈 배열 허용).",
  ]);
  system = system.join("\n");

  const parts = [];
  if (opts.previousTurns && opts.previousTurns.length > 0) {
    parts.push("## 직전 대화 (후속 질문 참고용)");
    parts.push(JSON.stringify(opts.previousTurns));
    parts.push("");
  }
  parts.push("## 학습 자료");
  parts.push(opts.hasKb ? opts.kbContext : "(이 에이전트에 학습된 자료가 없습니다.)");
  parts.push("");
  // v17: Signal Graph 자동 조회 결과 (있을 때만)
  if (opts.signalContext) {
    parts.push(opts.signalContext);
    parts.push("");
  }
  parts.push("## 질문");
  parts.push(opts.question);

  return { system: system, userMsg: parts.join("\n") };
}

/**
 * Anthropic Messages API 직접 호출 (UrlFetchApp). text 블록만 합쳐 반환.
 */
function callClaudeAPI(apiKey, systemPrompt, userMessage) {
  const payload = {
    model: PLC_QUERY_MODEL,
    max_tokens: PLC_QUERY_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  // v19: 일시적 API 장애 자동 재시도 (Anthropic 500/502/503/504, 429, fetch 예외)
  //   - 즉시 시도 → 실패 시 2초 대기 후 재시도 → 또 실패 시 4초 대기 후 재시도 (총 3회)
  //   - 200은 즉시 성공 종료. 4xx 클라이언트 오류(401, 400 등)는 재시도 무의미 → 즉시 throw
  const RETRYABLE_CODES = [429, 500, 502, 503, 504];
  const MAX_ROUNDS = 3;
  const WAIT_MS = [0, 2000, 4000];

  let lastError = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (WAIT_MS[round] > 0) {
      Logger.log("[callClaudeAPI] 라운드 " + (round + 1) + "/" + MAX_ROUNDS + " — " + WAIT_MS[round] + "ms 대기 후 재시도");
      Utilities.sleep(WAIT_MS[round]);
    }
    let res;
    try {
      res = UrlFetchApp.fetch(ANTHROPIC_API_URL, {
        method: "post",
        contentType: "application/json",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
    } catch (fetchErr) {
      // fetch 자체 실패 (네트워크 오류·타임아웃 등) → 재시도
      lastError = "fetch 예외: " + fetchErr.message;
      Logger.log("[callClaudeAPI] fetch 예외 라운드 " + (round + 1) + ": " + fetchErr.message);
      continue;
    }
    const code = res.getResponseCode();
    const body = res.getContentText();
    if (code === 200) {
      const json = JSON.parse(body);
      const text = (json.content || [])
        .filter(function (b) { return b.type === "text"; })
        .map(function (b) { return b.text; })
        .join("\n");
      // 진단용 최소 로그 — stop_reason이 max_tokens면 응답 잘림(=max_tokens 상향 필요) 신호
      if (json.stop_reason === "max_tokens") {
        Logger.log("[callClaudeAPI] ⚠️ stop_reason=max_tokens — 응답 잘림 가능 (output_tokens="
          + ((json.usage && json.usage.output_tokens) || "?") + ")");
      }
      return text;
    }
    // 재시도 가능한 코드면 다음 라운드로
    if (RETRYABLE_CODES.indexOf(code) >= 0) {
      lastError = "Anthropic API " + code + ": " + String(body).slice(0, 300);
      Logger.log("[callClaudeAPI] HTTP " + code + " 라운드 " + (round + 1) + " — 재시도 예정");
      continue;
    }
    // 그 외 코드 (401, 400 등 클라이언트 오류) — 재시도 무의미, 즉시 throw
    throw new Error("Anthropic API " + code + ": " + String(body).slice(0, 300));
  }
  // 3회 모두 실패
  throw new Error("Anthropic API 재시도 " + MAX_ROUNDS + "회 모두 실패. 마지막 오류: " + lastError);
}

/**
 * LLM 응답 텍스트에서 JSON 객체 추출 (코드펜스/잡설 제거 후 parse).
 */
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    // v14: 폴백 — 원문에서 첫 { ~ 마지막 } 블록을 정규식으로 재추출 후 재시도
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (e2) { return null; }
    }
    return null;
  }
}

/**
 * 사용된 src id만 순서대로 sources[]로 조립 (중복 제거).
 */
function assembleSources(usedIds, srcMap) {
  const seen = {};
  const out = [];
  usedIds.forEach(function (id) {
    if (srcMap[id] && !seen[id]) {
      seen[id] = true;
      out.push(srcMap[id]);
    }
  });
  return out;
}

/**
 * 테스트 함수 — 에디터에서 직접 실행. 스크립트 속성 확인 + E0234 샘플 질의.
 * (실행 → 로그 확인. 외부 URL 호출 아니므로 배포 불필요.)
 */
function testPlcQuery() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("PLC_QUERY_TOKEN");
  console.log("PLC_QUERY_TOKEN:", token ? "YES" : "NO (프로젝트 설정에서 등록 필요)");
  console.log("ANTHROPIC_API_KEY:", props.getProperty("ANTHROPIC_API_KEY") ? "YES" : "NO (등록 필요)");
  if (!token) { console.log("토큰 미설정 — 테스트 중단"); return; }
  const result = handleQuery({
    path: "query",
    token: token,
    data: {
      agent: "cell_plc", mode: "analysis", equipment: "CL01", lang: "auto",
      input: { kind: "text", text: "E0234 왜 떴어?", photo_ocr: null },
      context: { previous_turns: [] },
    },
  });
  console.log("Result:", result.getContent());
}

/**
 * not_found 동작 확인용 — 학습 안 됐을 법한 질문.
 */
function testPlcQueryNotFound() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("PLC_QUERY_TOKEN");
  if (!token) { console.log("PLC_QUERY_TOKEN 미설정"); return; }
  const result = handleQuery({
    path: "query", token: token,
    data: {
      agent: "cell_plc", mode: "analysis", equipment: "CL01", lang: "auto",
      input: { kind: "text", text: "존재하지 않는 알람코드 ZZZ9999 설명해줘", photo_ocr: null },
      context: { previous_turns: [] },
    },
  });
  console.log("Result:", result.getContent());
}

// ════════════════════════════════════════════════════════════════════════════
// ★ v22 추가 블록 (Queue #14 Step 2) — 인증·권한·감사 인프라 + Drive 다운로드 primitive
// ════════════════════════════════════════════════════════════════════════════
//
// 📍 대상 프로젝트: Factory Agent KB (학습앱 백엔드)
//
// 【사용법】 기존 v21 코드는 한 줄도 지우지 말고, 파일 맨 끝에 이 블록 전체를 붙여넣으세요.
//           (Step 2는 함수·시트·상수만 신설. doPost/doGet·기존 함수는 무수정.
//            권한 게이트 enforce는 Step 3에서 프론트가 토큰을 보내기 시작할 때 켭니다.
//            → 이 블록을 붙이고 배포해도 기존 학습앱·논의앱·PLC Agent는 그대로 작동.)
//
// 【v22 (2026-06-04) 추가 내용】
//   - User_Permissions / Audit_Log 시트 신설 (ensure 함수, 기존 ensureProcessedFilesSheet 패턴)
//   - verifyIdToken()        : Google ID 토큰을 tokeninfo로 검증 (aud/exp/iss/email)
//   - checkUserPermission()  : User_Permissions 조회 → ISE/FSE/Manager 역할별 허용 판정
//   - logAudit()             : Audit_Log 1행 append
//   - authorizeRequest()     : verify + permission 통합 게이트 (Step 3에서 doPost가 호출. 지금은 정의만)
//   - ACTION_PERMISSIONS     : 액션 → 필요 권한(read/write/manager) 매핑
//   - downloadDriveImageAsBase64() / deleteDriveFile() : Drive 우회 사진 처리 primitive
//   - setupPermissionsInitial() : ★1회 실행★ — 시트 2개 생성 + Manager 1행 등록
//
// 【Step 2 실행 순서】
//   1. 이 블록을 v21 코드 맨 끝에 붙여넣기 → Ctrl+S 저장
//   2. 상단 함수 선택 박스에서 setupPermissionsInitial 선택 → ▶ 실행 → (첫 실행 시 권한 승인)
//      → 실행 로그에 "✅ 초기 Manager 등록 완료: potato2509@gmail.com" 확인
//   3. 배포: 배포 → 배포 관리 → 편집 → 새 버전 → 배포
//      ※ Step 2는 doPost/doGet 동작을 바꾸지 않으므로 외부 URL 동작은 동일.
//        그래도 버전 정렬 위해 재배포 권장. (게이트가 실제로 켜지는 Step 3에선 재배포 필수)

// ── 상수 ──────────────────────────────────────────────────────────────
const USER_PERMISSIONS_SHEET = "User_Permissions";
const AUDIT_LOG_SHEET = "Audit_Log";

// plc-drive 프로젝트 OAuth 클라이언트 ID (프론트가 보낼 ID 토큰의 aud 검증용)
const OAUTH_CLIENT_ID = "830951335500-mr71tivgr98at2ovvqcv16rdd8gvbi9n.apps.googleusercontent.com";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

const INITIAL_MANAGER_EMAIL = "potato2509@gmail.com";

// 액션 → 필요 권한 매핑 (결정 Q3 / 사양 v3 3계층)
//   "read"    = 활성 등록 사용자(ISE 이상)면 누구나
//   "write"   = FSE 이상. 대상 에이전트(data.role)가 있으면 그 role이 FSE의 assigned_agents에 포함돼야.
//               Manager는 전부 통과. data.role 없는 쓰기(회의록 등)는 FSE 이상이면 통과.
//   "manager" = Manager 전용 (Step 3에서 추가될 관리 액션용)
const ACTION_PERMISSIONS = {
  // 조회 (read)
  get_knowledge: "read", get_minutes: "read", get_all_progress: "read",
  get_summary: "read", count_since_summary: "read", get_category_items: "read",
  count_defect_images: "read", get_defect_image_data: "read",
  scan_learning_folder: "read", scan_learning_folder_all: "read",
  get_drive_file: "read", get_common_knowledge: "read",
  // 쓰기 (write)
  save_knowledge: "write", replace_knowledge: "write", delete_knowledge: "write",
  save_summary: "write", save_defect_pattern: "write", save_common_knowledge: "write",
  mark_file_processed: "write", upload_image: "write", save_minutes: "write",
  // Manager 전용 (Step 3 신규 액션 — 미리 매핑)
  manage_permissions: "manager", get_audit_log: "manager",
};

// ── 시트 보장 (기존 ensureProcessedFilesSheet 패턴) ───────────────────
function ensureUserPermissionsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(USER_PERMISSIONS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USER_PERMISSIONS_SHEET);
    // 사양 v3 §7 — 8개 컬럼
    sheet.appendRow([
      "email", "name", "role", "assigned_agents",
      "active", "created_at", "created_by", "notes",
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureAuditLogSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(AUDIT_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AUDIT_LOG_SHEET);
    sheet.appendRow(["timestamp", "email", "action", "target", "result", "detail"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── User_Permissions 조회 ─────────────────────────────────────────────
/** email로 사용자 1명 레코드 반환. 없으면 null. (대소문자 무시) */
function getUserRecord(email) {
  const sheet = ensureUserPermissionsSheet();
  if (sheet.getLastRow() < 2) return null;
  const target = String(email || "").toLowerCase().trim();
  if (!target) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || "").toLowerCase().trim() === target) {
      return {
        email: rows[i][0], name: rows[i][1], role: rows[i][2],
        assigned_agents: rows[i][3], active: rows[i][4],
        created_at: rows[i][5], created_by: rows[i][6], notes: rows[i][7],
      };
    }
  }
  return null;
}

// ── ID 토큰 검증 (tokeninfo) ──────────────────────────────────────────
/**
 * Google ID 토큰을 oauth2.googleapis.com/tokeninfo로 검증.
 * 성공: { ok:true, email, name, info }
 * 실패: { ok:false, error }
 */
function verifyIdToken(idToken) {
  if (!idToken) return { ok: false, error: "no_token" };
  try {
    const res = UrlFetchApp.fetch(
      TOKENINFO_URL + "?id_token=" + encodeURIComponent(idToken),
      { method: "get", muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) {
      return { ok: false, error: "tokeninfo_http_" + res.getResponseCode() };
    }
    const info = JSON.parse(res.getContentText());

    // aud 검증 — 우리 Client ID가 발급 대상인지
    if (info.aud !== OAUTH_CLIENT_ID) return { ok: false, error: "aud_mismatch" };
    // iss 검증 — 구글 발급인지
    if (info.iss !== "accounts.google.com" && info.iss !== "https://accounts.google.com") {
      return { ok: false, error: "iss_mismatch" };
    }
    // exp 검증 — 만료
    const now = Math.floor(Date.now() / 1000);
    if (info.exp && parseInt(info.exp, 10) < now) return { ok: false, error: "expired" };

    const email = String(info.email || "").toLowerCase().trim();
    if (!email) return { ok: false, error: "no_email" };

    return { ok: true, email: email, name: info.name || "", info: info };
  } catch (e) {
    return { ok: false, error: "verify_exception: " + e.message };
  }
}

// ── 권한 판정 ─────────────────────────────────────────────────────────
/**
 * email + 필요권한레벨(+대상 agentRole)로 허용 여부 판정.
 * 성공: { ok:true, role }
 * 실패: { ok:false, reason }
 */
function checkUserPermission(email, requiredLevel, agentRole) {
  const user = getUserRecord(email);
  if (!user) return { ok: false, reason: "not_registered" };
  if (String(user.active).toLowerCase() !== "true") return { ok: false, reason: "inactive" };

  const role = user.role; // ISE | FSE | Manager

  if (requiredLevel === "read") {
    return { ok: true, role: role }; // 활성 등록자면 누구나 조회
  }

  if (requiredLevel === "manager") {
    return role === "Manager"
      ? { ok: true, role: role }
      : { ok: false, reason: "manager_only" };
  }

  if (requiredLevel === "write") {
    if (role === "Manager") return { ok: true, role: role };
    if (role === "FSE") {
      if (!agentRole) return { ok: true, role: role }; // 대상 agent 없는 쓰기(회의록 등)
      const assigned = String(user.assigned_agents || "")
        .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (assigned.indexOf(agentRole) >= 0) return { ok: true, role: role };
      return { ok: false, reason: "agent_not_assigned" };
    }
    return { ok: false, reason: "ise_cannot_write" }; // ISE
  }

  return { ok: false, reason: "unknown_level" };
}

// ── 감사 로그 ─────────────────────────────────────────────────────────
/** Audit_Log에 1행 기록. 실패해도 본 흐름을 막지 않음(로그만). */
function logAudit(email, action, target, result, detail) {
  try {
    const sheet = ensureAuditLogSheet();
    sheet.appendRow([
      new Date().toISOString(),
      email || "", action || "", target || "", result || "", detail || "",
    ]);
  } catch (e) {
    Logger.log("[logAudit] 기록 실패: " + e.message);
  }
}

// ── 통합 게이트 (Step 3에서 doPost가 호출. Step 2에서는 정의만, 호출 안 함) ──
/**
 * verify + permission을 한 번에. 거부 시 자동으로 감사 로그 기록.
 * 성공: { ok:true, email, role }
 * 실패: { ok:false, code:"unauthenticated"|"forbidden", reason, email? }
 */
function authorizeRequest(idToken, action, agentRole) {
  const v = verifyIdToken(idToken);
  if (!v.ok) {
    logAudit("(unknown)", action, agentRole || "", "deny_auth", v.error);
    return { ok: false, code: "unauthenticated", reason: v.error };
  }
  const level = ACTION_PERMISSIONS[action] || "manager"; // 미정의 액션은 보수적으로 Manager 전용
  const p = checkUserPermission(v.email, level, agentRole);
  if (!p.ok) {
    logAudit(v.email, action, agentRole || "", "deny_perm", p.reason);
    return { ok: false, code: "forbidden", reason: p.reason, email: v.email };
  }
  return { ok: true, email: v.email, role: p.role };
}

// ── Drive 우회 사진 처리 primitive (결정 Q5 — Drive 경로 일원화의 백엔드 쪽) ──
//   Step 5(PLC Agent 연결) 때 백엔드 Vision 호출에 연결합니다.
//   여기서는 다운로드/삭제 빌딩블록만 신설. (자동삭제 시점·고아 청소는 Step 5에서 흐름과 함께 확정)
/** fileId 이미지를 백엔드에서 받아 base64로 반환. 성공:{ok,base64,mimeType,name,size} */
function downloadDriveImageAsBase64(fileId) {
  try {
    if (!fileId) return { ok: false, error: "no_fileId" };
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    return {
      ok: true,
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType(),
      name: file.getName(),
      size: file.getSize(),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 분석 성공 후 임시 사진 삭제 (결정 Q3). setTrashed — 30일 복구 가능. */
function deleteDriveFile(fileId) {
  try {
    if (!fileId) return { ok: false, error: "no_fileId" };
    DriveApp.getFileById(fileId).setTrashed(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── ★1회 실행★ 초기 셋업 — 시트 2개 생성 + Manager 1행 등록 ───────────
/**
 * 에디터에서 직접 1회 실행. 외부 URL 호출 아니므로 배포와 무관.
 * 재실행 안전: Manager가 이미 있으면 중복 추가 안 함.
 */
function setupPermissionsInitial() {
  ensureUserPermissionsSheet();
  ensureAuditLogSheet();

  const existing = getUserRecord(INITIAL_MANAGER_EMAIL);
  if (existing) {
    Logger.log("⏭ 이미 등록됨: " + INITIAL_MANAGER_EMAIL + " (role: " + existing.role + ")");
    return;
  }

  const sheet = ensureUserPermissionsSheet();
  const now = new Date().toLocaleString("ko-KR");
  sheet.appendRow([
    INITIAL_MANAGER_EMAIL, // email
    "김지호",               // name
    "Manager",             // role
    "",                    // assigned_agents (Manager는 전부 통과하므로 비움)
    "true",                // active
    now,                   // created_at
    "system",              // created_by
    "초기 Manager (Queue #14 Step 2)", // notes
  ]);
  logAudit(INITIAL_MANAGER_EMAIL, "setup_initial_manager", "User_Permissions", "ok", "Step 2 초기 셋업");
  Logger.log("✅ 초기 Manager 등록 완료: " + INITIAL_MANAGER_EMAIL);
}

// ── 검증용 — 에디터에서 실행해 토큰 검증·권한 판정 확인 ─────────────────
/** ID 토큰 문자열을 인자로 넣어 검증 흐름 확인 (프론트 콘솔에서 토큰 복사해 테스트). */
function testVerifyToken(idToken) {
  const v = verifyIdToken(idToken);
  Logger.log("verifyIdToken: " + JSON.stringify(v));
  if (v.ok) {
    Logger.log("read 권한: " + JSON.stringify(checkUserPermission(v.email, "read", null)));
    Logger.log("write(Cell_PLC): " + JSON.stringify(checkUserPermission(v.email, "write", "Cell_PLC")));
    Logger.log("manager: " + JSON.stringify(checkUserPermission(v.email, "manager", null)));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ★ v23 추가 블록 (Queue #14 Step 3a) — 세션 토큰 발급 (start_session / logout)
// ════════════════════════════════════════════════════════════════════════════
//
// 📍 대상 프로젝트: Factory Agent KB (학습앱 백엔드)
// 📍 전제: v22 블록(verifyIdToken / getUserRecord / logAudit)이 이미 들어가 있어야 함.
//
// 【무엇을 하나】
//   프론트가 로그인 1회 시 Google ID 토큰을 보내면 → verifyIdToken으로 1회 검증 →
//   User_Permissions 조회 → 등록·활성 사용자면 세션 토큰 발급(CacheService 6시간) → 반환.
//   이후 요청은 매번 tokeninfo를 부르지 않고 이 세션 토큰으로 빠르게 확인 (3b에서 enforce).
//   → '매 요청 tokeninfo 부담'과 'Google 토큰 1시간 만료' 문제를 동시에 해결.
//
// 【Step 3a는 enforce 없음】
//   이 블록은 세션을 '발급'만 함. doPost/doGet에서 세션을 '검사(거부)'하는 건 Step 3b.
//   따라서 적용·배포해도 기존 학습앱·논의앱·PLC Agent 동작 그대로. (로그인 기능만 추가)
//
// 【적용 순서】
//   1) 이 블록 전체를 기존 코드 맨 끝에 붙여넣기 (기존 코드 삭제 금지)
//   2) ★doPost 라우터에 2줄 삽입★ (아래 "doPost 수정" 참조) — 이것만 기존 코드 1곳 수정
//   3) Ctrl+S → 배포 → 배포 관리 → 편집 → 새 버전 → 배포 (★재배포 필수: doPost가 바뀜)
//
// 【doPost 수정 — 단 한 곳, 2줄 삽입】
//   기존 doPost 안 "학습앱 분기" 부분에서 아래를 찾으세요:
//
//       // 학습앱 분기
//       const action = data.action;
//       if (action === "save_minutes") saveMinutes(data);
//
//   "const action = data.action;" 바로 다음 줄에 아래 2줄을 끼워 넣으세요:
//
//       if (action === "start_session") return handleStartSession(data);
//       if (action === "logout") return handleLogout(data);
//
//   결과는 이렇게 됩니다:
//       // 학습앱 분기
//       const action = data.action;
//       if (action === "start_session") return handleStartSession(data);   // ← 추가
//       if (action === "logout") return handleLogout(data);                // ← 추가
//       if (action === "save_minutes") saveMinutes(data);
//       ... (기존 그대로)

// ── 세션 상수 ─────────────────────────────────────────────────────────
const SESSION_CACHE_PREFIX = "sess_";
const SESSION_TTL_SECONDS = 6 * 60 * 60; // 6시간 (CacheService ScriptCache 최대치)

// ── 세션 발급/검증/삭제 (CacheService ScriptCache — 전 사용자 공용) ──────
// 주의: CacheService는 메모리 압박 시 TTL 전이라도 항목이 사라질 수 있음.
//       세션 store 용도엔 일반적으로 무방(만료 시 재로그인). 영구 저장 아님.
function createSession(user) {
  const token = Utilities.getUuid();
  const payload = JSON.stringify({
    email: user.email,
    name: user.name || "",
    role: user.role,                       // ISE | FSE | Manager
    assigned_agents: user.assigned_agents || "",
    created_at: Date.now(),
  });
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, payload, SESSION_TTL_SECONDS);
  return token;
}

/** 세션 토큰으로 사용자 정보 조회. 유효하면 객체, 없으면 null. (3b 게이트에서 사용) */
function validateSession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(SESSION_CACHE_PREFIX + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function deleteSession(token) {
  if (!token) return;
  try { CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + token); } catch (e) {}
}

// ── 로그인 핸들러 — ID 토큰 검증 → 세션 발급 ───────────────────────────
/**
 * 요청 body: { action:"start_session", id_token:"<Google ID 토큰(JWT)>" }
 * 응답(성공): { success:true, status:"ok", session_token, email, name, role, assigned_agents }
 * 응답(실패): { success:false, status:"auth_failed"|"not_registered"|"inactive", email?, name?, error? }
 *   → 프론트는 status로 화면 분기 (등록 안 됨 / 비활성 / 인증 실패)
 */
function handleStartSession(data) {
  const idToken = data.id_token || data.credential || "";
  const v = verifyIdToken(idToken);   // v22 함수 (tokeninfo 1회 호출)
  if (!v.ok) {
    logAudit("(unknown)", "login", "", "deny_auth", v.error);
    return makeResponse({ success: false, status: "auth_failed", error: v.error });
  }

  const user = getUserRecord(v.email); // v22 함수
  if (!user) {
    logAudit(v.email, "login", "", "deny_unregistered", "");
    return makeResponse({ success: false, status: "not_registered", email: v.email, name: v.name });
  }
  if (String(user.active).toLowerCase() !== "true") {
    logAudit(v.email, "login", "", "deny_inactive", "");
    return makeResponse({ success: false, status: "inactive", email: v.email });
  }

  const token = createSession({
    email: user.email, name: user.name, role: user.role, assigned_agents: user.assigned_agents,
  });
  logAudit(v.email, "login", "", "ok", "session issued");

  return makeResponse({
    success: true,
    status: "ok",
    session_token: token,
    email: user.email,
    name: user.name || "",
    role: user.role,                       // ISE | FSE | Manager
    assigned_agents: user.assigned_agents || "",
  });
}

// ── 로그아웃 핸들러 — 세션 삭제 ────────────────────────────────────────
/** 요청 body: { action:"logout", session_token } */
function handleLogout(data) {
  const s = validateSession(data.session_token);
  if (s) logAudit(s.email, "logout", "", "ok", "");
  deleteSession(data.session_token);
  return makeResponse({ success: true });
}

// ── 검증용 (에디터에서 실행) — 세션 발급/검증/삭제 라운드트립 확인 ───────
/** ID 토큰 없이 세션 store 자체만 확인 (가짜 사용자로 put→get→remove). */
function testSessionRoundtrip() {
  const token = createSession({ email: "test@example.com", name: "테스트", role: "ISE", assigned_agents: "" });
  Logger.log("발급 토큰: " + token);
  const got = validateSession(token);
  Logger.log("검증 결과: " + JSON.stringify(got));
  deleteSession(token);
  Logger.log("삭제 후 재검증(null이어야 정상): " + JSON.stringify(validateSession(token)));
}

// ════════════════════════════════════════════════════════════════════════════
// ★ v24 추가 블록 (Queue #14 Step 3b-①) — 권한 게이트 enforce ON
// ════════════════════════════════════════════════════════════════════════════
//
// 📍 대상 프로젝트: Factory Agent KB (학습앱 백엔드)
// 📍 전제: v22(checkUserPermission/ACTION_PERMISSIONS/logAudit) + v23(validateSession) 적용돼 있어야 함.
//
// 【무엇을 하나】
//   doPost/doGet의 학습앱 분기 진입부에서 세션 토큰을 검사하고, 액션별 권한(read/write/manager)을
//   세션에 담긴 role·assigned_agents로 판정 → 거부 시 차단 + 감사 로그.
//   ※ 권한 판정에 User_Permissions 시트를 매번 다시 읽지 않음(세션 캐시 사용) → 빠름.
//
// 【영향 범위】
//   - 학습앱 action 호출만 게이트. start_session/logout은 게이트 앞이라 제외.
//   - secret(Teams)·path:"query"(PLC)는 학습앱 분기에 도달 전 이미 return → 영향 없음.
//   - 지금 등록자는 Manager(potato2509) 1명뿐 → Manager는 전부 통과. 정상 사용 영향 없음.
//   - UI 분기는 아직 없음(Step 3b-②). 여기선 백엔드 차단만.
//
// ─────────────────────────────────────────────────────────────────────
// 【★적용 전 필수 점검 — 락아웃 방지】
//   게이트를 켜면 모든 학습앱 요청에 유효한 session_token이 있어야 통과합니다.
//   Step 3a의 api.get/api.call 토큰 첨부가 실제로 동작하는지 먼저 1회 확인:
//     1) 배포된 학습앱에 로그인된 상태로 접속
//     2) 브라우저 F12 → Network 탭
//     3) 아무 역할 진입(데이터 로드 발생) → 요청 하나 클릭
//     4) 요청 URL(또는 Payload)에 session_token=... 값이 들어있으면 OK
//   → session_token이 안 보이면 Step 3a의 api 수정이 누락된 것. 그 경우 게이트 켜지 말고 먼저 수정.
//
// 【적용 순서】
//   1) 이 블록을 기존 코드 맨 끝에 붙여넣기
//   2) ★doPost / doGet 두 곳에 게이트 삽입★ (아래 참조) — 기존 코드 수정 2곳
//   3) Ctrl+S → 배포 → 배포 관리 → 편집 → 새 버전 → 배포 (★재배포 필수)
//
// 【롤백】 문제 시: 삽입한 게이트 2줄을 주석(//) 처리 후 재배포 → 즉시 enforce 해제(기존 동작).
//
// ─────────────────────────────────────────────────────────────────────
// 【doPost 수정 — 게이트 2줄 삽입】
//   v23에서 넣은 start_session/logout 줄 바로 다음에 삽입:
//
//       const action = data.action;
//       if (action === "start_session") return handleStartSession(data);
//       if (action === "logout") return handleLogout(data);
//       // ↓↓↓ 아래 2줄 추가 ↓↓↓
//       const _g = authorizeBySession(data.session_token, action, data.role);
//       if (!_g.ok) return makeResponse({ success: false, error: _g.reason });
//       // ↑↑↑ 여기까지 ↑↑↑
//       if (action === "save_minutes") saveMinutes(data);
//       ... (기존 그대로)
//
// 【doGet 수정 — 게이트 2줄 삽입】
//   doGet에서 "const role = e.parameter.role;" 바로 다음에 삽입:
//
//       const role = e.parameter.role;
//       // ↓↓↓ 아래 2줄 추가 ↓↓↓
//       const _g = authorizeBySession(e.parameter.session_token, action, role);
//       if (!_g.ok) return makeResponse({ success: false, error: _g.reason });
//       // ↑↑↑ 여기까지 ↑↑↑
//       if (action === "get_knowledge") return getKnowledge(role);
//       ... (기존 그대로)
//
//   ※ doGet의 alive 체크(if (!action) ...)는 게이트 위에 있으므로 그대로 통과(헬스체크 유지).

// ── 세션 기반 권한 판정 (시트 재조회 없음 — 세션 캐시의 role/assigned_agents 사용) ──
function checkPermissionFromSession(session, level, agentRole) {
  const role = session.role; // ISE | FSE | Manager
  if (level === "read") return { ok: true };
  if (level === "manager") {
    return role === "Manager" ? { ok: true } : { ok: false, reason: "manager_only" };
  }
  if (level === "write") {
    if (role === "Manager") return { ok: true };
    if (role === "FSE") {
      if (!agentRole) return { ok: true }; // 대상 agent 없는 쓰기(회의록 등)
      const assigned = String(session.assigned_agents || "")
        .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      return assigned.indexOf(agentRole) >= 0
        ? { ok: true }
        : { ok: false, reason: "agent_not_assigned" };
    }
    return { ok: false, reason: "ise_cannot_write" }; // ISE
  }
  return { ok: false, reason: "unknown_level" };
}

// ── 통합 게이트 — 세션 검증 + 권한 판정 ────────────────────────────────
/**
 * 성공: { ok:true, email, role }
 * 실패: { ok:false, reason } — reason:
 *   "session_invalid"  세션 없음/만료 → 프론트는 재로그인 유도
 *   "forbidden"        로그인은 했으나 권한 없음(쓰기 등) → 감사 로그 기록됨
 */
function authorizeBySession(sessionToken, action, agentRole) {
  const s = validateSession(sessionToken); // v23
  if (!s) return { ok: false, reason: "session_invalid" };

  const level = ACTION_PERMISSIONS[action] || "manager"; // v22 매핑, 미정의는 보수적으로 Manager
  const p = checkPermissionFromSession(s, level, agentRole);
  if (!p.ok) {
    logAudit(s.email, action, agentRole || "", "deny_perm", p.reason); // v22
    return { ok: false, reason: "forbidden", detail: p.reason, email: s.email };
  }
  return { ok: true, email: s.email, role: s.role };
}


// ════════════════════════════════════════════════════════════════════════════
// 【v23 (2026-06-04) 추가 — 회로 역추적 통합】
//   명세서: 학습앱_회로역추적_통합명세서.html
//   PLC 프로그램 분석도구 V1 채팅방 산출 trace_signal.py를 Apps Script로 포팅.
//   신호 의존 체인을 재귀 추적해 외부 입력 leaf까지 트리 구성.
//   signal_graph + block_signals_index 둘 다 필요 (사전 구축에 block 사용).
// ════════════════════════════════════════════════════════════════════════════

const TRACE_KEYWORDS = { AND:1, OR:1, NOT:1, XOR:1, TRUE:1, FALSE:1, EMPTY:1, CYCLE:1, OPEN:1, UNCONNECTED:1 };
const TRACE_SHORT_NOISE = {
  IN:1, OUT:1, PT:1, ET:1, Q:1, EMO:1, NG:1, OK:1,
  Alarm:1, Door:1, Run:1, Auto:1, Use:1, Reset:1, Step:1,
  Eq:1, Ge:1, Gt:1, Lt:1, Le:1, Ne:1
};

function _isTraceWordChar(c) {
  return /[a-zA-Z0-9_.]/.test(c);
}

/** 알려진 신호 사전 구축 (graph 키 + block_signals 안 all_signals + IEC_TIMER의 .Q/.ET). */
function buildKnownSignalSet(graph, blocks) {
  const set = {};
  const gKeys = Object.keys(graph);
  for (var i = 0; i < gKeys.length; i++) set[gKeys[i]] = true;
  if (!blocks) return set;
  const bKeys = Object.keys(blocks);
  for (var bi = 0; bi < bKeys.length; bi++) {
    const info = blocks[bKeys[bi]] || {};
    const all = info.all_signals || [];
    for (var ai = 0; ai < all.length; ai++) {
      const item = all[ai];
      const name = typeof item === 'string' ? item : (item && item.name) || '';
      if (name) set[name] = true;
    }
    const byType = info.signals_by_type || {};
    const timers = byType.IEC_TIMER || [];
    for (var ti = 0; ti < timers.length; ti++) {
      const t = timers[ti];
      const name = typeof t === 'string' ? t : (t && t.name) || '';
      if (name) {
        set[name + ".Q"] = true;
        set[name + ".ET"] = true;
      }
    }
  }
  return set;
}

/** 1차: 사전 매칭 (가장 긴 매칭 우선, 단어 경계 확인, 마스킹). */
function extractByDict(condStr, sortedSignals) {
  if (!condStr) return { found: [], remaining: condStr || "" };
  const masked = condStr.split('');
  const found = [];
  for (var si = 0; si < sortedSignals.length; si++) {
    const sig = sortedSignals[si];
    if (!sig || sig.length < 3) continue;
    var idx = 0;
    while (idx < condStr.length) {
      const pos = condStr.indexOf(sig, idx);
      if (pos < 0) break;
      const beforeOk = (pos === 0) || !_isTraceWordChar(condStr.charAt(pos - 1));
      const afterPos = pos + sig.length;
      const afterOk = (afterPos >= condStr.length) || !_isTraceWordChar(condStr.charAt(afterPos));
      var alreadyMasked = false;
      for (var mi = pos; mi < pos + sig.length; mi++) {
        if (masked[mi] === '\0') { alreadyMasked = true; break; }
      }
      if (beforeOk && afterOk && !alreadyMasked) {
        found.push(sig);
        for (var mj = pos; mj < pos + sig.length; mj++) masked[mj] = '\0';
      }
      idx = pos + sig.length;
    }
  }
  var remaining = "";
  for (var ri = 0; ri < masked.length; ri++) {
    remaining += (masked[ri] === '\0') ? ' ' : masked[ri];
  }
  return { found: found, remaining: remaining };
}

/** 2차: AND/OR/NOT 토큰 분리 (사전 없는 신호도 인식). */
function extractByTokens(condStr) {
  if (!condStr) return [];
  const parts = condStr.split(/\b(?:AND|OR|NOT|XOR)\b|[(),]/);
  const result = [];
  for (var pi = 0; pi < parts.length; pi++) {
    const p = parts[pi].trim();
    if (!p || p.length < 3) continue;
    if (TRACE_KEYWORDS[p.toUpperCase()]) continue;
    if (TRACE_SHORT_NOISE[p]) continue;
    if (p.charAt(0) === '#') continue;
    if (p.charAt(0) === '<') continue;
    if (p.indexOf('OTHER:') === 0) continue;
    result.push(p);
  }
  return result;
}

/** 1차(사전) + 2차(토큰) 결합 — 중복 제거 순서 유지. */
function extractSignals(condStr, sortedSignals) {
  const dict = extractByDict(condStr, sortedSignals);
  const tokens = extractByTokens(dict.remaining);
  const seen = {};
  const result = [];
  for (var i = 0; i < dict.found.length; i++) {
    if (!seen[dict.found[i]]) { seen[dict.found[i]] = true; result.push(dict.found[i]); }
  }
  for (var j = 0; j < tokens.length; j++) {
    if (!seen[tokens[j]]) { seen[tokens[j]] = true; result.push(tokens[j]); }
  }
  return result;
}

/** 메인 재귀 트레이스. max_depth/cycle/external_input 처리. */
function traceSignal(signal, graph, sortedSignals, maxDepth, maxLocs, depth, visited) {
  depth = depth || 0;
  maxLocs = maxLocs || 3;
  visited = visited || {};
  if (depth > maxDepth) return { signal: signal, reason: 'max_depth', children: [] };
  if (visited[signal]) return { signal: signal, reason: 'cycle', children: [] };
  const newVisited = {};
  const vKeys = Object.keys(visited);
  for (var vi = 0; vi < vKeys.length; vi++) newVisited[vKeys[vi]] = true;
  newVisited[signal] = true;

  const info = graph[signal];
  if (!info || !info.set_locations || info.set_locations.length === 0) {
    return { signal: signal, reason: 'external_input', children: [] };
  }
  const totalLocs = info.set_locations.length;
  const locsToShow = info.set_locations.slice(0, maxLocs);
  const omitted = Math.max(0, totalLocs - maxLocs);

  const children = [];
  for (var li = 0; li < locsToShow.length; li++) {
    const loc = locsToShow[li];
    const condStr = loc.condition_str || '';
    const inputSignals = extractSignals(condStr, sortedSignals);
    const subChildren = [];
    for (var ii = 0; ii < inputSignals.length; ii++) {
      subChildren.push(traceSignal(inputSignals[ii], graph, sortedSignals, maxDepth, maxLocs, depth + 1, newVisited));
    }
    children.push({
      block: loc.block || '?',
      network: loc.network_id || '?',
      title: loc.network_title || '',
      operator: loc.operator || '?',
      mode: loc.mode || '',
      condition_str: condStr,
      children: subChildren,
    });
  }
  return {
    signal: signal, reason: 'traced',
    set_locations: children,
    omitted_locations: omitted,
    total_locations: totalLocs,
  };
}

/** 트리 → 들여쓰기 텍스트. */
function treeToText(node, indent) {
  indent = indent || 0;
  const pad = new Array(indent + 1).join('  ');
  const lines = [];
  if (node.reason === 'external_input') {
    lines.push(pad + '🔻 ' + node.signal + '  [외부 입력]');
    return lines.join('\n');
  }
  if (node.reason === 'cycle') {
    lines.push(pad + '🔄 ' + node.signal + '  [cycle - 이미 추적됨]');
    return lines.join('\n');
  }
  if (node.reason === 'max_depth') {
    lines.push(pad + '⏸  ' + node.signal + '  [깊이 제한]');
    return lines.join('\n');
  }
  const total = node.total_locations || 0;
  const suffix = total > 1 ? '  (전체 ' + total + '곳)' : '';
  lines.push(pad + '● ' + node.signal + suffix);
  const setLocs = node.set_locations || [];
  for (var li = 0; li < setLocs.length; li++) {
    const loc = setLocs[li];
    const markers = { set:'⬆', reset:'⬇', normal:'→', timer:'⏱', rising_edge:'↗', falling_edge:'↘' };
    const modeMarker = markers[loc.mode] || '→';
    const titleStr = loc.title ? ' (' + loc.title + ')' : '';
    lines.push(pad + '  ' + modeMarker + ' [' + loc.operator + '/' + loc.mode + '] '
      + loc.block + ' N' + loc.network + titleStr);
    const cond = loc.condition_str || '';
    const condShow = cond.length <= 110 ? cond : cond.slice(0, 110) + '...';
    lines.push(pad + '     조건: ' + condShow);
    const subs = loc.children || [];
    for (var ci = 0; ci < subs.length; ci++) {
      lines.push(treeToText(subs[ci], indent + 2));
    }
  }
  if (node.omitted_locations > 0) {
    lines.push(pad + '  ⋯ 외 ' + node.omitted_locations + '곳 생략');
  }
  return lines.join('\n');
}

/** 트리에서 external_input leaf 신호 수집. */
function collectExternals(node, externals) {
  externals = externals || {};
  if (node.reason === 'external_input') {
    externals[node.signal] = true;
  } else if (node.reason === 'traced') {
    const setLocs = node.set_locations || [];
    for (var li = 0; li < setLocs.length; li++) {
      const subs = setLocs[li].children || [];
      for (var ci = 0; ci < subs.length; ci++) {
        collectExternals(subs[ci], externals);
      }
    }
  }
  return externals;
}

/** 트레이스 결과 → LLM 컨텍스트 텍스트 (명세서 §4 처리 룰 안내 포함). */
function formatTraceContext(targetSignal, tree, depthRequested) {
  if (!tree) return '';
  const lines = [
    "",
    "## [회로 역추적 결과] (Signal Graph 재귀 추적, 깊이=" + depthRequested + ")",
    "대상 신호: " + targetSignal,
    "",
    "### 추적 트리",
    treeToText(tree),
    "",
  ];
  const ext = collectExternals(tree);
  const extList = Object.keys(ext);
  if (extList.length > 0) {
    lines.push("### 최종 외부 입력 신호 (" + extList.length + "개) — 작업자가 실제로 점검할 신호");
    extList.sort();
    for (var i = 0; i < extList.length; i++) {
      lines.push("  🔻 " + extList[i]);
    }
    lines.push("");
  }
  lines.push("**처리 룰 (반드시 따르세요):**");
  lines.push("1. 트리를 그대로 답변에 복붙하지 말고 사용자 질문 의도에 맞춰 요약하세요.");
  lines.push("   · '어디서 켜져?' → 1단계 위치 + 조건만");
  lines.push("   · 'ON 되려면?' → 외부 입력 목록 + 핵심 체인");
  lines.push("2. 외부 입력(🔻 leaf)은 답변 끝에 정리해서 작업자 점검 포인트로 명확히 안내.");
  lines.push("3. NOT 패턴 자연어 해석: 'NOT(A AND B AND C)' → 'A, B, C 중 하나라도 OFF면 ON' 식으로 설명.");
  lines.push("4. KB 사례 카드에 추적 신호 매칭되면 결합 안내 (예: safetyRelease 추적 시 FB 내부 변수 사례 연결).");
  lines.push("5. answer 끝에 'ⓘ 출처: 회로 역추적 (Signal Graph 자동 추적)' 라벨을 붙이세요.");
  lines.push("   KB 사례 결합 시: 'ⓘ 출처: 회로 역추적 + KB 사례'.");
  return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * Fork C (2026-06-09) — detectTraceTrigger 기호 무관 신호 인식
 *
 * 📍 대상 프로젝트: Factory Agent KB (학습앱 백엔드)
 *
 * ▣ 문제
 *   챗 탭(handleQuery)에서 "Door_Open_Error 왜 떠?"는 회로 답변되지만
 *   "Door Open Error 왜 떠?"(공백)는 안 됨. 정규화가 공백만 제거하고 언더바는 남겨
 *   "dooropenerror" vs "door_open_error" 불일치. phrase 매칭도 공백/언더바 차이로 실패.
 *
 * ▣ 해결 (규칙 기반, LLM 불필요)
 *   - 정규화에서 공백·따옴표뿐 아니라 언더바(_)·하이픈(-)도 제거 → 기호 무관 일치
 *     "Door Open Error" / "Door_Open_Error" / "door-open-error" / "DOOR OPEN ERROR"
 *     모두 "dooropenerror" 로 통일 인식
 *   - 다단어 phrase 도 후보에 포함(공백 신호명 대응) + 정규화 비교
 *   - 부분 일치는 후보 6자+ 만 허용(짧은 단어 "error" 단독 오매칭 차단)
 *   - "왜 떠/뜨/발생/그래" 류 트리거 패턴 명시 추가
 *   - extractSignalCandidates 는 미수정(회귀 안전)
 *
 * ▣ 적용
 *   기존 detectTraceTrigger 함수 전체를 아래로 교체. 다른 함수·라우터 무변경.
 *   저장 → 배포 → 배포 관리 → 편집 → 새 버전 → 배포 (★재배포 필수: handleQuery가 호출)
 *
 * ▣ 의존 (이미 존재): extractSignalCandidates
 * ═══════════════════════════════════════════════════════════════════════════════ */

function detectTraceTrigger(question, graph) {
  const q = String(question || '');
  const patterns = [
    { re: /인터락|안전\s*조건|safety\s*condition/i, depth: 5 },
    { re: /왜\s*(?:ON|on)?\s*(?:안\s*돼|안\s*되|안된|문제|fail|장애)|원인\s*(?:찾|추적)/i, depth: 4 },
    { re: /끝까지|깊이\s*추적|전체\s*체인|deep\s*trace|full\s*trace/i, depth: 5 },
    { re: /회로\s*(?:분석|분해)|SET\s*조건|set\s*condition/i, depth: 2 },
    { re: /(?:ON|on)\s*되려면|되려면\s*뭐|뭐가\s*필요/i, depth: 3 },
    { re: /어디서\s*(?:켜져|set|SET|set돼|set되)|어디에서\s*켜/i, depth: 3 },
    { re: /추적(?:해|하면|해줘)?|trace(?:\s+this)?/i, depth: 3 },
    { re: /왜\s*(?:떠|뜨|뜨는|뜨나|발생|올라|나와|나오|생겨|생기)|왜\s*그래|왜\s*이래|why/i, depth: 4 },
  ];
  var matchedDepth = null;
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].re.test(q)) { matchedDepth = patterns[i].depth; break; }
  }
  if (matchedDepth === null) return null;
  if (!graph) return null;

  // 기호(공백·따옴표·언더바·하이픈) 무시 정규화 — 기호 차이로 답이 갈리지 않게
  const norm = function (s) { return String(s).replace(/[\s"'_\-]/g, "").toLowerCase(); };
  const keys = Object.keys(graph);

  // 후보 수집: 개별 신호 후보 + 다단어 phrase(공백 신호명 대응)
  const cands = extractSignalCandidates(q).slice();
  const phrasePattern = /[A-Za-z][a-zA-Z0-9_]+(?:\s+[A-Za-z][a-zA-Z0-9_]+){1,5}/g;
  const phrases = q.match(phrasePattern) || [];
  for (var pi = 0; pi < phrases.length; pi++) {
    if (phrases[pi].length >= 6) cands.push(phrases[pi]);
  }

  // 정규화 + 길이 내림차순 (정확/긴 후보 우선)
  const nc = [];
  for (var ci = 0; ci < cands.length; ci++) {
    const n = norm(cands[ci]);
    if (n.length >= 4) nc.push({ raw: cands[ci], n: n });
  }
  nc.sort(function (a, b) { return b.n.length - a.n.length; });

  // 1) 정확(정규화) 일치 — 원본 키 우선
  for (var a = 0; a < nc.length; a++) {
    if (graph[nc[a].raw]) return { target: nc[a].raw, depth: matchedDepth };
    for (var ki = 0; ki < keys.length; ki++) {
      if (norm(keys[ki]) === nc[a].n) return { target: keys[ki], depth: matchedDepth };
    }
  }
  // 2) 부분 일치 — 후보 6자+ 만(짧은 단어 오매칭 차단), 가장 짧은 키 선택
  for (var b = 0; b < nc.length; b++) {
    if (nc[b].n.length < 6) continue;
    var bestKey = null, bestLen = Infinity;
    for (var kj = 0; kj < keys.length; kj++) {
      if (norm(keys[kj]).indexOf(nc[b].n) >= 0 && keys[kj].length < bestLen) {
        bestKey = keys[kj]; bestLen = keys[kj].length;
      }
    }
    if (bestKey) return { target: bestKey, depth: matchedDepth };
  }
  return null;
}

/*** PLC 블록 JSON → KB 적재 (parsed_json 폴더 스캔, 덮어쓰기) ***/
const PLC_PARSED_FOLDER_ID = '1oy3covfe3uYTjVdwfFrPTx-DObIRu7vv'; // STK_1A1/parsed_json
const PLC_KB_SPREADSHEET_ID = '1Kc_aRh-MLJPJvgmkcqhU4Gw20n5MhEkfnsqoNf8QOLY'; // 학습앱 KB 시트
const PLC_INDEX_SHEET = 'PLC_Block_Index';
const PLC_CHUNK_SHEET = 'PLC_Block_JSON';
const PLC_CHUNK_SIZE = 40000;
const PLC_EQUIPMENT = 'STK_1A1';

function ingestParsedJson() {
  const ss = SpreadsheetApp.openById(PLC_KB_SPREADSHEET_ID);
  const idx = plcGetOrCreateSheet_(ss, PLC_INDEX_SHEET,
    ['equipment','block_name','block_number','language','output_signals','total_chunks','json_file_id','updated_at']);
  const chk = plcGetOrCreateSheet_(ss, PLC_CHUNK_SHEET,
    ['block_key','chunk_index','total_chunks','json_chunk']);

  const folder = DriveApp.getFolderById(PLC_PARSED_FOLDER_ID);
  const files = folder.getFilesByType('application/json');
  const today = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  let count = 0;

  while (files.hasNext()) {
    const file = files.next();
    const raw = file.getBlob().getDataAsString('UTF-8');
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { Logger.log('SKIP (JSON 오류): ' + file.getName() + ' — ' + e); continue; }

    const name = (data.header && data.header.name) || file.getName().replace(/\.json$/i,'');
    const number = (data.header && data.header.number) || '';
    const lang = (data.header && data.header.language) || '';
    const blockKey = number ? (name + ' (' + number + ')') : name;
    const signals = plcCollectOutputSignals_(data);
    const chunks = plcChunk_(raw, PLC_CHUNK_SIZE);

    // 덮어쓰기: 기존 행 제거
    plcRemoveRows_(idx, function(r){ return r[1] === name && r[2] === number; });
    plcRemoveRows_(chk, function(r){ return r[0] === blockKey; });

    // 인덱스 1행
    idx.appendRow([PLC_EQUIPMENT, name, number, lang, signals.join(', '),
                   chunks.length, file.getId(), today]);
    // 청크 N행
    for (let i = 0; i < chunks.length; i++) {
      chk.appendRow([blockKey, i, chunks.length, chunks[i]]);
    }
    Logger.log('적재: ' + blockKey + ' — 신호 ' + signals.length + '개 / 청크 ' + chunks.length + '개');
    count++;
  }
  Logger.log('=== 완료: ' + count + '개 블록 적재 ===');
}

function plcCollectOutputSignals_(data) {
  const seen = {}, out = [];
  const nets = data.logic_networks || [];
  for (let n = 0; n < nets.length; n++) {
    const outs = nets[n].outputs || [];
    for (let o = 0; o < outs.length; o++) {
      const s = outs[o].signal;
      if (s && s !== '?' && !seen[s]) { seen[s] = 1; out.push(s); }
    }
  }
  return out;
}

function plcChunk_(str, size) {
  const arr = [];
  for (let i = 0; i < str.length; i += size) arr.push(str.substring(i, i + size));
  return arr.length ? arr : [''];
}

function plcGetOrCreateSheet_(ss, sheetName, header) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) { sh = ss.insertSheet(sheetName); sh.appendRow(header); }
  else if (sh.getLastRow() === 0) { sh.appendRow(header); }
  return sh;
}

function plcRemoveRows_(sheet, matchFn) {
  const vals = sheet.getDataRange().getValues();
  if (vals.length <= 1) return;
  const header = vals[0];
  const kept = vals.slice(1).filter(function(r){ return !matchFn(r); });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (kept.length) sheet.getRange(2, 1, kept.length, header.length).setValues([kept]);
}


// ════════════════════════════════════════════════════════════════════════════
// ★ v26 추가 블록 — PLC 회로 역추적 4번 탭용 KB 읽기 API (plc_index / plc_block)
//   별도 앱(PLC Agent)이 PLC_Block_Index / PLC_Block_JSON 시트를 읽기 위한 조회 전용 endpoint.
//   인증: 기존 PLC_QUERY_TOKEN (query/trace와 동일). doPost path 분기에서 호출.
//   기존 ingestParsedJson()이 적재한 두 시트를 그대로 읽음 (상수 PLC_KB_SPREADSHEET_ID 등 재사용).
//   배포: doPost가 바뀌므로 ★재배포 필수★ (저장→배포→배포 관리→편집→새 버전→배포)
// ════════════════════════════════════════════════════════════════════════════

/**
 * plc_index — PLC_Block_Index 시트 전체를 블록 목록으로 반환.
 * 요청: { path:"plc_index", token }
 * 응답: { status:"ok", blocks:[{equipment, block_name, block_number, language,
 *          output_signals:[...], total_chunks, block_key, updated_at}] }
 */
function handlePlcIndex(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    if (data.token !== expectedToken) return makeResponse({ status: "error", message: "unauthorized" });

    const ss = SpreadsheetApp.openById(PLC_KB_SPREADSHEET_ID);
    const sh = ss.getSheetByName(PLC_INDEX_SHEET);
    if (!sh || sh.getLastRow() < 2) {
      return makeResponse({ status: "ok", blocks: [] });
    }
    // 헤더: equipment | block_name | block_number | language | output_signals | total_chunks | json_file_id | updated_at
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    const blocks = rows.map(function (r) {
      return {
        equipment: r[0],
        block_name: r[1],
        block_number: r[2],
        language: r[3],
        output_signals: String(r[4] || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
        total_chunks: r[5],
        block_key: r[2] ? (r[1] + " (" + r[2] + ")") : String(r[1]),
        updated_at: r[7],
      };
    });
    return makeResponse({ status: "ok", blocks: blocks });
  } catch (err) {
    return makeResponse({ status: "error", message: err.message });
  }
}

/**
 * plc_block — 한 블록의 청크를 순서대로 이어붙여 파싱본 JSON 반환.
 * 요청: { path:"plc_block", token, data:{ block_key:"DAT_Door (FB200)" } }
 * 응답: { status:"ok", block_key, json:{...} }  /  못 찾으면 status:"not_found"
 */
function handlePlcBlock(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    if (data.token !== expectedToken) return makeResponse({ status: "error", message: "unauthorized" });

    const d = data.data || {};
    const blockKey = String(d.block_key || "").trim();
    if (!blockKey) return makeResponse({ status: "error", message: "block_key required" });

    const ss = SpreadsheetApp.openById(PLC_KB_SPREADSHEET_ID);
    const sh = ss.getSheetByName(PLC_CHUNK_SHEET);
    if (!sh || sh.getLastRow() < 2) return makeResponse({ status: "not_found", block_key: blockKey });

    // 헤더: block_key | chunk_index | total_chunks | json_chunk
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    const mine = rows.filter(function (r) { return String(r[0]) === blockKey; });
    if (mine.length === 0) return makeResponse({ status: "not_found", block_key: blockKey });

    mine.sort(function (a, b) { return Number(a[1]) - Number(b[1]); }); // chunk_index 순
    const raw = mine.map(function (r) { return r[3]; }).join("");

    let json;
    try { json = JSON.parse(raw); }
    catch (e) { return makeResponse({ status: "error", message: "block JSON parse failed: " + e.message }); }

    return makeResponse({ status: "ok", block_key: blockKey, json: json });
  } catch (err) {
    return makeResponse({ status: "error", message: err.message });
  }
}

/** v26 검증용 — 에디터에서 직접 실행 (재배포 없이 동작 확인). */
function testPlcIndex() {
  const token = PropertiesService.getScriptProperties().getProperty("PLC_QUERY_TOKEN");
  const r = handlePlcIndex({ path: "plc_index", token: token });
  Logger.log(r.getContent());
}
function testPlcBlock() {
  const token = PropertiesService.getScriptProperties().getProperty("PLC_QUERY_TOKEN");
  const r = handlePlcBlock({ path: "plc_block", token: token, data: { block_key: "DAT_Door (FB200)" } });
  Logger.log(r.getContent().slice(0, 300));
}


// ════════════════════════════════════════════════════════════════════════════
// ★ v27 추가 블록 — 사진 OCR 백엔드 경유 (plc_ocr)
//   배경: 별도 앱(PLC Agent)이 브라우저에서 api.anthropic.com을 직접 호출하면
//         회사 방화벽/CORS로 "Failed to fetch" 발생. 학습앱 URL은 이미 통하므로
//         OCR도 이 백엔드를 경유시켜 우회 + 프론트에 키 미보관(보안).
//   인증: 기존 PLC_QUERY_TOKEN. 키: 스크립트 속성 ANTHROPIC_API_KEY (query와 동일).
//   Vision: 기존 callClaudeAPI 재사용 (content에 이미지+텍스트 블록 배열 전달).
//   배포: doPost 변경 → ★재배포 필수★
// ════════════════════════════════════════════════════════════════════════════

/**
 * plc_ocr — HMI 알람 사진을 Vision OCR하여 {alarm_code, alarm_name, raw_text} 반환.
 * 요청: { path:"plc_ocr", token, data:{ image_base64, media_type } }
 *   image_base64 : data URL 접두사 없는 순수 base64 문자열
 *   media_type   : "image/jpeg" 등 (없으면 image/jpeg)
 * 응답: { status:"ok", ocr:{ alarm_code, alarm_name, raw_text } }
 */
function handlePlcOcr(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    if (data.token !== expectedToken) return makeResponse({ status: "error", message: "unauthorized" });
    const apiKey = props.getProperty("ANTHROPIC_API_KEY");
    if (!apiKey) return makeResponse({ status: "error", message: "ANTHROPIC_API_KEY not configured" });

    const d = data.data || {};
    const b64 = String(d.image_base64 || "").trim();
    if (!b64) return makeResponse({ status: "error", message: "image_base64 required" });
    const mediaType = d.media_type || "image/jpeg";

    const systemPrompt =
      "You are an OCR assistant for industrial HMI (PLC operator panel) alarm screens. " +
      "Extract the alarm information from the image. " +
      "Respond ONLY with a JSON object, no markdown, no explanation. " +
      'Format: {"alarm_code":"...","alarm_name":"...","raw_text":"..."}. ' +
      "alarm_code: the alarm code/number shown (e.g. E0234, A512). If none visible, use empty string. " +
      "alarm_name: the alarm description/title text. " +
      "raw_text: all readable text on the screen. " +
      "Do NOT translate device codes or alarm names — keep original.";

    const content = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
      { type: "text", text: "Extract the alarm information as JSON." },
    ];

    // 기존 callClaudeAPI 재사용 (content 배열 그대로 전달 → Vision 호출, 재시도 포함)
    const rawText = callClaudeAPI(apiKey, systemPrompt, content);
    const parsed = extractJson(rawText);
    const ocr = parsed
      ? { alarm_code: parsed.alarm_code || "", alarm_name: parsed.alarm_name || "", raw_text: parsed.raw_text || "" }
      : { alarm_code: "", alarm_name: "", raw_text: String(rawText || "") };

    return makeResponse({ status: "ok", ocr: ocr });
  } catch (err) {
    return makeResponse({ status: "error", message: err.message });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * v28 — PLC_Block_Ladder (통합 래더 SVG 저장·조회) + 하이브리드형 매칭 첨부
 *
 * 시트: PLC_Block_Ladder
 *   헤더: block_key | chunk_index | total_chunks | ladder_html
 *   - PLC_Block_JSON과 동일 패턴 (청크 분할 — 50K 셀 한계 대응)
 *
 * 흐름:
 *   1) ingestDatDoorLadder() 1회 실행 — DAT_Door body를 청크 분할 저장
 *   2) handleQuery — detectTraceTrigger의 target 신호 → findBlockByOutputSignal_ → 매칭
 *                    매칭되면 getPlcLadder_로 ladder_html 받아 응답에 첨부
 *   3) handlePlcLadder (path:'plc_ladder') — 4번 탭 "회로 역추적" 카탈로그용
 *                      {block_key} 받아 단일 블록 ladder_html 반환
 *
 * 신규 블록 추가 패턴:
 *   - parsed_json에 새 블록 적재 → ingestParsedJson(폴더ID) 실행 (v26~)
 *   - 클로드가 그 블록 ladder body HTML 생성 → ingestPlcLadder_(ss, blockKey, body) 호출
 * ═══════════════════════════════════════════════════════════════════════════════ */

const LADDER_CHUNK_SIZE = 40000; // 안전 마진 (셀 한계 50K)

// PLC_Block_Index에서 output_signals 컬럼에 signal이 들어있는 첫 블록의 block_key 반환
// signal: detectTraceTrigger의 target (graph 키 — TIA 신호명 그대로)
function findBlockByOutputSignal_(ss, signal) {
  if (!signal) return "";
  const sh = ss.getSheetByName("PLC_Block_Index");
  if (!sh || sh.getLastRow() < 2) return "";
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues(); // equipment, block_name, block_number, language, output_signals
  const sigLow = String(signal).toLowerCase().trim();
  for (var i = 0; i < rng.length; i++) {
    const outs = String(rng[i][4] || "").split(",").map(function(s){return s.trim().toLowerCase();}).filter(function(s){return s.length>0;});
    for (var j = 0; j < outs.length; j++) {
      // 정확 일치 or substring (예: 'moduleinterface.Monitorings.Error' 안에 'Error')
      if (outs[j] === sigLow || outs[j].indexOf(sigLow) >= 0 || sigLow.indexOf(outs[j]) >= 0) {
        return String(rng[i][1]) + " (" + String(rng[i][2]) + ")"; // "DAT_Door (FB200)"
      }
    }
  }
  return "";
}

// PLC_Block_Ladder에서 blockKey의 모든 청크를 합쳐 ladder_html 반환
function getPlcLadder_(ss, blockKey) {
  if (!blockKey) return "";
  const sh = ss.getSheetByName("PLC_Block_Ladder");
  if (!sh || sh.getLastRow() < 2) return "";
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  const chunks = [];
  for (var i = 0; i < rng.length; i++) {
    if (String(rng[i][0]) === blockKey) {
      chunks.push({ idx: Number(rng[i][1]) || 0, html: String(rng[i][3] || "") });
    }
  }
  if (chunks.length === 0) return "";
  chunks.sort(function(a, b){ return a.idx - b.idx; });
  return chunks.map(function(c){ return c.html; }).join("");
}

// PLC_Block_Ladder에 blockKey의 ladder_html을 청크 분할 저장 (기존 같은 키 행 삭제 후 재저장)
function ingestPlcLadder_(ss, blockKey, ladderHtml) {
  if (!blockKey || !ladderHtml) throw new Error("ingestPlcLadder_: blockKey/ladderHtml 누락");
  const sh = plcGetOrCreateSheet_(ss, "PLC_Block_Ladder", ["block_key","chunk_index","total_chunks","ladder_html"]);
  // 기존 같은 key 행 삭제 (아래에서 위로 — 인덱스 안 깨짐)
  if (sh.getLastRow() >= 2) {
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]) === blockKey) sh.deleteRow(i + 2);
    }
  }
  // 청크 분할 + append
  const chunks = [];
  for (var p = 0; p < ladderHtml.length; p += LADDER_CHUNK_SIZE) {
    chunks.push(ladderHtml.substring(p, p + LADDER_CHUNK_SIZE));
  }
  const total = chunks.length;
  const rows = chunks.map(function(c, idx){ return [blockKey, idx, total, c]; });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  Logger.log("[ingestPlcLadder_] " + blockKey + " → " + total + "청크, 총 " + ladderHtml.length + "자");
  return { block_key: blockKey, total_chunks: total, total_chars: ladderHtml.length };
}

// 4번 탭(회로 역추적) 카탈로그용 path 핸들러
// 요청: { secret, path:'plc_ladder', token, data:{ block_key:'DAT_Door (FB200)' } }
// 응답: { status, block_key, ladder_html, total_chars }
function handlePlcLadder(data) {
  try {
    // v29: 토큰 검증 + data.data 패턴 (다른 PLC 핸들러와 일관)
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    if (data.token !== expectedToken) return makeResponse({ status: "error", message: "unauthorized" });

    const d = data.data || {};
    const blockKey = String(d.block_key || "").trim();
    if (!blockKey) return makeResponse({ status: "error", message: "block_key required" });

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const html = getPlcLadder_(ss, blockKey);
    if (!html) return makeResponse({ status: "not_found", block_key: blockKey, ladder_html: "" });
    return makeResponse({
      status: "ok",
      block_key: blockKey,
      ladder_html: html,
      total_chars: html.length,
    });
  } catch (err) {
    return makeResponse({ status: "error", message: err.message });
  }
}

function plcSearchTokens_(query) {
  const KO_EN = {
    "도어": "Door", "도아": "Door", "문": "Door",
    "열림": "Open", "오픈": "Open", "열기": "Open", "열려": "Open",
    "닫힘": "Close", "클로즈": "Close", "닫기": "Close", "닫혀": "Close",
    "에러": "Error", "오류": "Error", "이상": "Error",
    "센서": "Sensor",
    "피드백": "Feedback", "되먹임": "Feedback",
    "명령": "Command", "커맨드": "Command",
    "출력": "Output", "아웃풋": "Output",
    "타이머": "TMR", "지연": "TMR",
    "모니터": "Monitor", "감시": "Monitor",
    "리셋": "Reset",
    "세트": "Set", "셋": "Set",
  };
  const rawTokens = String(query).split(/[\s,;\.]+/).filter(function (t) { return t.length > 0; });
  const tokens = [];
  for (var i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    if (KO_EN[t]) tokens.push(KO_EN[t].toLowerCase());
    else if (t.length >= 2) tokens.push(t.toLowerCase());
  }
  if (query.length >= 3 && tokens.indexOf(query.toLowerCase()) < 0) tokens.push(query.toLowerCase());
  return tokens;
}

function searchSignalIndex_(rows, tokens, filterBlockKey) {
  const seen = {};
  const cands = [];
  for (var r = 0; r < rows.length; r++) {
    const sig = String(rows[r][0] || "");
    if (!sig) continue;
    const blockKey = String(rows[r][1] || "");
    if (filterBlockKey && blockKey !== filterBlockKey) continue;
    const dk = sig + "|" + blockKey;
    if (seen[dk]) continue;
    seen[dk] = 1;
    const sigLow = sig.toLowerCase();
    var score = 0;
    for (var t = 0; t < tokens.length; t++) {
      if (sigLow.indexOf(tokens[t]) >= 0) score++;
    }
    if (score > 0) {
      cands.push({
        signal_name: sig, block_key: blockKey,
        network_id: rows[r][2], network_title: rows[r][3], match_score: score,
      });
    }
  }
  return cands;
}

function llmResolveKeywords_(query, apiKey) {
  try {
    const system = [
      "You convert a Korean maintenance question about a Siemens PLC factory into English search keywords for a PLC signal-name index.",
      'Output ONLY a JSON object: {"keywords":["Door","Close","Error"]}.',
      "Rules:",
      "- Keywords are short English PLC/automation terms likely to appear INSIDE signal names",
      "  (e.g. Door, Open, Close, Error, Sensor, Cylinder, Servo, Feedback, Command, Output, Timer,",
      "   Vacuum, Clamp, Up, Down, Forward, Backward, Home, Pusher, Stopper, Magazine, Heater, Press, Pump).",
      "- Do NOT invent full signal names. Only short keywords or word-stems.",
      "- 3 to 8 keywords. English only. No Korean. No explanation. JSON object only.",
    ].join("\n");
    const raw = callClaudeAPI(apiKey, system, "질문: " + String(query));
    const parsed = extractJson(raw);
    if (parsed && Array.isArray(parsed.keywords)) {
      return parsed.keywords
        .filter(function (k) { return /^[A-Za-z0-9_]+$/.test(String(k)); })
        .slice(0, 8);
    }
  } catch (e) {
    Logger.log("[llmResolveKeywords_] " + e.message);
  }
  return [];
}

/**
 * plc_search (v29) — 4번 탭 자연어 신호 검색 (V1 4단계 합의: C 방식 매칭)
 * 요청: { path:'plc_search', token, data:{ query:"도어 열림 에러", block_key?:"DAT_Door (FB200)" } }
 *   - block_key 지정 시: 그 블록의 output_signals만 후보 풀
 *   - block_key 없으면: 전체 PLC_Block_Index의 모든 신호가 후보 풀
 * 응답: { status:"ok", candidates:[{block_key, block_name, block_number, signal_name, equipment, language, match_score}] }
 *
 * 매칭 원칙 (PLC Agent 규칙 — 추정 없음, 결정론적):
 *   1) 신호명에 query의 토큰이 substring (대소문자 무시) — score = 매칭된 토큰 수
 *   2) 영문 신호명 + 한글 query 매핑 (도어→Door, 열림→Open, 닫힘/닫힘→Close, 에러→Error, 센서→Sensor, 피드백→Feedback, 명령→Command, 출력→Output, 타이머→TMR/Timer)
 *   3) 매칭 점수 내림차순 정렬, 상위 8개 반환
 */
function handlePlcSearch(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    if (data.token !== expectedToken) return makeResponse({ status: "error", message: "unauthorized" });

    const d = data.data || {};
    const query = String(d.query || "").trim();
    if (!query) return makeResponse({ status: "ok", candidates: [] });
    const filterBlockKey = String(d.block_key || "").trim();

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(PLC_SIGIDX_SHEET);
    if (!sh || sh.getLastRow() < 2) return makeResponse({ status: "ok", candidates: [] });
    // PLC_Signal_Index: signal | block_key | network_id | network_title (검색엔 앞 4컬럼)
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();

    // 1차: 고정사전 + 직접 토큰
    const tokens = plcSearchTokens_(query);
    var cands = tokens.length ? searchSignalIndex_(rows, tokens, filterBlockKey) : [];
    var resolvedBy = "dict";
    var llmKeywords = [];

    // 2차(Fork B): 0건 + 한글 포함 + API 키 있을 때만 LLM 키워드 변환 후 재검색
    if (cands.length === 0 && /[가-힣]/.test(query)) {
      const apiKey = props.getProperty("ANTHROPIC_API_KEY");
      if (apiKey) {
        llmKeywords = llmResolveKeywords_(query, apiKey);
        if (llmKeywords.length) {
          const ltokens = llmKeywords
            .map(function (k) { return String(k).toLowerCase(); })
            .filter(function (k) { return k.length >= 2; });
          if (ltokens.length) {
            cands = searchSignalIndex_(rows, ltokens, filterBlockKey);
            resolvedBy = "llm";
          }
        }
      }
    }

    cands.sort(function (a, b) { return b.match_score - a.match_score; });
    return makeResponse({
      status: "ok",
      query: query,
      resolved_by: resolvedBy,
      llm_keywords: llmKeywords,
      candidates: cands.slice(0, 8),
      total_matched: cands.length,
    });
  } catch (err) {
    return makeResponse({ status: "error", message: err.message });
  }
}

// 적재 검증용 — 시트 상태/적재된 블록 키 목록 반환 (Apps Script editor에서 직접 실행)
function testPlcLadder() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("PLC_Block_Ladder");
  if (!sh) { Logger.log("PLC_Block_Ladder 시트 없음 — ingestDatDoorLadder() 먼저 실행하세요"); return; }
  const lr = sh.getLastRow();
  Logger.log("PLC_Block_Ladder: 총 " + (lr - 1) + "행");
  if (lr < 2) return;
  const rng = sh.getRange(2, 1, lr - 1, 4).getValues();
  const byKey = {};
  for (var i = 0; i < rng.length; i++) {
    const k = String(rng[i][0]);
    if (!byKey[k]) byKey[k] = { chunks: 0, chars: 0 };
    byKey[k].chunks++;
    byKey[k].chars += String(rng[i][3] || "").length;
  }
  Object.keys(byKey).forEach(function(k){
    Logger.log("  - " + k + ": " + byKey[k].chunks + "청크, " + byKey[k].chars + "자");
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * DAT_Door 통합 래더 body (1회 적재용)
 *   - V1 HTML의 <body> 내용에서 외피 <style> 제외, 정보 부분(헤더+범례+SVG×4)만 추출
 *   - 적재 후 PLC_Block_Ladder 시트에 영구 저장됨 → 이후 const 제거 가능
 * ═══════════════════════════════════════════════════════════════════════════════ */

const DAT_DOOR_LADDER_BODY = `<h1>DAT_Door — 네트워크별 통합 역추적 래더</h1>
<div class="sub">FB200 · LAD · TIA Openness SimaticML 자동 복원 · 신호 18 / 네트워크 4 · 공통 접점은 한 번만 그리고 실제 분기점에서 갈라짐</div>
<div class="legend">
 <b>─┤ ├─</b> a접점(NO·파랑) &nbsp; <b>─┤/├─</b> b접점(NC·노랑) &nbsp; <b>┌TON┐</b> 타이머(보라) &nbsp;
 <b>[NOT]</b> 반전(분홍) &nbsp; <b>( )</b> 코일(초록 · S세트 / R리셋) <br>
 가로직렬 = AND · 세로분기(수직버스) = 같은 노드에서 갈라지는 실제 분기 · 세로병렬(OR블록) = OR · 접점 위 = 변수 풀네임
</div>
<h2>Network 1 — Door Feedback <span class="cnt">출력 2</span></h2>
<div class="net"><svg viewBox="0 0 832 240" width="832" height="240"><line x1="20" y1="6" x2="20" y2="234" class="rail"/><line x1="20" y1="120" x2="34" y2="120" class="w"/><line x1="808" y1="6" x2="808" y2="234" class="rail"/><line x1="34" y1="68" x2="50" y2="68" class="w"/><line x1="70" y1="42" x2="276" y2="42" class="w"/><line x1="294" y1="42" x2="501" y2="42" class="w"/><line x1="276" y1="26.0" x2="276" y2="58.0" class="bar"/><line x1="294" y1="26.0" x2="294" y2="58.0" class="bar"/><text x="286" y="20.0" class="lbl" text-anchor="middle">Door_Open_Feeback</text><line x1="50" y1="42" x2="70" y2="42" class="w"/><line x1="501" y1="42" x2="521" y2="42" class="w"/><line x1="70" y1="94" x2="134" y2="94" class="w"/><line x1="152" y1="94" x2="216" y2="94" class="w"/><line x1="134" y1="78.0" x2="134" y2="110.0" class="bar"/><line x1="152" y1="78.0" x2="152" y2="110.0" class="bar"/><text x="143" y="72.0" class="lbl" text-anchor="middle">Door_Open_Output</text><line x1="216" y1="94" x2="288" y2="94" class="w"/><line x1="306" y1="94" x2="377" y2="94" class="w"/><line x1="288" y1="78.0" x2="288" y2="110.0" class="bar nc"/><line x1="306" y1="78.0" x2="306" y2="110.0" class="bar nc"/><line x1="288" y1="110.0" x2="306" y2="78.0" class="slash"/><text x="296" y="72.0" class="lbl" text-anchor="middle">Door_Open_Feeback</text><line x1="377" y1="94" x2="430" y2="94" class="w"/><line x1="448" y1="94" x2="501" y2="94" class="w"/><line x1="430" y1="78.0" x2="430" y2="110.0" class="bar"/><line x1="448" y1="78.0" x2="448" y2="110.0" class="bar"/><text x="439" y="72.0" class="lbl" text-anchor="middle">Clock_0.625Hz</text><line x1="50" y1="94" x2="70" y2="94" class="w"/><line x1="501" y1="94" x2="521" y2="94" class="w"/><line x1="50" y1="42" x2="50" y2="94" class="w"/><line x1="521" y1="42" x2="521" y2="94" class="w"/><line x1="50" y1="68" x2="50" y2="68" class="w"/><line x1="521" y1="68" x2="589" y2="68" class="w"/><path d="M 600 68.0 A 15 15 0 0 1 615 53.0" class="coil"/><path d="M 600 68.0 A 15 15 0 0 0 615 83.0" class="coil"/><path d="M 630 68.0 A 15 15 0 0 0 615 53.0" class="coil"/><path d="M 630 68.0 A 15 15 0 0 1 615 83.0" class="coil"/><text x="615" y="47.0" class="lbl out" text-anchor="middle">moduleinterface.Monitorings.Feedback_Open</text><line x1="34" y1="172" x2="50" y2="172" class="w"/><line x1="70" y1="146" x2="288" y2="146" class="w"/><line x1="306" y1="146" x2="523" y2="146" class="w"/><line x1="288" y1="130.0" x2="288" y2="162.0" class="bar"/><line x1="306" y1="130.0" x2="306" y2="162.0" class="bar"/><text x="296" y="124.0" class="lbl" text-anchor="middle">Door_Close_Feedback</text><line x1="50" y1="146" x2="70" y2="146" class="w"/><line x1="523" y1="146" x2="543" y2="146" class="w"/><line x1="70" y1="198" x2="138" y2="198" class="w"/><line x1="156" y1="198" x2="223" y2="198" class="w"/><line x1="138" y1="182.0" x2="138" y2="214.0" class="bar"/><line x1="156" y1="182.0" x2="156" y2="214.0" class="bar"/><text x="146" y="176.0" class="lbl" text-anchor="middle">Door_Close_Output</text><line x1="223" y1="198" x2="302" y2="198" class="w"/><line x1="320" y1="198" x2="399" y2="198" class="w"/><line x1="302" y1="182.0" x2="302" y2="214.0" class="bar nc"/><line x1="320" y1="182.0" x2="320" y2="214.0" class="bar nc"/><line x1="302" y1="214.0" x2="320" y2="182.0" class="slash"/><text x="311" y="176.0" class="lbl" text-anchor="middle">Door_Close_Feedback</text><line x1="399" y1="198" x2="452" y2="198" class="w"/><line x1="470" y1="198" x2="523" y2="198" class="w"/><line x1="452" y1="182.0" x2="452" y2="214.0" class="bar"/><line x1="470" y1="182.0" x2="470" y2="214.0" class="bar"/><text x="461" y="176.0" class="lbl" text-anchor="middle">Clock_0.625Hz</text><line x1="50" y1="198" x2="70" y2="198" class="w"/><line x1="523" y1="198" x2="543" y2="198" class="w"/><line x1="50" y1="146" x2="50" y2="198" class="w"/><line x1="543" y1="146" x2="543" y2="198" class="w"/><line x1="50" y1="172" x2="50" y2="172" class="w"/><line x1="543" y1="172" x2="589" y2="172" class="w"/><path d="M 600 172.0 A 15 15 0 0 1 615 157.0" class="coil"/><path d="M 600 172.0 A 15 15 0 0 0 615 187.0" class="coil"/><path d="M 630 172.0 A 15 15 0 0 0 615 157.0" class="coil"/><path d="M 630 172.0 A 15 15 0 0 1 615 187.0" class="coil"/><text x="615" y="151.0" class="lbl out" text-anchor="middle">moduleinterface.Monitorings.Feedback_Close</text><line x1="34" y1="68" x2="34" y2="172" class="w"/></svg></div>
<h2>Network 2 — Door Commands <span class="cnt">출력 2</span></h2>
<div class="net"><svg viewBox="0 0 942 188" width="942" height="188"><line x1="20" y1="6" x2="20" y2="182" class="rail"/><line x1="20" y1="94" x2="34" y2="94" class="w"/><line x1="918" y1="6" x2="918" y2="182" class="rail"/><line x1="34" y1="42" x2="50" y2="42" class="w"/><line x1="50" y1="42" x2="77" y2="42" class="w"/><line x1="95" y1="42" x2="122" y2="42" class="w"/><line x1="77" y1="26.0" x2="77" y2="58.0" class="bar"/><line x1="95" y1="26.0" x2="95" y2="58.0" class="bar"/><text x="86" y="20.0" class="lbl" text-anchor="middle">Enable</text><line x1="122" y1="42" x2="204" y2="42" class="w"/><line x1="222" y1="42" x2="305" y2="42" class="w"/><line x1="204" y1="26.0" x2="204" y2="58.0" class="bar"/><line x1="222" y1="26.0" x2="222" y2="58.0" class="bar"/><text x="214" y="20.0" class="lbl" text-anchor="middle">enableModuleInterface</text><line x1="305" y1="42" x2="417" y2="42" class="w"/><line x1="435" y1="42" x2="547" y2="42" class="w"/><line x1="417" y1="26.0" x2="417" y2="58.0" class="bar"/><line x1="435" y1="26.0" x2="435" y2="58.0" class="bar"/><text x="426" y="20.0" class="lbl" text-anchor="middle">moduleinterface.Commands.Open</text><line x1="547" y1="42" x2="787" y2="42" class="w"/><path d="M 798 42.0 A 15 15 0 0 1 813 27.0" class="coil"/><path d="M 798 42.0 A 15 15 0 0 0 813 57.0" class="coil"/><path d="M 828 42.0 A 15 15 0 0 0 813 27.0" class="coil"/><path d="M 828 42.0 A 15 15 0 0 1 813 57.0" class="coil"/><text x="813" y="21.0" class="lbl out" text-anchor="middle">Door_Open_Command</text><line x1="34" y1="120" x2="50" y2="120" class="w"/><line x1="70" y1="94" x2="97" y2="94" class="w"/><line x1="115" y1="94" x2="142" y2="94" class="w"/><line x1="97" y1="78.0" x2="97" y2="110.0" class="bar"/><line x1="115" y1="78.0" x2="115" y2="110.0" class="bar"/><text x="106" y="72.0" class="lbl" text-anchor="middle">Enable</text><line x1="142" y1="94" x2="224" y2="94" class="w"/><line x1="242" y1="94" x2="325" y2="94" class="w"/><line x1="224" y1="78.0" x2="224" y2="110.0" class="bar"/><line x1="242" y1="78.0" x2="242" y2="110.0" class="bar"/><text x="234" y="72.0" class="lbl" text-anchor="middle">enableModuleInterface</text><line x1="325" y1="94" x2="441" y2="94" class="w"/><line x1="459" y1="94" x2="575" y2="94" class="w"/><line x1="441" y1="78.0" x2="441" y2="110.0" class="bar"/><line x1="459" y1="78.0" x2="459" y2="110.0" class="bar"/><text x="450" y="72.0" class="lbl" text-anchor="middle">moduleinterface.Commands.Close</text><line x1="50" y1="94" x2="70" y2="94" class="w"/><line x1="575" y1="94" x2="595" y2="94" class="w"/><line x1="70" y1="146" x2="97" y2="146" class="w"/><line x1="115" y1="146" x2="142" y2="146" class="w"/><line x1="97" y1="130.0" x2="97" y2="162.0" class="bar"/><line x1="115" y1="130.0" x2="115" y2="162.0" class="bar"/><text x="106" y="124.0" class="lbl" text-anchor="middle">Enable</text><line x1="142" y1="146" x2="228" y2="146" class="w"/><line x1="246" y1="146" x2="332" y2="146" class="w"/><line x1="228" y1="130.0" x2="228" y2="162.0" class="bar nc"/><line x1="246" y1="130.0" x2="246" y2="162.0" class="bar nc"/><line x1="228" y1="162.0" x2="246" y2="130.0" class="slash"/><text x="237" y="124.0" class="lbl" text-anchor="middle">enableModuleInterface</text><line x1="332" y1="146" x2="575" y2="146" class="w"/><line x1="50" y1="146" x2="70" y2="146" class="w"/><line x1="575" y1="146" x2="595" y2="146" class="w"/><line x1="50" y1="94" x2="50" y2="146" class="w"/><line x1="595" y1="94" x2="595" y2="146" class="w"/><line x1="50" y1="120" x2="50" y2="120" class="w"/><line x1="595" y1="120" x2="659" y2="120" class="w"/><line x1="677" y1="120" x2="741" y2="120" class="w"/><line x1="659" y1="104.0" x2="659" y2="136.0" class="bar nc"/><line x1="677" y1="104.0" x2="677" y2="136.0" class="bar nc"/><line x1="659" y1="136.0" x2="677" y2="104.0" class="slash"/><text x="668" y="98.0" class="lbl" text-anchor="middle">Door_Open_Check</text><line x1="741" y1="120" x2="787" y2="120" class="w"/><path d="M 798 120.0 A 15 15 0 0 1 813 105.0" class="coil"/><path d="M 798 120.0 A 15 15 0 0 0 813 135.0" class="coil"/><path d="M 828 120.0 A 15 15 0 0 0 813 105.0" class="coil"/><path d="M 828 120.0 A 15 15 0 0 1 813 135.0" class="coil"/><text x="813" y="99.0" class="lbl out" text-anchor="middle">Door_Close_Command</text><line x1="34" y1="42" x2="34" y2="120" class="w"/></svg></div>
<h2>Network 3 — Door Output <span class="cnt">출력 4</span></h2>
<div class="net"><svg viewBox="0 0 480 240" width="480" height="240"><line x1="20" y1="6" x2="20" y2="234" class="rail"/><line x1="20" y1="120" x2="34" y2="120" class="w"/><line x1="456" y1="6" x2="456" y2="234" class="rail"/><line x1="34" y1="120" x2="61" y2="120" class="w"/><line x1="79" y1="120" x2="106" y2="120" class="w"/><line x1="61" y1="104.0" x2="61" y2="136.0" class="bar"/><line x1="79" y1="104.0" x2="79" y2="136.0" class="bar"/><text x="70" y="98.0" class="lbl" text-anchor="middle">Enable</text><line x1="106" y1="68" x2="122" y2="68" class="w"/><line x1="122" y1="68" x2="190" y2="68" class="w"/><line x1="208" y1="68" x2="275" y2="68" class="w"/><line x1="190" y1="52.0" x2="190" y2="84.0" class="bar"/><line x1="208" y1="52.0" x2="208" y2="84.0" class="bar"/><text x="198" y="46.0" class="lbl" text-anchor="middle">Door_Open_Command</text><line x1="275" y1="42" x2="291" y2="42" class="w"/><line x1="291" y1="42" x2="329" y2="42" class="w"/><path d="M 340 42.0 A 15 15 0 0 1 355 27.0" class="coil"/><path d="M 340 42.0 A 15 15 0 0 0 355 57.0" class="coil"/><path d="M 370 42.0 A 15 15 0 0 0 355 27.0" class="coil"/><path d="M 370 42.0 A 15 15 0 0 1 355 57.0" class="coil"/><text x="355" y="47.0" class="coilsym" text-anchor="middle">R</text><text x="355" y="21.0" class="lbl out" text-anchor="middle">Door_Close_Output</text><line x1="275" y1="94" x2="291" y2="94" class="w"/><line x1="291" y1="94" x2="329" y2="94" class="w"/><path d="M 340 94.0 A 15 15 0 0 1 355 79.0" class="coil"/><path d="M 340 94.0 A 15 15 0 0 0 355 109.0" class="coil"/><path d="M 370 94.0 A 15 15 0 0 0 355 79.0" class="coil"/><path d="M 370 94.0 A 15 15 0 0 1 355 109.0" class="coil"/><text x="355" y="99.0" class="coilsym" text-anchor="middle">S</text><text x="355" y="73.0" class="lbl out" text-anchor="middle">Door_Open_Output</text><line x1="275" y1="42" x2="275" y2="94" class="w"/><line x1="106" y1="172" x2="122" y2="172" class="w"/><line x1="122" y1="172" x2="194" y2="172" class="w"/><line x1="212" y1="172" x2="283" y2="172" class="w"/><line x1="194" y1="156.0" x2="194" y2="188.0" class="bar"/><line x1="212" y1="156.0" x2="212" y2="188.0" class="bar"/><text x="202" y="150.0" class="lbl" text-anchor="middle">Door_Close_Command</text><line x1="283" y1="146" x2="299" y2="146" class="w"/><line x1="299" y1="146" x2="329" y2="146" class="w"/><path d="M 340 146.0 A 15 15 0 0 1 355 131.0" class="coil"/><path d="M 340 146.0 A 15 15 0 0 0 355 161.0" class="coil"/><path d="M 370 146.0 A 15 15 0 0 0 355 131.0" class="coil"/><path d="M 370 146.0 A 15 15 0 0 1 355 161.0" class="coil"/><text x="355" y="151.0" class="coilsym" text-anchor="middle">R</text><text x="355" y="125.0" class="lbl out" text-anchor="middle">Door_Open_Output</text><line x1="283" y1="198" x2="299" y2="198" class="w"/><line x1="299" y1="198" x2="329" y2="198" class="w"/><path d="M 340 198.0 A 15 15 0 0 1 355 183.0" class="coil"/><path d="M 340 198.0 A 15 15 0 0 0 355 213.0" class="coil"/><path d="M 370 198.0 A 15 15 0 0 0 355 183.0" class="coil"/><path d="M 370 198.0 A 15 15 0 0 1 355 213.0" class="coil"/><text x="355" y="203.0" class="coilsym" text-anchor="middle">S</text><text x="355" y="177.0" class="lbl out" text-anchor="middle">Door_Close_Output</text><line x1="283" y1="146" x2="283" y2="198" class="w"/><line x1="106" y1="68" x2="106" y2="172" class="w"/></svg></div>
<h2>Network 4 — (제목 없음) <span class="cnt">출력 10</span></h2>
<div class="net"><svg viewBox="0 0 1298 552" width="1298" height="552"><line x1="20" y1="6" x2="20" y2="546" class="rail"/><line x1="20" y1="276" x2="34" y2="276" class="w"/><line x1="1274" y1="6" x2="1274" y2="546" class="rail"/><line x1="34" y1="250" x2="50" y2="250" class="w"/><line x1="50" y1="250" x2="114" y2="250" class="w"/><line x1="132" y1="250" x2="196" y2="250" class="w"/><line x1="114" y1="234.0" x2="114" y2="266.0" class="bar"/><line x1="132" y1="234.0" x2="132" y2="266.0" class="bar"/><text x="123" y="228.0" class="lbl" text-anchor="middle">Door_Open_Output</text><line x1="196" y1="68" x2="212" y2="68" class="w"/><line x1="212" y1="68" x2="339" y2="68" class="w"/><line x1="357" y1="68" x2="484" y2="68" class="w"/><line x1="339" y1="52.0" x2="339" y2="84.0" class="bar"/><line x1="357" y1="52.0" x2="357" y2="84.0" class="bar"/><text x="348" y="46.0" class="lbl" text-anchor="middle">moduleinterface.Monitorings.Error</text><line x1="484" y1="68" x2="556" y2="68" class="w"/><line x1="574" y1="68" x2="645" y2="68" class="w"/><line x1="556" y1="52.0" x2="556" y2="84.0" class="bar nc"/><line x1="574" y1="52.0" x2="574" y2="84.0" class="bar nc"/><line x1="556" y1="84.0" x2="574" y2="52.0" class="slash"/><text x="564" y="46.0" class="lbl" text-anchor="middle">Door_Close_Output</text><line x1="645" y1="68" x2="716" y2="68" class="w"/><line x1="734" y1="68" x2="806" y2="68" class="w"/><line x1="716" y1="52.0" x2="716" y2="84.0" class="bar nc"/><line x1="734" y1="52.0" x2="734" y2="84.0" class="bar nc"/><line x1="716" y1="84.0" x2="734" y2="52.0" class="slash"/><text x="726" y="46.0" class="lbl" text-anchor="middle">Door_Open_Feeback</text><line x1="806" y1="42" x2="822" y2="42" class="w"/><line x1="822" y1="42" x2="904" y2="42" class="w"/><line x1="922" y1="42" x2="1005" y2="42" class="w"/><line x1="904" y1="26.0" x2="904" y2="58.0" class="bar"/><line x1="922" y1="26.0" x2="922" y2="58.0" class="bar"/><text x="914" y="20.0" class="lbl" text-anchor="middle">Door_Open_Error_TMR.Q</text><line x1="1005" y1="42" x2="1088" y2="42" class="w"/><path d="M 1099 42.0 A 15 15 0 0 1 1114 27.0" class="coil"/><path d="M 1099 42.0 A 15 15 0 0 0 1114 57.0" class="coil"/><path d="M 1129 42.0 A 15 15 0 0 0 1114 27.0" class="coil"/><path d="M 1129 42.0 A 15 15 0 0 1 1114 57.0" class="coil"/><text x="1114" y="47.0" class="coilsym" text-anchor="middle">S</text><text x="1114" y="21.0" class="lbl out" text-anchor="middle">Door_Open_Error</text><line x1="806" y1="94" x2="822" y2="94" class="w"/><line x1="822" y1="94" x2="1088" y2="94" class="w"/><rect x="1088" y="72" width="150" height="44" rx="5" class="box"/><text x="1163" y="88" class="boxt" text-anchor="middle">TON   t#3s</text><text x="1163" y="103" class="boxs" text-anchor="middle">Door_Open_Error_TMR</text><text x="1163" y="114" class="boxs2" text-anchor="middle">PT=t#3s</text><line x1="806" y1="42" x2="806" y2="94" class="w"/><line x1="196" y1="172" x2="212" y2="172" class="w"/><line x1="212" y1="172" x2="280" y2="172" class="w"/><line x1="298" y1="172" x2="365" y2="172" class="w"/><line x1="280" y1="156.0" x2="280" y2="188.0" class="bar"/><line x1="298" y1="156.0" x2="298" y2="188.0" class="bar"/><text x="288" y="150.0" class="lbl" text-anchor="middle">Door_Close_Output</text><line x1="365" y1="172" x2="444" y2="172" class="w"/><line x1="462" y1="172" x2="541" y2="172" class="w"/><line x1="444" y1="156.0" x2="444" y2="188.0" class="bar nc"/><line x1="462" y1="156.0" x2="462" y2="188.0" class="bar nc"/><line x1="444" y1="188.0" x2="462" y2="156.0" class="slash"/><text x="453" y="150.0" class="lbl" text-anchor="middle">Door_Close_Feedback</text><line x1="541" y1="172" x2="672" y2="172" class="w"/><line x1="690" y1="172" x2="820" y2="172" class="w"/><line x1="672" y1="156.0" x2="672" y2="188.0" class="bar nc"/><line x1="690" y1="156.0" x2="690" y2="188.0" class="bar nc"/><line x1="672" y1="188.0" x2="690" y2="156.0" class="slash"/><text x="680" y="150.0" class="lbl" text-anchor="middle">moduleinterface.Monitorings.Error</text><line x1="820" y1="146" x2="836" y2="146" class="w"/><line x1="836" y1="146" x2="922" y2="146" class="w"/><line x1="940" y1="146" x2="1026" y2="146" class="w"/><line x1="922" y1="130.0" x2="922" y2="162.0" class="bar"/><line x1="940" y1="130.0" x2="940" y2="162.0" class="bar"/><text x="931" y="124.0" class="lbl" text-anchor="middle">Door_Close_Error_TMR.Q</text><line x1="1026" y1="146" x2="1088" y2="146" class="w"/><path d="M 1099 146.0 A 15 15 0 0 1 1114 131.0" class="coil"/><path d="M 1099 146.0 A 15 15 0 0 0 1114 161.0" class="coil"/><path d="M 1129 146.0 A 15 15 0 0 0 1114 131.0" class="coil"/><path d="M 1129 146.0 A 15 15 0 0 1 1114 161.0" class="coil"/><text x="1114" y="151.0" class="coilsym" text-anchor="middle">S</text><text x="1114" y="125.0" class="lbl out" text-anchor="middle">Door_Close_Error</text><line x1="820" y1="198" x2="836" y2="198" class="w"/><line x1="836" y1="198" x2="1088" y2="198" class="w"/><rect x="1088" y="176" width="150" height="44" rx="5" class="box"/><text x="1163" y="192" class="boxt" text-anchor="middle">TON   t#3s</text><text x="1163" y="207" class="boxs" text-anchor="middle">Door_Close_Error_TMR</text><text x="1163" y="218" class="boxs2" text-anchor="middle">PT=t#3s</text><line x1="820" y1="146" x2="820" y2="198" class="w"/><line x1="196" y1="276" x2="212" y2="276" class="w"/><line x1="212" y1="276" x2="284" y2="276" class="w"/><line x1="302" y1="276" x2="373" y2="276" class="w"/><line x1="284" y1="260.0" x2="284" y2="292.0" class="bar nc"/><line x1="302" y1="260.0" x2="302" y2="292.0" class="bar nc"/><line x1="284" y1="292.0" x2="302" y2="260.0" class="slash"/><text x="292" y="254.0" class="lbl" text-anchor="middle">Door_Open_Feeback</text><line x1="373" y1="276" x2="452" y2="276" class="w"/><line x1="470" y1="276" x2="549" y2="276" class="w"/><line x1="452" y1="260.0" x2="452" y2="292.0" class="bar nc"/><line x1="470" y1="260.0" x2="470" y2="292.0" class="bar nc"/><line x1="452" y1="292.0" x2="470" y2="260.0" class="slash"/><text x="461" y="254.0" class="lbl" text-anchor="middle">Door_Close_Feedback</text><line x1="549" y1="276" x2="680" y2="276" class="w"/><line x1="698" y1="276" x2="828" y2="276" class="w"/><line x1="680" y1="260.0" x2="680" y2="292.0" class="bar nc"/><line x1="698" y1="260.0" x2="698" y2="292.0" class="bar nc"/><line x1="680" y1="292.0" x2="698" y2="260.0" class="slash"/><text x="688" y="254.0" class="lbl" text-anchor="middle">moduleinterface.Monitorings.Error</text><line x1="828" y1="250" x2="844" y2="250" class="w"/><line x1="844" y1="250" x2="934" y2="250" class="w"/><line x1="952" y1="250" x2="1042" y2="250" class="w"/><line x1="934" y1="234.0" x2="934" y2="266.0" class="bar"/><line x1="952" y1="234.0" x2="952" y2="266.0" class="bar"/><text x="943" y="228.0" class="lbl" text-anchor="middle">Door_Sensor_Error_TMR.Q</text><line x1="1042" y1="250" x2="1088" y2="250" class="w"/><path d="M 1099 250.0 A 15 15 0 0 1 1114 235.0" class="coil"/><path d="M 1099 250.0 A 15 15 0 0 0 1114 265.0" class="coil"/><path d="M 1129 250.0 A 15 15 0 0 0 1114 235.0" class="coil"/><path d="M 1129 250.0 A 15 15 0 0 1 1114 265.0" class="coil"/><text x="1114" y="255.0" class="coilsym" text-anchor="middle">S</text><text x="1114" y="229.0" class="lbl out" text-anchor="middle">Door_Sensor_Error</text><line x1="828" y1="302" x2="844" y2="302" class="w"/><line x1="844" y1="302" x2="1088" y2="302" class="w"/><rect x="1088" y="280" width="150" height="44" rx="5" class="box"/><text x="1163" y="296" class="boxt" text-anchor="middle">TON   t#3s</text><text x="1163" y="311" class="boxs" text-anchor="middle">Door_Sensor_Error_TMR</text><text x="1163" y="322" class="boxs2" text-anchor="middle">PT=t#3s</text><line x1="828" y1="250" x2="828" y2="302" class="w"/><line x1="196" y1="406" x2="212" y2="406" class="w"/><line x1="212" y1="406" x2="294" y2="406" class="w"/><line x1="312" y1="406" x2="395" y2="406" class="w"/><line x1="294" y1="390.0" x2="294" y2="422.0" class="bar"/><line x1="312" y1="390.0" x2="312" y2="422.0" class="bar"/><text x="304" y="384.0" class="lbl" text-anchor="middle">enableModuleInterface</text><line x1="395" y1="406" x2="440" y2="406" class="w"/><line x1="458" y1="406" x2="504" y2="406" class="w"/><line x1="440" y1="390.0" x2="440" y2="422.0" class="bar"/><line x1="458" y1="390.0" x2="458" y2="422.0" class="bar"/><text x="450" y="384.0" class="lbl" text-anchor="middle">acknowledge</text><line x1="504" y1="354" x2="520" y2="354" class="w"/><line x1="520" y1="354" x2="1088" y2="354" class="w"/><path d="M 1099 354.0 A 15 15 0 0 1 1114 339.0" class="coil"/><path d="M 1099 354.0 A 15 15 0 0 0 1114 369.0" class="coil"/><path d="M 1129 354.0 A 15 15 0 0 0 1114 339.0" class="coil"/><path d="M 1129 354.0 A 15 15 0 0 1 1114 369.0" class="coil"/><text x="1114" y="359.0" class="coilsym" text-anchor="middle">R</text><text x="1114" y="333.0" class="lbl out" text-anchor="middle">Door_Open_Error</text><line x1="504" y1="406" x2="520" y2="406" class="w"/><line x1="520" y1="406" x2="1088" y2="406" class="w"/><path d="M 1099 406.0 A 15 15 0 0 1 1114 391.0" class="coil"/><path d="M 1099 406.0 A 15 15 0 0 0 1114 421.0" class="coil"/><path d="M 1129 406.0 A 15 15 0 0 0 1114 391.0" class="coil"/><path d="M 1129 406.0 A 15 15 0 0 1 1114 421.0" class="coil"/><text x="1114" y="411.0" class="coilsym" text-anchor="middle">R</text><text x="1114" y="385.0" class="lbl out" text-anchor="middle">Door_Close_Error</text><line x1="504" y1="458" x2="520" y2="458" class="w"/><line x1="520" y1="458" x2="1088" y2="458" class="w"/><path d="M 1099 458.0 A 15 15 0 0 1 1114 443.0" class="coil"/><path d="M 1099 458.0 A 15 15 0 0 0 1114 473.0" class="coil"/><path d="M 1129 458.0 A 15 15 0 0 0 1114 443.0" class="coil"/><path d="M 1129 458.0 A 15 15 0 0 1 1114 473.0" class="coil"/><text x="1114" y="463.0" class="coilsym" text-anchor="middle">R</text><text x="1114" y="437.0" class="lbl out" text-anchor="middle">Door_Sensor_Error</text><line x1="504" y1="354" x2="504" y2="458" class="w"/><line x1="196" y1="68" x2="196" y2="406" class="w"/><line x1="34" y1="510" x2="50" y2="510" class="w"/><line x1="50" y1="510" x2="114" y2="510" class="w"/><line x1="132" y1="510" x2="196" y2="510" class="w"/><line x1="114" y1="494.0" x2="114" y2="526.0" class="bar nc"/><line x1="132" y1="494.0" x2="132" y2="526.0" class="bar nc"/><line x1="114" y1="526.0" x2="132" y2="494.0" class="slash"/><text x="123" y="488.0" class="lbl" text-anchor="middle">Door_Open_Error</text><line x1="196" y1="510" x2="264" y2="510" class="w"/><line x1="282" y1="510" x2="349" y2="510" class="w"/><line x1="264" y1="494.0" x2="264" y2="526.0" class="bar nc"/><line x1="282" y1="494.0" x2="282" y2="526.0" class="bar nc"/><line x1="264" y1="526.0" x2="282" y2="494.0" class="slash"/><text x="272" y="488.0" class="lbl" text-anchor="middle">Door_Close_Error</text><line x1="349" y1="510" x2="420" y2="510" class="w"/><line x1="438" y1="510" x2="510" y2="510" class="w"/><line x1="420" y1="494.0" x2="420" y2="526.0" class="bar nc"/><line x1="438" y1="494.0" x2="438" y2="526.0" class="bar nc"/><line x1="420" y1="526.0" x2="438" y2="494.0" class="slash"/><text x="430" y="488.0" class="lbl" text-anchor="middle">Door_Sensor_Error</text><line x1="510" y1="510" x2="518" y2="510" class="w"/><rect x="518" y="497" width="30" height="26" rx="4" class="notbox"/><text x="533" y="514" class="nott" text-anchor="middle">NOT</text><line x1="548" y1="510" x2="562" y2="510" class="w"/><line x1="562" y1="510" x2="1088" y2="510" class="w"/><path d="M 1099 510.0 A 15 15 0 0 1 1114 495.0" class="coil"/><path d="M 1099 510.0 A 15 15 0 0 0 1114 525.0" class="coil"/><path d="M 1129 510.0 A 15 15 0 0 0 1114 495.0" class="coil"/><path d="M 1129 510.0 A 15 15 0 0 1 1114 525.0" class="coil"/><text x="1114" y="489.0" class="lbl out" text-anchor="middle">moduleinterface.Monitorings.Error</text><line x1="34" y1="250" x2="34" y2="510" class="w"/></svg></div>`;

// 1회 실행 — DAT_Door 래더를 시트에 적재. Apps Script editor에서 직접 호출.
function ingestDatDoorLadder() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const result = ingestPlcLadder_(ss, "DAT_Door (FB200)", DAT_DOOR_LADDER_BODY);
  Logger.log("[ingestDatDoorLadder] 완료: " + JSON.stringify(result));
  testPlcLadder();
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * v30 추가분 — 회로 역추적 확장 (신호 역추적 코어 + 알람 진입)
 *   ※ 파일 ID 기입 완료본 (2026-06-08) — 즉시 적재 가능
 *
 * ▣ 적용 방법 (Factory Agent KB 프로젝트)
 *   1) 아래 전체를 v29 .gs 파일 끝에 붙여넣기 (기존 함수 수정 없음, 순수 추가)
 *   2) doPost 라우터에 아래 2줄 추가 (기존 plc_search 줄 바로 아래):
 *        if (data.path === "plc_signal_trace") return handlePlcSignalTrace(data); // v30
 *        if (data.path === "plc_alarm")        return handlePlcAlarmSearch(data); // v30
 *   3) 데이터 적재 (1회, Apps Script 에디터에서 직접 실행 — 배포 불필요):
 *        ingestPlcBlockIndex() → ingestPlcSignalIndex() → ingestPlcAlarmBridge()
 *        → ingestPlcAllLadders(0) … ingestPlcAllLadders(8)  (샤드별 1회씩)
 *   4) 신호/알람 조회 endpoint는 즉시 동작 (조회는 배포 영향 없음).
 *      ※ doPost 라우터 2줄은 코드 변경이므로 반드시 배포 시퀀스 필요:
 *        저장 → 배포 → 배포 관리 → 편집(연필) → 새 버전 → 배포
 *
 * ▣ 새 시트 (plcGetOrCreateSheet_ 가 자동 생성)
 *   PLC_Signal_Index : signal | block_key | network_id | network_title | mode | condition_str
 *   PLC_Alarm_Bridge : member | source_signal | call_name | block_key
 *
 * ▣ 인증: 기존 PLC_QUERY_TOKEN (다른 PLC 핸들러와 동일)
 * ▣ 원칙: KB 확정 사실만. 매칭 약하면 후보를 낮은 score로 표시하되 추정 단정 없음.
 * ═══════════════════════════════════════════════════════════════════════════════ */

const PLC_SIGIDX_SHEET = 'PLC_Signal_Index';
const PLC_ALARM_SHEET  = 'PLC_Alarm_Bridge';

// 스테이징 파일 ID (2026-06-08 기입 완료 — Drive 04_PLC_회로역추적/source)
const SIGIDX_FILE_ID  = '1tRY1ZRHLFqOMhWD6OBLDE8vY84mBjYL3';   // signal_index_v3.json
const ALARM_FILE_ID   = '1h9FJTKISf-LygU4J3NUed9qvsuIsqrFs';   // alarm_bridge.json
const LADDER_FILE_IDS = [                                       // ladders_1..9.json (샤딩, 순서 중요)
  '1WPNQ6EVIMBP6Yk_S2QezHlvClviAiu1b',  // ladders_1.json
  '148IoeCqI7IP_VS9gjn1-4P3VKfOtTjog',  // ladders_2.json
  '1fO36oHzGIikclXLyv9FReIDhXqCti2Ni',  // ladders_3.json
  '1iHOCiV9ChtRf5hNNesfscQJyN0tj5viE',  // ladders_4.json
  '1purTsjXnouj9Na0cGkCHO0w3nZLiWXsx',  // ladders_5.json
  '17a9eMf-EIAu8tGDu42rLka_s4X_-tUCa',  // ladders_6.json
  '1lby1f4sg740OCa10NQlvB627AYLL7LiG',  // ladders_7.json
  '1hzvAMhEqzTo4Qavm0bgDoAE8ZpacQ5fa',  // ladders_8.json
  '13YJd2I1c88OmPIdGAYNTJcidvhQlw4yI',  // ladders_9.json
];

/* ── 신호 역추적: 신호명 → 설정 룽 + 래더 + 입력신호(재귀 후보) ───────────────── */
function handlePlcSignalTrace(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    if (data.token !== expectedToken) return makeResponse({ status: "error", message: "unauthorized" });

    const d = data.data || {};
    const signal = String(d.signal || "").trim();
    if (!signal) return makeResponse({ status: "error", message: "signal required" });
    const wantLadder = d.with_ladder !== false; // 기본 true

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(PLC_SIGIDX_SHEET);
    if (!sh || sh.getLastRow() < 2) return makeResponse({ status: "not_found", signal: signal, locations: [] });

    // signal | block_key | network_id | network_title | mode | condition_str
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
    const sigLow = signal.toLowerCase();
    const exact = [], partial = [];
    for (var r = 0; r < rows.length; r++) {
      const s = String(rows[r][0]);
      if (s === signal) exact.push(rows[r]);
      else if (s.toLowerCase().indexOf(sigLow) >= 0 || sigLow.indexOf(s.toLowerCase()) >= 0) partial.push(rows[r]);
    }
    const hit = exact.length ? exact : partial.slice(0, 12);
    if (!hit.length) return makeResponse({ status: "not_found", signal: signal, locations: [] });

    const locations = [];
    const ladderCache = {};
    for (var i = 0; i < hit.length; i++) {
      const row = hit[i];
      const blockKey = String(row[1]);
      const loc = {
        block_key: blockKey,
        network_id: row[2],
        network_title: row[3],
        mode: row[4],
        condition_str: String(row[5] || ""),
        input_signals: extractSignalTokens_(String(row[5] || "")),
      };
      if (wantLadder && !(blockKey in ladderCache)) {
        ladderCache[blockKey] = getPlcLadder_(ss, blockKey) || "";
      }
      locations.push(loc);
    }
    return makeResponse({
      status: "ok",
      signal: signal,
      match: exact.length ? "exact" : "partial",
      locations: locations,
      ladders: wantLadder ? ladderCache : undefined,
    });
  } catch (err) {
    return makeResponse({ status: "error", message: err.message });
  }
}

/* ── 알람 진입: 알람텍스트 → 알람멤버 매칭 → 원인신호 (→ 신호 역추적 연계) ──────── */
function handlePlcAlarmSearch(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("PLC_QUERY_TOKEN");
    if (!expectedToken) return makeResponse({ status: "error", message: "PLC_QUERY_TOKEN not configured" });
    if (data.token !== expectedToken) return makeResponse({ status: "error", message: "unauthorized" });

    const d = data.data || {};
    const query = String(d.query || "").trim();
    if (!query) return makeResponse({ status: "ok", candidates: [] });

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(PLC_ALARM_SHEET);
    if (!sh || sh.getLastRow() < 2) return makeResponse({ status: "ok", candidates: [] });

    const qtok = alarmNormTokens_(query);
    const qset = {}; qtok.forEach(function (t) { qset[t] = 1; });
    const qIds = (query.match(/\b\d{4,5}\b/g) || []);

    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
    const cands = [];
    for (var r = 0; r < rows.length; r++) {
      const member = String(rows[r][0]);
      const alarmIds = String(rows[r][4] || "").split(",")
                          .map(function (s) { return s.trim(); }).filter(Boolean);
      const alarmTexts = String(rows[r][5] || "").split(" | ")
                          .map(function (s) { return s.trim(); }).filter(Boolean);

      var best = 0, via = "member", matchedId = "", matchedText = "";

      if (qIds.length) {
        for (var qi = 0; qi < qIds.length; qi++) {
          if (alarmIds.indexOf(qIds[qi]) >= 0) { best = 1.0; via = "id"; matchedId = qIds[qi]; break; }
        }
      }
      if (via !== "id" && qtok.length) {
        const ls = jaccardScore_(qset, qtok, alarmNormTokens_(member.split(".").pop()));
        if (ls > best) { best = ls; via = "member"; }
      }
      if (via !== "id" && qtok.length) {
        for (var ti = 0; ti < alarmTexts.length; ti++) {
          const ts = jaccardScore_(qset, qtok, alarmNormTokens_(alarmTexts[ti]));
          if (ts > best) { best = ts; via = "text"; matchedText = alarmTexts[ti]; }
        }
      }

      if (via === "id" || best >= 0.5) {
        cands.push({
          alarm_member: member,
          source_signal: String(rows[r][1] || ""),
          via_call: String(rows[r][2] || ""),
          alarm_block: String(rows[r][3] || ""),
          match_score: Math.round(best * 100) / 100,
          match_via: via,
          matched_alarm_id: matchedId,
          matched_alarm_text: matchedText,
        });
      }
    }
    cands.sort(function (a, b) { return b.match_score - a.match_score; });
    return makeResponse({
      status: "ok",
      query: query,
      candidates: cands.slice(0, 8),
      total_matched: cands.length,
      note: cands.length ? "" : "매칭되는 알람 없음 — 신호명으로 직접 역추적(plc_signal_trace)을 사용하세요.",
    });
  } catch (err) {
    return makeResponse({ status: "error", message: err.message });
  }
}

/* ── 헬퍼: condition_str 에서 입력신호 토큰 추출 (재귀 역추적 후보) ─────────────── */
function extractSignalTokens_(cond) {
  if (!cond) return [];
  // 연산자/키워드/숫자상수 제거 후 신호 식별자만
  const KW = { "AND": 1, "OR": 1, "NOT": 1, "XOR": 1, "TRUE": 1 };
  // 괄호/공백으로 분리하되 점(.)·언더스코어·괄호없는 식별자 보존
  const raw = cond.replace(/[()]/g, " ").split(/\s+/);
  const seen = {}, out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i].trim();
    if (!t || KW[t] || t.charAt(0) === "#") continue;
    if (/^[=≠><≥≤]$/.test(t)) continue;
    // 비교/타이머 표기 정리
    t = t.replace(/^NOT/, "").replace(/^\.+|\.+$/g, "");
    if (t.length < 2 || KW[t]) continue;
    if (!seen[t]) { seen[t] = 1; out.push(t); }
  }
  return out.slice(0, 30);
}

/* ── 헬퍼: 알람 텍스트 정규화 토큰 (한/영, (+)(-) prefix, 비트번호, 주소 suffix 제거) ── */
function alarmNormTokens_(s) {
  s = String(s).toLowerCase();
  s = s.replace(/^\s*\([-+]\)\s*/, "");
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/_\(.*?\)$/, "");
  s = s.replace(/[^a-z0-9 ]/g, " ");
  return s.split(/\s+/).filter(function (t) { return t.length >= 2; });
}

/* ── 적재: signal_index_v3.json → PLC_Signal_Index ──────────────────────────────
 *   JSON 형식: { "<signal>": [ {block, block_key, network_id, network_title, mode, condition_str}, ... ], ... }
 *   대용량(수천 행) — setValues 배치로 1회 기록. */
function ingestPlcSignalIndex() {
  if (!SIGIDX_FILE_ID) { Logger.log("SIGIDX_FILE_ID 미설정"); return; }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = plcGetOrCreateSheet_(ss, PLC_SIGIDX_SHEET,
    ["signal", "block_key", "network_id", "network_title", "mode", "condition_str"]);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).clearContent();
  const json = JSON.parse(DriveApp.getFileById(SIGIDX_FILE_ID).getBlob().getDataAsString());
  const out = [];
  Object.keys(json).forEach(function (sig) {
    json[sig].forEach(function (loc) {
      out.push([sig, loc.block_key || loc.block || "", loc.network_id || "",
                loc.network_title || "", loc.mode || "", String(loc.condition_str || "").slice(0, 5000)]);
    });
  });
  // 배치 기록 (5000행 단위)
  for (var i = 0; i < out.length; i += 5000) {
    const batch = out.slice(i, i + 5000);
    sh.getRange(2 + i, 1, batch.length, 6).setValues(batch);
  }
  Logger.log("[ingestPlcSignalIndex] " + out.length + "행 적재");
}

/* ── 적재: alarm_bridge.json → PLC_Alarm_Bridge ─────────────────────────────────
 *   JSON 형식: { "<member>": {source, call, block}, ... } */
function ingestPlcAlarmBridge() {
  if (!ALARM_FILE_ID) { Logger.log("ALARM_FILE_ID 미설정"); return; }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const HEADER = ["member", "source_signal", "call_name", "block_key", "alarm_ids", "alarm_texts"];
  const sh = plcGetOrCreateSheet_(ss, PLC_ALARM_SHEET, HEADER);
  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  if (sh.getLastRow() > 1) {
    const wipeCols = Math.max(sh.getLastColumn(), HEADER.length);
    sh.getRange(2, 1, sh.getLastRow() - 1, wipeCols).clearContent();
  }
  const json = JSON.parse(DriveApp.getFileById(ALARM_FILE_ID).getBlob().getDataAsString());
  const out = [];
  Object.keys(json).forEach(function (m) {
    const v = json[m] || {};
    const alarms = Array.isArray(v.alarms) ? v.alarms : [];
    const ids = alarms.map(function (a) { return a && a.id; })
                      .filter(function (x) { return x; }).join(",");
    var texts = alarms.map(function (a) { return a && a.text; })
                      .filter(function (x) { return x; }).join(" | ");
    if (texts.length > 20000) texts = texts.slice(0, 20000);
    out.push([m, v.source || "", v.call || "", v.block || "", ids, texts]);
  });
  for (var i = 0; i < out.length; i += 5000) {
    const batch = out.slice(i, i + 5000);
    sh.getRange(2 + i, 1, batch.length, 6).setValues(batch);
  }
  const withAlarms = out.filter(function (r) { return r[4]; }).length;
  Logger.log("[ingestPlcAlarmBridge] " + out.length + "행 적재 (알람 붙은 멤버 " + withAlarms + ")");
}

/* ── 적재: ladders_*.json 샤드들 → PLC_Block_Ladder (기존 ingestPlcLadder_ 재사용)
 *   각 샤드 JSON 형식: { "<block_key>": "<ladder_html>", ... }
 *   ※ 샤드별로 따로 실행 권장(6분 한계). LADDER_FILE_IDS 의 인덱스를 인자로 받음. */
function ingestPlcAllLadders(shardIndex) {
  if (!LADDER_FILE_IDS.length) { Logger.log("LADDER_FILE_IDS 미설정"); return; }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const start = (typeof shardIndex === "number") ? shardIndex : 0;
  const end = (typeof shardIndex === "number") ? shardIndex + 1 : LADDER_FILE_IDS.length;
  var total = 0;
  for (var s = start; s < end; s++) {
    const json = JSON.parse(DriveApp.getFileById(LADDER_FILE_IDS[s]).getBlob().getDataAsString());
    Object.keys(json).forEach(function (blockKey) {
      ingestPlcLadder_(ss, blockKey, json[blockKey]);
      total++;
    });
    Logger.log("[ingestPlcAllLadders] 샤드 " + s + " 완료");
  }
  Logger.log("[ingestPlcAllLadders] 총 " + total + "블록 적재 (샤드 " + start + "~" + (end - 1) + ")");
}

/* ── 검증용 (에디터에서 직접 실행) ─────────────────────────────────────────────── */
function testPlcSignalTrace() {
  const token = PropertiesService.getScriptProperties().getProperty("PLC_QUERY_TOKEN");
  const r = handlePlcSignalTrace({ path: "plc_signal_trace", token: token,
    data: { signal: "Door_Open_Error", with_ladder: false } });
  Logger.log(r.getContent());
}
function testPlcAlarmSearch() {
  const token = PropertiesService.getScriptProperties().getProperty("PLC_QUERY_TOKEN");
  const r = handlePlcAlarmSearch({ path: "plc_alarm", token: token,
    data: { query: "Press PnP Y Servo Total Fault" } });
  Logger.log(r.getContent());
}

/* ── 적재: block_index.json → PLC_Block_Index (카탈로그/드롭다운용 메타데이터) ─────
 *   JSON 형식: [ {equipment, block_name, block_number, language, n_outputs}, ... ]
 *   ※ output_signals 컬럼은 비움(신호검색은 plc_signal_trace 사용 — 50K 셀 한계 회피).
 *   헤더는 v29 plc_search 와 호환: equipment|block_name|block_number|language|output_signals|total_chunks|json_file_id|updated_at */
const BLOCKIDX_FILE_ID = '1_jogfbameMtjJqGpIw4L6sk4gjGXvTMU';   // block_index.json

function ingestPlcBlockIndex() {
  if (!BLOCKIDX_FILE_ID) { Logger.log("BLOCKIDX_FILE_ID 미설정"); return; }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = plcGetOrCreateSheet_(ss, PLC_INDEX_SHEET,
    ["equipment","block_name","block_number","language","output_signals","total_chunks","json_file_id","updated_at"]);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 8).clearContent();
  const json = JSON.parse(DriveApp.getFileById(BLOCKIDX_FILE_ID).getBlob().getDataAsString());
  const now = new Date().toISOString();
  const out = json.map(function (r) {
    return [r.equipment || "", r.block_name || "", r.block_number || "", r.language || "",
            "", r.n_outputs || "", "", now];
  });
  for (var i = 0; i < out.length; i += 5000) {
    const batch = out.slice(i, i + 5000);
    sh.getRange(2 + i, 1, batch.length, 8).setValues(batch);
  }
  Logger.log("[ingestPlcBlockIndex] " + out.length + "행 적재");
}

function jaccardScore_(qset, qtok, mtok) {
  if (!mtok || !mtok.length || !qtok || !qtok.length) return 0;
  var inter = 0, uni = {};
  for (var i = 0; i < qtok.length; i++) uni[qtok[i]] = 1;
  for (var j = 0; j < mtok.length; j++) {
    if (qset[mtok[j]]) inter++;
    uni[mtok[j]] = 1;
  }
  return inter / Object.keys(uni).length;
}

function testForkB(){
  const token=PropertiesService.getScriptProperties().getProperty("PLC_QUERY_TOKEN");
  Logger.log(handlePlcSearch({token:token,data:{query:"문이 안 닫혀요"}}).getContent());
}
