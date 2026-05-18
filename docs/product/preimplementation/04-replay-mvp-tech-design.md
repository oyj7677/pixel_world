# 04. Replay Phase 2 기술 설계

작성일: 2026-05-16  
상태: 구현 전 기술 설계  
범위: Phase 2 Web Replay, 영상 export는 후순위

## 1. 목적

Replay Phase 2는 하루 동안 친구들이 남긴 픽셀 변화 과정을 웹에서 가볍게 재생하는 기능이다. 초기 목표는 mp4/gif 생성이 아니라, `pixel_events`를 기반으로 브라우저에서 빠르게 재생되는 공유 가능한 웹 리플레이를 제공하는 것이다.

핵심 제품 원칙:

> 리플레이는 참여를 강요하는 장치가 아니라, 참여 후 “내 한 칸이 친구들과 함께 남았다”는 감각을 강화하는 보상이어야 한다.

## 2. Replay Phase 범위

### 포함

- 마감된 daily canvas의 픽셀 이벤트 순서 재생
- 완성 이미지 표시
- 참여자/닉네임/색상 최소 표시
- 공유 가능한 replay page
- 공개/비공개 접근 정책
- 기본 속도 조절
- 모바일 친화적 재생 UI

### 제외

- mp4/gif export
- 서버 사이드 영상 렌더링
- 복잡한 편집기
- 음악/자막 자동 생성
- 고급 하이라이트 편집
- 공개 피드/탐색 탭
- 리플레이 생성 대기 알림

## 3. 데이터 원본

기본 원본은 `pixel_events`다.

필요 필드:

- `id`
- `canvas_id`
- `x`
- `y`
- `previous_color_hex`
- `new_color_hex`
- `actor_key`
- `source`
- `created_at`

방/일자 context는 `daily_canvases`와 `room_members`에서 가져온다.

리플레이에서 일반 사용자에게 직접 노출 가능한 actor 정보:

- room-local display name
- display color
- 익명화된 participant index

노출하지 말아야 할 정보:

- actor key 원문
- actor IP hash
- admin-only metadata

## 4. 이벤트 정렬

재생 순서는 안정적이어야 한다.

정렬 기준:

```sql
ORDER BY created_at ASC, id ASC
```

이유:

- `created_at`만으로는 같은 timestamp 내 순서가 불안정할 수 있다.
- `id`를 보조 정렬로 사용해 동일 결과를 보장한다.

권장 인덱스:

```sql
CREATE INDEX pixel_events_canvas_replay_idx
ON pixel_events(canvas_id, created_at ASC, id ASC);
```

## 5. Replay API

### `GET /api/rooms/:roomPublicId/days/:date/replay`

마감된 daily canvas의 replay payload를 반환한다.

요청 권한:

- private room: room member 또는 valid share token 필요
- unlisted share: share token 또는 공개 설정 필요
- admin preview: admin session 필요

반환 예시:

```json
{
  "room": {
    "publicId": "r_abc123",
    "name": "오늘 우리"
  },
  "dailyCanvas": {
    "id": "dc_123",
    "canvasId": "room_r_abc123_20260516",
    "date": "2026-05-16",
    "width": 32,
    "height": 32,
    "defaultColorHex": "#FFFFFF",
    "status": "replay_ready"
  },
  "participants": [
    {
      "participantId": "p1",
      "displayName": "민수",
      "displayColor": "#38BDF8"
    }
  ],
  "events": [
    {
      "id": "event-id",
      "x": 4,
      "y": 8,
      "newColorHex": "#38BDF8",
      "participantId": "p1",
      "source": "user",
      "createdAt": "2026-05-16T10:12:00.000Z"
    }
  ],
  "finalPixels": [
    {
      "x": 4,
      "y": 8,
      "colorHex": "#38BDF8",
      "updatedAt": "2026-05-16T10:12:00.000Z"
    }
  ]
}
```

### `POST /api/rooms/:roomPublicId/days/:date/share`

공유 링크 생성.

정책:

- room owner/admin 또는 해당 방 설정에 따라 허용된 member만 생성 가능.
- share token은 hash 저장.
- 기본은 unlisted link.
- 공유 링크 삭제/회수 가능해야 한다.

### `GET /replay/:shareToken`

공유 페이지.

- 로그인 없이 접근 가능.
- share token이 유효하고 revoked 되지 않아야 한다.
- private room의 원본 방 URL이나 멤버 정보는 과도하게 노출하지 않는다.

