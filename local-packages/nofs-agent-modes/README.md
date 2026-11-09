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

## 서브에이전트 모드

`@mjakl/pi-subagent`가 상속하는 환경변수를 이용하므로 runner 수정이나 부모 대화 복사가 필요 없다.

- 세션 시작과 Shift+Tab 전환 시 `PI_AGENT_MODE`에 현재 모드를 기록한다.
- 자식은 `PI_SUBAGENT_DEPTH`와 `PI_SUBAGENT_STACK`의 마지막 역할을 확인한다. `worker`는 부모 모드를 계승하고, `explore`·`reviewer` 및 그 밖의 역할은 PLAN으로 시작한다.
- 자식 전달값이 누락되거나 잘못되면 PLAN으로 시작한다. 일반 부모 세션은 환경변수 대신 기존 세션 기록을 복원한다.
- 지속 자식 세션을 다시 호출해도 이번 부모 모드를 새 `agent-mode` 항목으로 기록한다. 과거 메시지의 모드 표시는 바꾸지 않는다.
- 실행 중인 자식의 모드는 시작 시점의 값이다. 부모의 이후 모드 전환은 이미 실행 중인 자식에게 실시간 전달되지 않는다.
- 변경 후 기존 부모 세션에서는 `/reload`가 필요하다. 모드는 여전히 지침이며 도구 차단 장치는 아니다.

검증: `node --experimental-strip-types --test local-packages/nofs-agent-modes/index.test.ts`
