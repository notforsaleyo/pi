---
title: "DAYLIGHT 레일 그래프용 NPC 길찾기 모듈 (AStar2D) 추후 설계"
status: open
created: 2026-10-09
updated: 2026-10-09
---

## 대화 배경
DAYLIGHT(Godot) 프로젝트의 OpenSpec change `rail-movement`(intent-driven)를 탐색하던 중에 나온 내용입니다.
이 change는 주인공과 NPC가 레일 그래프(`RailPoint` 점 + 점 쌍 연결 목록) 위를 1차원으로 움직이는 규칙을 정합니다.
이번 대화에서 확정한 주요 결정:
- Crawler는 입력을 모릅니다. `@abstract Crawler`(Node 부품, 부모 Node2D의 global_position과 z_index를 바꿈)를
  `MainCrawler`(분기에서 의도 제공자에게 위/아래/중립을 물음)와 `NpcCrawler`(다음 점을 직접 고름)가 상속합니다.
- 막혔는지는 부작용 없는 조회 `is_blocked(direction)`로 알려 줍니다. `crawl()`은 반환값이 없습니다.
- 점의 깊이 값은 `z_index`와 같은 의미(클수록 앞)로 둡니다.
- 한 씬에 레일 그래프는 하나이고, 끊어진 덩어리를 허용합니다. 그래프를 바꾸는 방법은 `mount(point)`뿐입니다.
- 그래프는 실행 중에 바뀌지 않습니다.
- 진행도에 따른 점 숨김과 진입 동작은 이번 범위 밖입니다(주인공 전용 필터로 나중에 추가).

## 기억할 내용
- 이번 change에서는 `AStar2D`를 쓰지 않습니다. 이웃 조회는 씬이 로드될 때 연결 목록으로 만든 "점 -> 이웃 점들" 딕셔너리로 합니다.
  - 이유: 지금 쓰는 곳이 이웃 조회뿐이고, AStar2D는 점을 정수 id로 다뤄 RailPoint와의 대응표가 필요하며,
    점마다 사용자 데이터를 붙일 수 없습니다. AStar2D는 RefCounted라 씬에 저장할 수도 없습니다.
  - AStar2D는 끊어진 덩어리를 그대로 다룹니다(이어지지 않은 점 사이의 경로는 빈 결과).
- NPC 이동은 대부분 사람이 직접 지정합니다. 패트롤 AI나 길찾기는 안전하고 단순한 경우(일부 컷신 등)에만 씁니다.
- 길찾기 모듈은 레일 시스템과 별개로 만듭니다(사용자 방향, 에이전트 동의).
  - 길찾기 모듈이 레일 그래프의 점과 연결 목록을 읽어 AStar2D를 만듭니다. 레일 그래프는 길찾기를 모릅니다.
  - 결과(점 목록)는 NpcCrawler를 조종하는 쪽이 씁니다. NpcCrawler도 길찾기를 모릅니다.

## 현재 결론과 미정 사항
- 확정: 이번 rail-movement change에는 길찾기와 AStar2D를 넣지 않습니다.
- 확정: 레일 그래프는 점과 연결 목록을 읽기 전용으로 공개합니다(공개 방식은 rail-movement design에서 정함).
- 미정: 길찾기가 "현재 로드된 씬의 그래프"만 다루는지, "로드되지 않은 다른 맵의 그래프"까지 다뤄야 하는지
  (화면 밖 NPC의 맵 간 이동 등).
- 미정: 맵 사이를 잇는 수단(승강기, 문 등 레일 밖 이동)을 길찾기가 알아야 하는지.

## 다음에 이어갈 지점
NPC 길찾기가 실제로 필요한 장면이 생기면, 위 미정 사항부터 정하고 별도 OpenSpec change로 설계합니다.

## 참고
- 프로젝트: DAYLIGHT (Godot 4.7), change `openspec/changes/rail-movement/` 의 exploration.md

## 완료 기록
