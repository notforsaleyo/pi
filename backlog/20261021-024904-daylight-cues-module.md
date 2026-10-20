---
title: "DAYLIGHT cues 모듈 (narrative가 게시하고 Things가 조회하는 Cue) 별도 change"
status: open
created: 2026-10-21
updated: 2026-10-21
---

## 대화 배경
DAYLIGHT(Godot) 프로젝트의 actis 탐색(OpenSpec change `actis-and-touch`, 처음 이름은 `actis-and-cues`) 중 나온 후속 작업입니다.
처음에는 actis와 한 change로 탐색했지만, 사용자 결정으로 actis를 먼저 만들고 cues는 별도 change로 나중에 만듭니다. 두 모듈의 연결(Thing의 `can_undergo` 안에서 Cue 조회)은 둘 다 만든 뒤에 합니다.

## 기억할 내용
- 위치 `src/Tools/cues/`. `Cue`(Resource) 클래스 하나만 두고 autoload 보드는 두지 않습니다.
- 개별 Cue는 Things가 `.tres`로 정의하고, Hubs(narrative)가 그 Cue에 람다(Callable)를 게시합니다. Cue는 값을 저장하지 않습니다. 문자열 키는 기각.
- API 가안: `publish(f)`, `ask()`, `listen(callback)`(등록 즉시 한 번 실행), `notify()`(narrative가 직접 호출).
- 제안 기본값(명시적 확정 아님): 값이 같으면 콜백 생략, 게시 안 된 Cue는 false, 람다는 계산만, 호출 전 `is_valid()` 확인, 값은 bool만.
- 자세한 결정, 근거, 미결 사항(값 타입, 리스너 해제, 이중 publish, 재진입, 영역 경계 규칙과 영구 ADR 여부), 검증 항목은 탐색 기록 4장에 있습니다.

## 현재 결론과 미정 사항
- 확정: actis 다음에 별도 change로 진행합니다.
- 미정: 탐색 기록 4.3의 질문들.

## 다음에 이어갈 지점
actis change가 끝나면 탐색 기록 4장을 입력으로 cues change의 탐색을 이어 갑니다.

## 참고
- 프로젝트: DAYLIGHT. 탐색 기록은 `openspec/changes/actis-and-touch/exploration.md` (보관된 뒤에는 archive 쪽).

## 완료 기록