## 6. Web Replay 렌더링

### 렌더링 방식

Replay Phase 2는 브라우저 canvas 또는 CSS grid 중 하나를 사용한다.

권장:

- 16×16, 32×32: CSS grid 가능
- 50×50 이상: `<canvas>` 권장
- Replay Phase 2는 32×32 default로 시작해 성능과 UX를 안정화한다.

### 재생 알고리즘

1. default canvas를 초기 상태로 만든다.
2. `events`를 순서대로 가져온다.
3. 각 이벤트의 `x`, `y`, `newColorHex`를 적용한다.
4. 일정 간격으로 프레임을 업데이트한다.
5. 마지막에는 `finalPixels`와 동일 상태인지 검증한다.

### 속도

기본 속도:

- 짧은 replay: 전체 6~10초
- 긴 replay: 최대 20초 내 압축 재생

사용자 옵션:

- pause/play
- replay again
- speed: 1× / 2× / instant

Anti-annoyance 관점:

- 리플레이를 기다리게 만들면 안 된다.
- 3초 내 첫 프레임이 보여야 한다.
- mp4 생성 대기 같은 무거운 UX는 Replay Phase 2에서도 제외한다.

## 7. 캐싱/스냅샷

### Replay Phase 2 1차

이벤트 수가 적은 방에서는 요청 시 `pixel_events`와 `pixels`를 조회한다.

적정 기준:

- 32×32 canvas
- 하루 이벤트 수 5,000 이하
- 응답 payload 1MB 이하 목표

### Replay Phase 2 2차

필요 시 `replay_snapshots` 도입.

필드:

- `id`
- `daily_canvas_id`
- `event_count`
- `final_pixels_json` 또는 object storage URL
- `participants_json`
- `generated_at`

### 이후 확장

- 이벤트 chunking
- static JSON file export
- CDN cache
- mp4/gif async job

## 8. 공유 페이지 UX

### 기본 구조

```text
[방 이름] 2026.05.16
오늘 친구들이 남긴 픽셀

[Replay Canvas]
[Play/Pause] [Again] [Speed]

민수, 지윤, 나 포함 5명이 한 칸씩 남겼어요.
[내 방 만들기] [친구에게 공유]
```

### 공유 페이지의 목표

- 기존 참여자에게 보상 제공
- 비참여자에게 제품 이해 제공
- 새 방 생성으로 이어지는 부드러운 CTA 제공

### 하지 말아야 할 것

- 공유 페이지 첫 화면에 회원가입 요구
- 광고를 리플레이 위에 덮기
- “매일 참여해야 합니다” 같은 압박 문구
- 팀전/방해 기능 홍보를 먼저 노출

## 9. Privacy / Access Control

### 기본 정책

- 방은 기본 private.
- replay 공유는 별도 share token이 있어야 한다.
- share token은 revoke 가능하다.
- 공유 페이지에는 actor key/IP hash를 노출하지 않는다.
- 닉네임은 room-local display name만 사용한다.

### 공유 옵션

Replay Phase 2:

- 링크가 있는 사람만 보기
- 링크 회수 가능

후순위:

- 멤버만 보기
- 공개 프로필에 게시
- 다운로드 허용/불허

## 10. Admin / Moderation

관리자는 다음 작업을 할 수 있어야 한다.

- 특정 daily canvas replay 비공개 처리
- replay share token revoke
- 특정 영역 초기화 후 replay rebuild
- 신고된 replay 검토

주의:

- admin 영역 초기화가 replay_ready 이후 발생하면 replay cache를 invalidation해야 한다.
- source가 admin인 이벤트는 replay에서 표시 방식을 다르게 할 수 있다.
  - 예: “운영자 정리됨” 또는 리플레이에서 생략

Replay Phase 2 권장:

- admin event도 최종 이미지에는 반영한다.
- 리플레이 타임라인에는 사용자 이벤트 중심으로 보여준다.
- 운영자 수정 내역은 일반 공유 페이지에서는 과도하게 강조하지 않는다.

## 11. 성능 제약

### 목표

- replay API p95 응답: 500ms 이하, 작은 방 기준
- replay page 첫 렌더: 3초 이하
- replay payload: 1MB 이하 목표
- 모바일 Safari/Chrome에서 32×32 replay 부드럽게 재생

### 제한

- Replay Phase 2 방 크기 기본 32×32
- 하루 이벤트 수가 과도하면 이벤트 sampling 또는 압축 필요
- 대형 이벤트 방 replay는 별도 phase로 분리

