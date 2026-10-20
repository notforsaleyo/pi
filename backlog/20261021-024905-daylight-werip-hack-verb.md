---
title: "DAYLIGHT werip 해킹 동사 (2D collision 기반) 별도 change"
status: open
created: 2026-10-21
updated: 2026-10-21
---

## 대화 배경
DAYLIGHT(Godot) 프로젝트의 actis 탐색(OpenSpec change `actis-and-touch`, 처음 이름은 `actis-and-cues`) 중 나온 후속 작업입니다.
actis change에서는 만지기 동사만 구현하고, 범용 틀(Tools의 `Acti`, `Verb`)을 만듭니다.

## 기억할 내용
- 사용자 결정: 해킹은 werip(설정상 주인공의 휴대폰)만 일으키며, 닿는 범위는 2D collision으로 판정합니다(만지기의 레일 목록과 다름).
- 구조 규칙: 닿는가(거리·위치)는 일으키는 쪽 전달 로직이, 받아들이는가는 대상 acti의 `can_undergo(invoker, verb)`가 판단합니다. 본문은 `undergo(invoker, verb)`입니다.
- 동사 위치 정보의 형태와 그 노드를 둘 곳은 그 동사가 정합니다. 해킹용 collision 노드를 대상 acti 아래에 둘지 등은 이 change에서 정합니다.
- 동사는 `Verb`(Tools)의 하위 클래스로 `src/Things/verbs/`에 둡니다(예: `Hack`). 발동마다 `Hack.new(...)`로 객체를 만들어 넘기므로 발동별 데이터를 담을 수 있습니다.
- werip 쪽은 Len의 `LenActi`(받는 쪽) / `LenToucher`(일으키는 쪽)과 같은 모양으로 일으키는 노드를 따로 둡니다.

## 현재 결론과 미정 사항
- 미정: 해킹 대상 선택 방식(만지기처럼 목록이 아님: 다른 동사는 한 번에 후보가 둘 이상 생기지 않는다는 사용자 판단), collision 노드 위치, 해킹의 입력.

## 다음에 이어갈 지점
actis change 이후 별도 change로 탐색합니다.

## 참고
- 프로젝트: DAYLIGHT. 탐색 기록은 `openspec/changes/actis-and-touch/exploration.md` (보관된 뒤에는 archive 쪽).

## 완료 기록
