---
title: "DAYLIGHT 만지기 힌트 UI 형태: 반짝이는 점이 멈추면 이름 목록으로 펼쳐짐"
created: 2026-10-20
updated: 2026-10-23
---

## Background
DAYLIGHT(Godot) 프로젝트의 actis 탐색(OpenSpec change `actis-and-touch`, 처음 이름은 `actis-and-cues`) 중, Len의 "만지기" 대상 선택 방식을 정하다가 사용자가 낸 UI 아이디어입니다. 시각적 형태는 actis change의 범위 밖입니다.

## What to remember
사용자 아이디어:
- 현재 레일에 만질 수 있는 대상이 하나 이상 있으면 Len의 우측 상단에 반짝이는 점이 뜹니다.
- Len이 멈추면 점이 펼쳐지면서 대상들의 이름이 한 글자씩 쓰입니다. 대상이 하나여도 같습니다.
- `game_up`/`game_down` 누름으로 대상을 고르고, `game_ok`(현재 space) 누름으로 발동합니다.
- Len이 움직이면 글자가 한 글자씩 사라지며 다시 점이 됩니다.

## Current conclusions and open questions
actis 탐색에서 확정한 동작 규칙(사용자 결정):
- Len이 `game_ok`를 받을 수 없는 상태(지금 누르면 Len의 리시버로 가지 않음, 예: 일시정지 메뉴가 열림)에서는 점도 목록도 뜨지 않습니다. 경로 이동 중인지는 따지지 않습니다.
- 멈춰 있을 때만 목록이 열리고 선택할 수 있습니다. 움직이면 닫히고 선택도 사라집니다. 움직이는 중의 `game_ok`는 아무 일도 하지 않습니다.
- 발동과 선택은 실제 누름에서만 일어납니다. 다른 리시버가 닫히며 눌린 키의 소유권이 넘어온 것은 누름이 아닙니다.
- 목록 순서는 레일 조회가 보고하는 순서이며, 프레임마다 바뀌거나 무작위가 아니면 됩니다. 처음 선택은 첫 항목, 선택된 대상이 목록에서 빠지면 첫 항목으로 갑니다.
- `game_up`은 이전 항목, `game_down`은 다음 항목입니다. 목록 끝에서 순환하지 않습니다.
- 목록이 열린 채 `game_ok`를 받을 수 없게 되면(예: 일시정지) 목록이 닫히고 선택도 사라집니다. 사용자가 감수하기로 했습니다.
- 힌트 UI는 입력을 받지 않고 표시만 합니다. `game_up`/`game_down`/`game_ok`는 Len의 리시버가 소유합니다.
- actis change에서는 `LenToucher`가 상태(점 표시 여부, 목록 열림, 후보, 선택)만 공개하고 데모가 대충 그립니다. `ui` 모듈은 만들지 않으므로, 그 change 직후 실제 게임 화면에는 힌트가 없습니다.

미정:
- "멈춤"의 정의(좌우 키를 누르지 않음 / idle 동작 중)는 actis 데모에서 비교해 정합니다.
- 대상의 표시 이름을 어디서 얻을지(acti마다 이름을 갖게 할지) 설계하지 않았습니다.
- MasterSchema는 "actis가 ui(acti_hint)를 통해 UI를 보인다"고 적었지만, 실제로는 힌트 상태를 Things의 `LenToucher`가 공개하고 `actis`는 UI에 의존하지 않습니다(ADR 0004는 개정되어 더 이상 이 내용을 담지 않음). MasterSchema(`DAYLIGHT-docs/`)는 에이전트가 고치지 않으므로, 이 change에서 사용자와 맞춥니다.

## Where to pick up
actis change 이후, 힌트 UI(MasterSchema의 `ui/acti_hint`)를 만드는 change에서 이 형태를 기획 입력으로 쓰고, `LenToucher`가 공개하는 상태를 읽어 그립니다.

## References
- 프로젝트: DAYLIGHT. 탐색 기록은 `openspec/changes/archive/2026-10-22-actis-and-touch/exploration.md` 3.10~3.12, 3.16절과 7장, 같은 폴더 design.md의 Open Questions.
