---
title: "OpenSpec intent-driven 확장 도입 검토"
status: open
created: 2026-09-24
updated: 2026-09-24
---

## 대화 배경
게임·모바일 앱 개발에서 AI가 전체 구조를 놓치고 모듈 책임이나 통신 경계를 무시하는 문제를 논의했습니다. 사용자는 이미 OpenSpec 경험이 많으며, 자체 명세 방법론을 새로 만드는 것보다 기존 방식을 활용하기를 원했습니다.

## 기억할 내용
OpenSpec을 유지하면서 `intent-driven` 커뮤니티 스키마를 추가하는 방안입니다. 개별 변경의 설계에 ADR 검토 단계를 추가하고, 후속 작업에서도 참조할 장기적인 아키텍처 결정을 저장하는 목적입니다.

작은 문서 수정이나 국소적인 버그 수정까지 모두 이 흐름으로 처리할 필요는 없습니다. change별로 기본 `spec-driven`과 `intent-driven`을 선택할 수 있다는 점을 논의했습니다.

## 현재 결론과 미정 사항
- 사용자는 비교한 후보 중 `intent-driven` 확장을 가장 선호했습니다.
- 제안한 운영 방향은 평소에는 기본 OpenSpec, 모듈 책임·상태 소유권·통신 방식 등 구조적 결정이 필요한 변경에는 `intent-driven`을 사용하는 것입니다.
- 기본 스키마로 작업해도 기존의 유효한 ADR을 참조하도록 하는 공통 지침이 필요하다는 점을 논의했습니다.
- 실제 도입·설치는 아직 하지 않았고 대상 저장소도 정하지 않았습니다. 구체적인 설치·운영 방법은 실제 적용할 때 다시 확인하기로 했습니다.
- 커뮤니티 확장이며, 아키텍처 지도 자동 동기화나 수정 범위 강제까지 제공하는 것으로 간주하지 않습니다.

## 다음에 이어갈 지점
적용할 프로젝트를 정한 뒤 현재 OpenSpec 및 확장 버전의 호환성을 확인합니다. 스키마 설치 방법, 변경별 선택 방법, 기존 ADR을 기본 작업 흐름에서도 참조하는 방법을 해당 버전의 문서와 소스로 확인합니다.

## 참고
- 확장 저장소: https://github.com/intent-driven-dev/openspec-schemas
- 스키마 설명: https://github.com/intent-driven-dev/openspec-schemas/tree/main/openspec/schemas/intent-driven
- OpenSpec 커스터마이징: https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md

## 완료 기록
