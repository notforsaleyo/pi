# nofs-agent-modes

Shift+Tab 으로 도는 에이전트 모드: PLAN → SPEC → BASH.

모드 이름 `BASH` 는 "구현/실행" 모드의 라벨일 뿐, `bash` 도구나 bash 셸과 무관하다. 이 환경의 셸 도구는 `powershell` 이다.

모드는 **사용자 의도의 표현**이다. 도구 차단/명령어 필터는 없고, 에이전트가 프롬프트를 보고 스스로 판단한다. 안전장치는 이 확장 바깥에서 따로 둔다.

| 모드 | 의도 |
|---|---|
| PLAN | 생각과 계획만. 순수 읽기(powershell 포함)는 에이전트 판단으로 수행. 문서 작성은 SPEC, 구현·실행은 BASH로 전환 |
| SPEC | PLAN + `./openspec/`의 계획·명세 산출물과 `./docs/`의 문서 편집. 코드·설정·schema·스킬·하네스 지침 변경은 경로와 무관하게 BASH에서 수행 |
| BASH | 구현/실행 전부. "ㄱㄱ" = 지금까지의 계획을 실행 |

- 시스템 프롬프트(`agent_modes` 섹션)는 고정, 현재 모드는 매 요청 끝 `<system-reminder>` 로만 알린다 (프롬프트 캐시 보존).
- 입력창 색/라벨은 `globalThis.__piAgentMode` 를 통해 `../nofs-theme/input-box.ts` 가 그린다.
- `@mjakl/pi-subagent`의 자식 프로세스(`PI_SUBAGENT_DEPTH > 0`)에서는 이 확장을 초기화하지 않는다. 모드 규칙·reminder·단축키를 추가하지 않으며, `AGENTS.md`·역할 지침·허용 도구 설정은 그대로 적용된다.
- 새 컨텍스트(`initialContext: "empty"`) 기준이다. 부모 이력을 복사하거나 기존 자식 세션을 이어 쓰면 과거 모드 내용이 남을 수 있으며, 이 확장은 그 내용을 제거하지 않는다.

검증: `node --experimental-strip-types --test local-packages/nofs-agent-modes/index.test.ts`
