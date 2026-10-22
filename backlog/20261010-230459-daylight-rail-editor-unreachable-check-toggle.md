---
title: "DAYLIGHT 레일 에디터: 도달 불가 후보 검사를 끄는 토글 버튼"
created: 2026-10-10
updated: 2026-10-10
---

## Background
DAYLIGHT(Godot) 레일 그래프 에디터 플러그인은 갈림길의 "어떤 의도로도 갈 수 없는 후보(unreachable)"를 에디터에서 계속 계산해 빨간색으로 표시한다. 이 계산을 최적화하기보다 필요 없을 때 끄는 방향으로 정리했다.

## What to remember
- 대상은 에디터 기능뿐이다. 게임 실행 쪽 동작은 이 항목의 범위가 아니다.
- 현재: 그래프 또는 그 점을 선택하면, 그 그래프의 모든 점에 대해 매 프레임 unreachable 여부를 계산한다.
- 아이디어: 에디터 도구 막대에 토글 버튼을 두어, 끄면 unreachable을 판단하는 로직 자체가 에디터에서 수행되지 않게 한다.

## Current conclusions and open questions
- 결정(사용자): 최적화 대신 이 검사를 에디터에서 통째로 끄는 버튼을 만든다. 만드는 시점은 나중이다.
- 미정: 버튼의 기본 상태.

## Where to pick up
- 검사가 부담되거나 불필요해지는 시점에 플러그인 도구 막대(연결 토글 옆)에 켜고 끄는 토글을 추가한다.

## References
- 프로젝트: DAYLIGHT (Godot 4.7). 관련 코드: addons/rail_graph_editor/의 플러그인.
