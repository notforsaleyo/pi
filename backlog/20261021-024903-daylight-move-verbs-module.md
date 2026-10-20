---
title: "DAYLIGHT Things/verbs 모듈을 acti 관련 상위 모듈 아래로 옮기기"
status: open
created: 2026-10-21
updated: 2026-10-21
---

## 대화 배경
DAYLIGHT(Godot) 프로젝트의 actis 탐색(OpenSpec change `actis-and-touch`, 처음 이름은 `actis-and-cues`) 중 나온 후속 작업입니다.
동사 클래스(`Verb`의 하위 클래스, 예: `Touch`)를 둘 곳으로 `src/Things/verbs/`를 최상위 모듈로 정했습니다.

## 기억할 내용
- 사용자 의견: 동사는 Things 영역의 acti 관련 상위 모듈의 하위 모듈이 되는 편이 좋다. 다만 그 상위 모듈에 무엇이 들어갈지 아직 몰라서 일단 최상위에 둡니다.
- 옮기는 비용은 작습니다. 동사는 `class_name`으로 참조되고(경로 아님), 씬에 붙지 않으며(RefCounted), assets가 없습니다. `.gd`/`.uid` 이동과 경로를 적은 문서 수정 정도입니다.
- 상위 모듈 후보 내용: 해킹용 2D collision 노드 등 동사가 정의하는 위치 정보 노드(아직 미설계).

## 현재 결론과 미정 사항
- 미정: 상위 모듈의 이름과 범위. 모듈 이동은 그때 소유자 결정이 필요합니다(ADR 0004).

## 다음에 이어갈 지점
acti 관련 Things 모듈이 늘어나는 시점(예: 해킹 change)에 상위 모듈을 정하고 `verbs`를 그 아래로 옮길지 결정합니다.

## 참고
- 프로젝트: DAYLIGHT. 탐색 기록은 `openspec/changes/actis-and-touch/exploration.md` (보관된 뒤에는 archive 쪽).

## 완료 기록
