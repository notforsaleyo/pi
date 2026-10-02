---
title: "Godot 대화 시스템 검토 — Dialogue Manager와 Ink"
status: open
created: 2026-09-25
updated: 2026-09-25
---

## 대화 배경
Unity에서 6~7년 전에 Yarn Spinner를 편하게 사용했지만 현재는 사용법을 잊은 상태입니다. Godot으로 2D 작업을 시작하며, Godot에서 잘 작동하거나 Godot 전용으로 만들어진 대화 도구를 찾았습니다.

## 기억할 내용
- Dialogue Manager는 Godot 전용 텍스트 기반 대사·선택지·분기 편집 및 실행 도구입니다. 게임 객체의 상태와 함수를 연결할 수 있습니다.
- 조사 당시 Dialogue Manager 4.1.0은 정식 릴리스이며 Godot 4.6 이상을 요구합니다. .NET은 필요하지 않습니다.
- Ink도 비교할 후보입니다. Godot 연동 도구인 GodotInk는 .NET 환경이 필요하며, 순수 GDScript 구현인 InkGD는 Godot 4용 별도 브랜치의 배포 상태를 확인해야 합니다.

## 현재 결론과 미정 사항
사용자는 Dialogue Manager를 긍정적으로 평가했고, Ink도 알아보기로 했습니다. 최종 도구 선정이나 설치는 아직 하지 않았습니다.

## 다음에 이어갈 지점
Dialogue Manager의 대화 편집·게임 상태 연동 흐름을 살펴보고, Ink의 작성 방식과 Godot 연동 환경을 조사하여 비교합니다.

## 참고
- Dialogue Manager: https://github.com/nathanhoad/godot_dialogue_manager
- Ink: https://github.com/inkle/ink
- GodotInk: https://github.com/paulloz/godot-ink
- InkGD: https://github.com/ephread/inkgd
