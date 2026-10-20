---
title: "DAYLIGHT 만지기 후보 조회를 매 프레임 폴링에서 알림 방식으로 교체"
status: open
created: 2026-10-21
updated: 2026-10-21
---

## 대화 배경
DAYLIGHT(Godot) 프로젝트의 actis 탐색(OpenSpec change `actis-and-touch`, 처음 이름은 `actis-and-cues`) 중 나온 후속 작업입니다.
actis change에서는 Len의 만지기 로직(`LenToucher`)이 매 프레임 후보를 조회합니다(현재 레일 -> RailGraph의 RailReach -> 각 acti의 `can_undergo`, 그리고 InputRouter에 "지금 game_ok를 누르면 Len이 받는가" 질의).

## 기억할 내용
- 사용자 결정: 이번에는 간단히 폴링으로 가지만, 나중에 알림 방식으로 반드시 교체합니다.
- actis 설계에서 "후보를 얻는 곳"을 LenToucher 안의 한 곳으로 모아, 교체 시 목록·선택·발동 코드는 건드리지 않게 합니다.
- 레일 쪽: RailZone 진입/이탈 알림이 필요합니다. 미래의 "레일 진입 이벤트" RailZone 하위 클래스와 함께 설계할 수 있습니다.
- 에이전트 지적: 레일 진입/이탈 알림만으로는 "Len이 가만히 서 있는데 대상이 받아들이기 시작함"(cues 연결 후)을 놓칩니다. 수용 상태 변화도 알림이 필요합니다(예: cues의 listen).
- InputRouter 쪽(필요한 경우에만 구현): 새 수신 쿼리의 답은 리시버 등록/해제 때만 바뀌므로(원하는 키와 우선순위는 등록 시 고정), "등록 목록이 바뀌었다" 시그널 하나로 폴링을 대체할 수 있습니다.

## 현재 결론과 미정 사항
- 확정: 교체는 반드시 합니다. 시점은 미정입니다.
- 미정: 레일 쪽 알림의 형태, 수용 상태 변화 알림을 cues로 할지.

## 다음에 이어갈 지점
actis change와 cues change가 끝난 뒤, 또는 레일 진입 이벤트를 만들 때 함께 설계합니다.

## 참고
- 프로젝트: DAYLIGHT. 탐색 기록은 `openspec/changes/actis-and-touch/exploration.md` (보관된 뒤에는 archive 쪽).

## 완료 기록
