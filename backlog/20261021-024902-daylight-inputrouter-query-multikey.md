---
title: "DAYLIGHT InputRouter 수신 쿼리를 키가 여러 개 묶인 액션으로 넓히기 (필요할 때만)"
created: 2026-10-21
updated: 2026-10-21
---

## Background
DAYLIGHT(Godot) 프로젝트의 actis 탐색(OpenSpec change `actis-and-touch`, 처음 이름은 `actis-and-cues`) 중 나온 후속 작업입니다.
actis change에서 InputRouter에 "이 액션의 키를 지금 누르면 이 리시버가 받는가"를 묻는 공개 쿼리를 추가합니다(가칭 `would_receive(receiver, action)`).

## What to remember
- 사용자 결정: 이 쿼리에 넘기는 액션은 키가 하나만 묶여 있어야 하며, 둘 이상이면 디버그 assert로 멈춥니다. 키 재설정은 키를 바꾸기만 하고 추가하지 않을 예정입니다.
- 이 규칙은 쿼리에만 적용됩니다. 키가 여럿 묶인 액션(예: 인벤토리 닫기 Tab/ESC)은 일반 라우팅으로 계속 동작합니다.
- 넓힐 때의 정의(에이전트 제안, 사용자가 승인): 묶인 키 중 하나라도 그 리시버로 가면 참. 누르면 실제로 반응하는 키가 하나라도 있으면 힌트가 뜨는 쪽이 플레이어에게 거짓말을 하지 않습니다.

## Current conclusions and open questions
- 필요한 경우에만 구현합니다. 지금은 계획 없음.

## Where to pick up
키가 여러 개 묶인 액션에 이 쿼리가 필요해지면(assert가 걸리면) 위 정의로 넓힙니다.

## References
- 프로젝트: DAYLIGHT. 탐색 기록은 `openspec/changes/actis-and-touch/exploration.md` (보관된 뒤에는 archive 쪽).
