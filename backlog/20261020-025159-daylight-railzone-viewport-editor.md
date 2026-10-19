---
title: "DAYLIGHT 레일 에디터: RailZone 레일 목록을 뷰포트에서 클릭으로 편집하는 도구"
status: open
created: 2026-10-20
updated: 2026-10-20
---

## 대화 배경
DAYLIGHT(Godot) 프로젝트의 OpenSpec change `actis-and-cues` 탐색 중 나온 후속 작업입니다. Len의 "만지기" 동사가 닿는 범위를 거리 대신 "그 대상을 만질 수 있는 레일의 목록"으로 정했고, 이 목록을 갖는 레일 부착물로 `world/rail` 모듈에 `@abstract RailZone`(레일 목록)과 `RailReach extends RailZone`(레일 목록 + 닿는 acti)을 두기로 했습니다.

## 기억할 내용
- 사용자 결정: actis-and-cues에서는 레일 목록을 인스펙터로 입력하고, 이 change가 끝나면 바로 뷰포트 편집 도구를 만듭니다.
- 사용자 결정: 데이터 형식은 처음부터 이 도구와 맞춰 두어 나중에 데이터를 옮길 일이 없게 합니다.
- 도구 구상(에이전트 제안, 사용자가 이 방향을 고름): 부착물 노드를 선택하면 그 방의 레일이 그려지고, 레일을 클릭해 목록에 넣거나 뺍니다. 되돌리기를 지원하고, 다른 부착물의 목록을 흐린 색으로 함께 그려 겹침(두 대상을 모두 만질 수 있는 구간)을 보여 줍니다.
- 도구는 만지기 전용이 아니라 `RailZone` 범용으로 만듭니다. 미래의 "레일 진입 이벤트"도 RailZone의 하위 클래스가 될 예정입니다.

## 현재 결론과 미정 사항
- 확정: 인스펙터로 시작하고, change 직후 뷰포트 도구를 만듭니다.
- 제안(명시적 확정 아님): 각 레일을 RailLink처럼 끝점 두 개의 NodePath 쌍으로 저장합니다.
- 미정: 기존 `addons/rail_graph_editor/` 플러그인을 확장할지, 별도 플러그인으로 만들지.

## 다음에 이어갈 지점
actis-and-cues가 끝나면 OpenSpec change로 시작합니다. 시작 전에 actis-and-cues에서 최종 확정된 RailZone의 저장 형식을 확인합니다.

## 참고
- 프로젝트: DAYLIGHT. 탐색 기록은 `openspec/changes/actis-and-cues/exploration.md` (보관된 뒤에는 archive 쪽).

## 완료 기록