## 12. mp4/gif export 경계

영상 export는 Phase 2 Web Replay 범위도 아니다.

도입 조건:

- 웹 리플레이 조회율이 충분히 높다.
- 공유 페이지에서 외부 공유 전환이 확인된다.
- 사용자가 다운로드/숏폼 공유를 명확히 요구한다.

나중에 필요한 구성:

- render job queue
- object storage
- export status table
- retry/failure handling
- rate limit
- premium feature 여부 결정

## 13. Replay DTO / Privacy Contract

Phase 2 replay API는 아래 contract를 따라야 한다.

- `participants`: actor key를 직접 노출하지 않고 share-local `participantId`를 생성한다.
- `displayName`: room-local optional display name만 사용한다. 이름이 없으면 “Someone” 또는 “익명의 친구”로 표시한다.
- Name changes: replay 생성 시점의 최신 room-local display name을 사용하되, historical 정확성이 필요해지면 별도 name-change event를 추가한다.
- Admin/moderation events: public replay timeline에는 노출하지 않는다. 단, reset/restore 결과는 `finalPixels`에 반영한다.
- `events`: `created_at ASC, id ASC` 순서로 안정 정렬한다.
- `finalPixels`: sealed canvas의 `pixels` snapshot에서 읽거나 replay cache 생성 시 고정한다. live active canvas의 public replay는 제공하지 않는다.
- Share token: `replay_shares` table을 별도로 둔다. raw token은 한 번만 표시하고 DB에는 hash를 저장한다.
- Cache invalidation: admin restore/reset/hide 후 해당 `dailyCanvasId`의 replay cache version을 증가시킨다.

## 14. Acceptance Criteria

### Replay Data

- Given sealed daily canvas, replay API returns events ordered by `created_at ASC, id ASC`.
- Replay payload does not include actor key or IP hash.
- Replay payload includes enough participant display data to show room-local names.
- Final rendered state equals current final pixel snapshot.

### Replay Page

- Shared replay link opens without account creation.
- Invalid/revoked share token shows a gentle unavailable state.
- Replay starts or shows first frame within 3 seconds on normal network.
- User can pause and replay.
- Page includes “내 방 만들기” CTA without blocking replay.

### Privacy

- Private room replay is inaccessible without membership or share token.
- Share token can be revoked.
- Admin can hide a replay if moderation is needed.

### Anti-Annoyance

- User is not asked to wait for video rendering in Phase 2 Web Replay.
- User is not asked to sign up before viewing shared replay.
- Replay page does not introduce missions, streaks, or competitive mechanics before the replay is watched.

## 15. Risks and Mitigations

### Risk: replay payload becomes too large

Mitigation:

- Start with small 32×32 rooms.
- Add payload size monitoring.
- Introduce replay snapshots/chunking before large rooms.

### Risk: replay exposes private room behavior

Mitigation:

- Explicit share token.
- Revocation.
- No actor key/IP hash.
- Conservative default privacy.

### Risk: video export scope creeps into Replay Phase 2

Mitigation:

- Make web replay the only Phase 2 target.
- Track export requests as feedback, not implementation requirement.

### Risk: replay feels like another task

Mitigation:

- Show result immediately.
- Keep controls minimal.
- CTA is optional and after the replay value is visible.

## 16. 구현 전 결정 필요 사항

1. share token storage는 `replay_shares` table로 분리한다.
2. admin event는 public replay timeline에 노출하지 않고 최종 state에만 반영한다.
3. replay 접근 권한을 room member와 share token 중 어디까지 허용할지.
4. finalPixels를 매 요청마다 `pixels`에서 읽을지 replay snapshot에 저장할지.
5. 32×32 외 크기의 Replay Phase 2 지원 여부.

## 17. Self-review

- Replay 원본 데이터, 정렬, DTO/privacy contract, 웹 렌더링, 캐싱, 공유 페이지, 성능, 영상 export 경계를 포함했다.
- Phase 2를 웹 리플레이로 제한하고 Phase 1 구현에서 제외해 초기 구현 부담과 사용자 대기 부담을 줄였다.
- actor key/IP hash 비노출 원칙을 명확히 했다.
- 공유/CTA가 제품 루프에 연결되지만 첫 경험을 방해하지 않도록 제한했다.

## File Path

`docs/product/preimplementation/04-replay-mvp-tech-design.md`
