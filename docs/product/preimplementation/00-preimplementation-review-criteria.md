# 구현 전 산출물 리뷰 기준

작성일: 2026-05-16

## 최우선 기준

> 사용자가 귀찮다고 느끼면 실패한다.

모든 PRD, UX, 데이터 모델, 리플레이, 실험 계획은 이 기준을 통과해야 한다.

## Anti-Annoyance Gate

각 기능은 구현 전 아래 질문에 답할 수 있어야 한다.

1. 첫 사용자가 3초 안에 무엇을 해야 하는지 이해하는가?
2. 사용자가 좌표, 색상, 친구와의 합의, 그림 실력을 동시에 고민하지 않아도 되는가?
3. 참여하지 못했을 때 손해감보다 나중에 참여 가능하다는 안도감을 주는가?
4. 알림이나 초대 문구가 압박이 아니라 가벼운 요청으로 느껴지는가?
5. 고급 기능이 첫 화면을 복잡하게 만들지 않는가?
6. 로그인 없이도 초대받은 사용자가 첫 픽셀을 남길 수 있는가?
7. 실패/오류 상태에서도 사용자가 탓받는 느낌을 받지 않는가?
8. 픽셀 가능 횟수가 저장되어 “지금 당장 와야 한다”는 압박을 줄이는가?
9. 저장에는 최대 시간이 있어 무한 누적/악용/복잡성을 막는가?
10. 프로젝트 맵 크기, 목표 완료 시간, 참여자 수에 따라 지급 속도가 동적으로 계산되는가?
11. 프로젝트가 하루를 넘기지 않고, 가능하면 회사/모임 시간 안의 짧은 주기로 끝나도록 설계되는가?

## Canonical Phase-1 MVP Contract

구현 계획으로 넘어갈 수 있는 첫 범위는 아래로 제한한다.

```text
room creation -> invite link -> invite open -> anonymous/guest Quick Pixel -> optional name -> room-scoped realtime update -> basic funnel analytics
```

추가 기준:

- 닉네임/프로필/계정은 첫 픽셀 전에 필수가 아니다.
- 사용자는 초대 랜딩에서 약 3초 안에 무엇을 하면 되는지 이해해야 한다.
- 초대 열기부터 첫 픽셀 완료까지 median 목표는 10초 미만이다.
- Quick Pixel 탭 이후 성공 피드백까지 median 목표는 3초 미만이다.
- 60초는 성공 기준이 아니라 실패 인터뷰/진단을 시작하는 상한선이다.
- 픽셀 가능 횟수는 저장형 allowance로 표현한다. 사용자가 늦게 와도 일부 횟수가 남아 있어야 한다.
- allowance 지급 속도는 고정 n초가 아니라 `맵 픽셀 수 / 목표 완료 시간 / 참여자 수`로 계산한다.
- 저장형 allowance는 최대 저장 시간으로 cap을 둔다. 무한 누적은 허용하지 않는다.
- 프로젝트 목표 완료 시간은 24시간을 넘기면 안 되며, 기본 planning target은 6시간 내 완료다.
- 리플레이, 알림, 반복 리텐션 실험은 Phase 2+ 설계 입력이며 Phase 1 구현 blocker가 아니다.

## 문서별 통과 기준

### 01 Friend Room MVP PRD

- 문제/대상/범위가 명확해야 한다.
- 첫 버전의 non-goals가 강하게 정의되어야 한다.
- 모든 acceptance criteria가 테스트 가능해야 한다.
- 귀찮음 방지 원칙이 기능 요구사항에 들어가야 한다.

### 02 Quick Pixel UX Spec

- 첫 참여 흐름이 3초/1행동 중심이어야 한다.
- 마이크로카피가 부담을 낮춰야 한다.
- 직접 그리기/방해/팀전은 첫 화면에서 숨겨야 한다.
- 오류/빈 상태가 부드러워야 한다.

### 03 Room/Daily Canvas Data Model

- 계정 없이 시작 가능해야 한다.
- roomId/dailyCanvasId 경계가 명확해야 한다.
- Socket.IO room scoping이 가능해야 한다.
- 관리자/방장 scope가 전역에서 방 단위로 확장 가능해야 한다.

### 04 Replay Phase 2 Tech Design

- 영상 export 없이 웹 리플레이가 먼저 가능해야 한다.
- pixel_events를 replay 원본으로 활용해야 한다.
- 공개/비공개 공유 권한이 명확해야 한다.
- 성능 비용이 Phase 2 Web Replay에 맞게 제한되어야 하며 Phase 1 구현에 끼어들면 안 된다.

### 05 Invite/Share Funnel Experiment Plan

- Phase 1의 초대→첫 픽셀 퍼널이 먼저 측정 가능해야 하며, 리플레이/공유/알림은 Phase 2+로 분리되어야 한다.
- 카피/온보딩 A/B 테스트가 포함되어야 한다.
- 알림은 MVP 밖이며, 추후 실험 시 피로도 제한과 opt-in 조건이 있어야 한다.
- 개인정보를 과하게 수집하지 않아야 한다.

## 최종 리뷰 결론 형식

각 문서는 최종적으로 다음 중 하나의 판정을 받는다.

- APPROVED: 구현 계획으로 넘겨도 됨
- APPROVED_WITH_NOTES: 구현 가능하지만 주의사항 있음
- REVISE: 구현 전 수정 필요
- REJECT: 방향 재검토 필요

## Self-review

- Review criteria now define the Phase-1 MVP loop before document-specific checks.
- Anti-annoyance gates include identity, timing, dynamic project pacing, saved pixel allowance, notification, and scope constraints.
- Replay and notification work are explicitly separated from Phase 1 so they do not become hidden implementation blockers.
