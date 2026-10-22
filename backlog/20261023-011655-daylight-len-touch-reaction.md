---
title: "DAYLIGHT Len이 만질 때의 반응 (애니메이션, 대상 쪽으로 돌아보기, 이동 막기)"
created: 2026-10-23
updated: 2026-10-23
---

## Background
DAYLIGHT(Godot) 프로젝트의 `actis-and-touch` change에서 Len의 만지기를 구현했지만, 만질 때 Len에게 보이는 반응은 범위 밖이었습니다. 지금은 만져도 Len에게 아무 반응이 없습니다.

## What to remember
정할 것:
- 만질 때 Len의 애니메이션.
- Len이 대상 쪽으로 돌아보는지.
- 만지는 동안 이동을 막는지.

현재 Len의 스프라이트에는 만지기 애니메이션이 없습니다.

## Current conclusions and open questions
- 결정된 것은 없습니다. 시점도 정하지 않았습니다.

## Where to pick up
만지기 애니메이션 리소스가 생기거나 만지기 반응이 필요해질 때 위 세 가지를 정합니다.

## References
- 프로젝트: DAYLIGHT. `openspec/changes/archive/2026-10-22-actis-and-touch/`의 proposal.md(범위 밖), design.md의 Non-Goals.
