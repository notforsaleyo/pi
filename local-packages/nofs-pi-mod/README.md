# nofs-pi-mod: 자동 핸드오프

- `/auto-handoff on`: 현재 세션의 자동 핸드오프 활성화
- `/auto-handoff off`: 비활성화 및 예약된 전환 취소
- 기본값은 off입니다. 설치하거나 `/reload`하는 것만으로 켜지지 않습니다.
- 활성화하면 입력창 하단 왼쪽에 `nf-md-handshake` 아이콘이 표시됩니다. 비활성화하면 가로선만 표시됩니다.
- 활성화 상태는 세션에 저장되어 `/reload`, `/resume` 및 핸드오프 후에도 유지됩니다. 별도로 시작하는 빈 새 세션은 off입니다.

## 기준 설정

`auto-handoff.json`의 사용률은 퍼센트 단위입니다. 변경 후 `/reload`하십시오.

```json
{
  "providers": {
    "openai": 60,
    "openai-codex": 60,
    "anthropic": 25
  },
  "models": {}
}
```

`models`에 `"provider/modelId": 50`처럼 넣으면 해당 모델에만 우선 적용합니다. 기준이 없는 제공자는 자동 전환하지 않습니다. 값은 0보다 크고 100보다 작아야 하며, 설정을 읽을 수 없거나 잘못된 값이 있으면 자동 전환을 비활성화합니다.

## 전환 동작

1. 각 모델 응답과 그에 따른 모든 도구 실행이 끝나면 콘텍스트 사용률을 확인합니다. 대기 중인 사용자 메시지가 있으면 먼저 처리합니다.
2. 기준 이상이면 다음 작업을 중단하고 기존 세션에서 핸드오프 노트를 만듭니다. 요약 중점 질문은 생략합니다.
3. `.pi/handoff.md`에 저장한 뒤 `작업명_1`, `작업명_2`처럼 이름을 증가시켜 새 세션을 만듭니다. 이름이 없으면 `이름 없음_1`부터 시작합니다.
4. 실제 PLAN/SPEC/BASH 모드, 모델, 사고 수준 및 자동 핸드오프 설정을 복원합니다. 모드/모델 계승은 수동 `/handoff`에도 적용됩니다.
5. 노트를 새 세션의 사용자 메시지로 먼저 저장한 다음 임시 노트 파일을 정리하고, 미완료 작업만 자동 재개합니다. 완료된 작업이나 승인 대기 사항을 임의로 진행하지 않도록 지시합니다.

이전 세션은 삭제하지 않습니다. 입력창의 미전송 초안도 유지합니다. 자동 실행은 `--purge`나 `--force`를 사용하지 않으며, 미소비 노트가 있으면 덮어쓰지 않고 멈춥니다. 요약 실패, 전환 취소 등으로 실패하면 반복 실행을 막기 위해 off로 바뀝니다. 원인을 확인한 뒤 다시 켜십시오.

요약 중에는 중복 전환과 threshold 자동 압축을 막지만, 수동 압축과 overflow 복구는 유지합니다. 새 세션이 작업 없이 응답만 마치면 즉시 다시 넘기지 않습니다. 사용률은 Pi의 추정값이며, 요약에는 맥락 손실 가능성이 있습니다.

## 테스트

Node의 TypeScript 실행을 지원하는 버전에서 프로젝트 루트 기준:

```powershell
node --test local-packages/nofs-pi-mod/*.test.ts local-packages/nofs-theme/*.test.ts
```

실제 설치된 Pi SDK를 사용하는 통합 테스트도 실행하려면:

```powershell
$env:PI_OFFLINE = '1'
$env:PI_TEST_PACKAGE = Join-Path (npm root -g) '@earendil-works/pi-coding-agent'
node --test local-packages/nofs-pi-mod/handoff.integration.test.ts
```

통합 테스트는 임시 디렉터리와 가짜 모델 응답만 사용합니다. 사용자 세션, 실제 API 및 활성화 상태에는 영향을 주지 않습니다.
