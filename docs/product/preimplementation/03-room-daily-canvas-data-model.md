# 03. Room / Daily Canvas 데이터 모델 및 API 경계 설계

작성일: 2026-05-16  
상태: 구현 전 설계  
범위: 문서 설계만, 코드 변경 없음

## 1. 목적

현재 Pixel World는 하나의 `global` 캔버스를 중심으로 동작한다. 앞으로는 친구 방과 하루 단위 캔버스를 지원해야 하므로, 기존 `canvases`, `pixels`, `pixel_events` 구조를 버리지 않고 그 위에 `rooms`, `room_members`, `daily_canvases`, `room_invites`를 추가하는 방식으로 확장한다.

핵심 제약은 다음이다.

- 초대받은 사용자는 계정 없이 바로 참여할 수 있어야 한다.
- 첫 픽셀을 찍기 위해 복잡한 가입/권한 흐름을 거치면 안 된다.
- 방/일자 경계가 명확해야 실시간 동기화, 리플레이, 관리자 기능을 안전하게 확장할 수 있다.
- `pixel_events`는 리플레이의 원본 데이터로 계속 활용한다.

## 2. 설계 원칙

1. **익명 actor cookie 우선**  
   계정 없이 시작하고, 나중에 계정 연결이 필요하면 claim/migration 경로를 둔다.

2. **Room은 소셜 경계, Daily Canvas는 플레이 경계**  
   친구 초대와 멤버십은 room 기준, 실제 픽셀 저장과 리플레이는 daily canvas 기준으로 처리한다.

3. **기존 canvas 저장 구조 재사용**  
   `pixels.canvas_id`, `pixel_events.canvas_id`를 계속 중심으로 사용한다.

4. **초대 토큰은 비밀값으로 취급**  
   URL에는 raw token이 들어가지만 DB에는 hash만 저장한다.

5. **관리자/방장 작업은 항상 scope를 남긴다**  
   global, room, daily_canvas, canvas 중 어디에 대한 작업인지 감사 로그에 남긴다.

## 3. 주요 식별자

| 대상 | 내부 식별자 | 공개 식별자 | 설명 |
|---|---|---|---|
| Room | `rooms.id` | `rooms.public_id` | URL에 노출되는 방 ID는 추측 불가능해야 함 |
| Daily Canvas | `daily_canvases.id` | room + date | 하루 단위 플레이/리플레이 경계 |
| Canvas | `canvases.id` | 내부 중심 | 기존 pixel 저장소의 기준 |
| Invite | `room_invites.id` | raw invite token | DB에는 token hash만 저장 |
| Actor | `actor_key` | 없음 | 쿠키 기반 익명 사용자 |
| Member | `room_members.id` | 없음 | actor와 room의 관계 |

권장 canvas id 형식:

```text
room_<roomPublicId>_<YYYYMMDD>
```

단, 이 값은 식별 편의를 위한 것이며 권한 판단에 사용하면 안 된다. 권한은 room membership 또는 invite token으로 판단한다.

## 4. 테이블 설계

### 4.1 `rooms`

친구 방의 소셜 단위.

필드:

- `id UUID PRIMARY KEY`
- `public_id TEXT UNIQUE NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT`
- `privacy TEXT NOT NULL CHECK (privacy IN ('private', 'unlisted'))`
- `owner_actor_key TEXT NOT NULL`
- `default_width INTEGER NOT NULL`
- `default_height INTEGER NOT NULL`
- `default_cooldown_ms INTEGER NOT NULL` — legacy compatibility
- `target_completion_ms INTEGER NOT NULL`
- `expected_participant_count INTEGER NOT NULL`
- `pixel_allowance_interval_ms INTEGER NOT NULL` — computed project pacing snapshot
- `pixel_allowance_max_storage_ms INTEGER NOT NULL`
- `timezone TEXT NOT NULL DEFAULT 'Asia/Seoul'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `archived_at TIMESTAMPTZ`

MVP 기본값:

- `privacy = 'private'`
- `default_width = 32`
- `default_height = 32`
- `default_cooldown_ms`는 legacy compatibility로 유지
- `target_completion_ms` 기본값은 6시간, hard max는 24시간 미만
- `expected_participant_count`는 방 생성/프로젝트 시작 시 입력 또는 초대 수로 추정
- `pixel_allowance_interval_ms`는 고정값이 아니라 `target_completion_ms * expected_participant_count / required_pixel_count`로 계산한 snapshot
- `pixel_allowance_max_storage_ms`는 기본 30분 또는 target duration의 약 10%로 시작하며 무한 누적을 막는다

Anti-annoyance 관점:

- 방 생성 시 처음에는 방 이름만 요구한다.
- 크기, 모드, 템플릿, 고급 설정은 MVP 첫 화면에서 숨긴다.

### 4.2 `room_members`

방에 참여한 익명 actor의 멤버십.

필드:

- `id UUID PRIMARY KEY`
- `room_id UUID NOT NULL REFERENCES rooms(id)`
- `actor_key TEXT NOT NULL`
- `display_name TEXT`
- `display_color TEXT`
- `role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest'))`
- `state TEXT NOT NULL CHECK (state IN ('active', 'left', 'blocked'))`
- `joined_via_invite_id UUID REFERENCES room_invites(id)`
- `joined_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `last_seen_at TIMESTAMPTZ`

제약:

```sql
UNIQUE (room_id, actor_key)
```

정책:

- 초대 링크로 들어온 사용자는 `guest` 또는 `member`로 자동 생성한다.
- 닉네임/display_name은 선택이며 첫 픽셀 이후에만 요청할 수 있다.
- Quick Pixel은 멤버십이 없으면 anonymous guest 멤버십을 생성하고, join 흐름은 invite 검증과 멤버십 보장만 담당한다.

### 4.3 `room_invites`

방 초대 링크.

필드:

- `id UUID PRIMARY KEY`
- `room_id UUID NOT NULL REFERENCES rooms(id)`
- `code_hash TEXT UNIQUE NOT NULL`
- `created_by_member_id UUID REFERENCES room_members(id)`
- `role_on_join TEXT NOT NULL DEFAULT 'guest'`
- `max_uses INTEGER`
- `use_count INTEGER NOT NULL DEFAULT 0`
- `expires_at TIMESTAMPTZ`
- `revoked_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

정책:

- raw token은 생성 시 한 번만 보여준다.
- DB에는 hash만 저장한다.
- MVP에서는 만료 없음 + revocation 지원 정도로 시작한다.
- 추후 max uses, 만료 시간, 역할 지정 확장.

### 4.4 `room_invite_uses`

초대 사용 감사 로그.

필드:

- `id UUID PRIMARY KEY`
- `invite_id UUID NOT NULL REFERENCES room_invites(id)`
- `room_id UUID NOT NULL REFERENCES rooms(id)`
- `actor_key TEXT NOT NULL`
- `actor_ip_hash TEXT`
- `used_at TIMESTAMPTZ NOT NULL DEFAULT now()`

주의:

- IP 원문 저장 금지.
- 일반 UI에 actor key/IP hash 노출 금지.

### 4.5 `daily_canvases`

방의 하루 단위 캔버스.

필드:

- `id UUID PRIMARY KEY`
- `room_id UUID NOT NULL REFERENCES rooms(id)`
- `canvas_date DATE NOT NULL`
- `canvas_id TEXT UNIQUE NOT NULL REFERENCES canvases(id)`
- `status TEXT NOT NULL CHECK (status IN ('scheduled', 'active', 'sealed', 'replay_ready'))`
- `width INTEGER NOT NULL`
- `height INTEGER NOT NULL`
- `default_color_hex TEXT NOT NULL DEFAULT '#FFFFFF'`
- `cooldown_ms INTEGER NOT NULL` — legacy compatibility
- `target_completion_ms INTEGER NOT NULL`
- `expected_participant_count INTEGER NOT NULL`
- `required_pixel_count INTEGER NOT NULL`
- `pixel_allowance_interval_ms INTEGER NOT NULL` — computed project pacing snapshot
- `pixel_allowance_max_storage_ms INTEGER NOT NULL`
- `pacing_recalculated_at TIMESTAMPTZ`
- `opened_at TIMESTAMPTZ NOT NULL`
- `sealed_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

제약:

```sql
UNIQUE (room_id, canvas_date)
```

정책:

- Phase 1에서는 방 생성 시 오늘 daily canvas를 즉시 만든다.
- Phase 1은 “today”만 쓰며 자동 일일 롤오버와 과거 날짜 replay는 구현 범위가 아니다.
- `required_pixel_count`는 기본적으로 `width * height`다.
- `pixel_allowance_interval_ms`는 해당 daily canvas의 project pacing snapshot으로 저장한다.
- 같은 프로젝트는 하루를 넘기지 않는 target window를 가져야 한다.
- room timezone은 creator local timezone을 저장하고, 알 수 없으면 UTC로 fallback한다.
- Phase 2에서 lazy rollover를 도입하면 새 날짜 첫 접근 시 이전 active canvas를 `sealed`로 바꾸고 새 active canvas를 만든다.
- `sealed` canvas는 수정 불가이며, replay 생성이 끝나면 `replay_ready`로 전환한다.

### 4.6 `canvases`

기존 저수준 캔버스 테이블을 유지한다.

추가/확장 후보:

- `kind TEXT CHECK (kind IN ('global', 'room_daily'))`
- `updated_at` 유지

정책:

- room/day 정책은 `daily_canvases`에 둔다.
- `canvases`는 픽셀 저장의 물리적 표면 역할만 한다.

### 4.7 `pixels`

기존 구조 유지.

핵심 제약:

```sql
PRIMARY KEY (canvas_id, x, y)
```

### 4.8 `pixel_events`

기존 append-only 이벤트 로그 유지.

리플레이를 위해 필요한 인덱스:

```sql
CREATE INDEX pixel_events_canvas_created_asc_idx
ON pixel_events(canvas_id, created_at ASC, id ASC);
```

현재 DESC 인덱스는 recent 조회에 유용하고, ASC 인덱스는 replay 재생 순서에 유용하다.


### 4.9 `room_pixel_allowances`

방/actor 단위 저장형 픽셀 횟수. 순수 cooldown보다 부담을 줄이기 위해 사용한다.

필드:

- `id UUID PRIMARY KEY`
- `room_id UUID NOT NULL REFERENCES rooms(id)`
- `actor_key TEXT NOT NULL`
- `saved_count INTEGER NOT NULL DEFAULT 0`
- `last_accrued_at TIMESTAMPTZ NOT NULL`
- `last_spent_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

제약:

```sql
UNIQUE (room_id, actor_key)
```

정책:

- allowance scope는 global이 아니라 room + actor다.
- 사용자가 늦게 와도 `pixel_allowance_max_storage_ms` 범위 안에서 횟수가 저장된다.
- 지급 interval은 고정 cooldown이 아니라 프로젝트 pacing snapshot을 따른다.
- 계산식: `dynamic_interval_ms = target_completion_ms * effective_participant_count / required_pixel_count`.
- `required_pixel_count`는 기본적으로 `width * height`이며, 템플릿/고정 픽셀이 생기면 실제 채워야 할 픽셀 수로 낮출 수 있다.
- 최대 저장 개수는 `floor(pixel_allowance_max_storage_ms / dynamic_interval_ms)`로 계산하며 최소 1이다.
- 최대치를 넘기면 추가로 쌓이지 않는다. “사라진다”보다 “더 쌓이지 않는다”에 가깝게 표현해 압박을 줄인다.
- participant count가 변해도 이미 저장된 횟수는 회수하지 않는다. 이후 accrual 속도만 조정한다.
- 첫 초대 Quick Pixel은 최소 1회 가능해야 한다.

### 4.10 `blocks`

차단 범위를 global/room으로 확장한다.

추가 필드:

- `scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'room'))`
- `room_id UUID REFERENCES rooms(id)`

규칙:

- global block은 모든 방에 적용.
- room block은 해당 방에만 적용.
- 배치 시 global block 확인 후 room block 확인.

### 4.11 `admin_actions`

감사 로그 scope 확장.

추가 필드:

- `scope_type TEXT CHECK (scope_type IN ('global', 'room', 'daily_canvas', 'canvas'))`
- `room_id UUID`
- `daily_canvas_id UUID`
- `canvas_id TEXT`
- `actor_key TEXT`

모든 관리자 작업은 scope와 reason을 남긴다.

## 5. API 경계

### 5.1 공개/저마찰 API

#### `POST /api/rooms`

방 생성.

입력:

- `name`

서버 동작:

1. actor cookie 보장.
2. `rooms` 생성.
3. owner `room_members` 생성.
4. 오늘 `canvases` + `daily_canvases` 생성.
5. 기본 invite 생성.
6. room public id와 invite link 반환.

첫 버전에서는 방 이름 외 입력을 요구하지 않는다.

#### `GET /api/rooms/:roomPublicId/today`

오늘 방 정보 조회.

반환:

- room name
- privacy
- today daily canvas metadata
- membership 여부
- Quick Pixel 가능 여부

#### `POST /api/rooms/:roomPublicId/join`

초대 토큰으로 방 입장.

입력:

- `inviteToken`
- `displayName` optional; first pixel must not depend on it

동작:

1. invite hash 검증.
2. actor cookie 보장.
3. anonymous guest membership 생성/재활성화.
4. optional displayName이 있으면 room-local display name 저장.
5. invite use 기록.
6. today canvas 반환.

#### `POST /api/rooms/:roomPublicId/quick-pixel-session`

Quick Pixel 준비 세션.

반환:

- `roomPublicId`
- `dailyCanvasId`
- `canvasId`
- 추천 색상
- 추천 위치 또는 자동 배치 가능 상태
- dynamic pacing 상태: `targetCompletionMs`, `requiredPixelCount`, `effectiveParticipantCount`, `dynamicAllowanceIntervalMs`
- saved pixel allowance 상태: `savedPixelCount`, `maxSavedPixelCount`, `nextPixelSavedAt`, `maxStorageEndsAt`
- socket namespace/room 연결 정보

### 5.2 방 관리 API

- `POST /api/rooms/:roomPublicId/invites`
- `DELETE /api/rooms/:roomPublicId/invites/:inviteId`
- `PATCH /api/rooms/:roomPublicId/members/:memberId`
- `POST /api/rooms/:roomPublicId/archive`

방 owner/admin 권한 필요.

### 5.3 캔버스 API

- `GET /api/rooms/:roomPublicId/days/:date/snapshot`
- `GET /api/rooms/:roomPublicId/days/:date/events`
- `GET /api/rooms/:roomPublicId/days/:date/replay` — Phase 2+ only

Phase 1은 today snapshot 중심이다. 과거 날짜와 replay는 sealed/replay_ready lifecycle이 도입되는 Phase 2에서 제공한다.

## 6. Socket.IO 경계

### 6.1 연결 시 필요한 정보

- `roomPublicId`
- `dailyCanvasId` 또는 `date=today`
- 기존 actor cookie
- 첫 입장 시 optional invite token

### 6.2 서버 검증

1. room 존재 확인.
2. daily canvas 존재 확인.
3. actor membership 또는 invite token 확인.
4. block 상태 확인.
5. daily canvas status가 `active`인지 확인.

### 6.3 Socket.IO room 이름

```text
room:<roomId>
room:<roomId>:day:<YYYY-MM-DD>
canvas:<canvasId>
```

픽셀 업데이트는 `canvas:<canvasId>`로만 broadcast한다.

### 6.4 이벤트 payload 확장

`pixelUpdated`는 다음 필드를 포함한다.

- `roomPublicId`
- `dailyCanvasId`
- `canvasId`
- `x`
- `y`
- `colorHex`
- `updatedAt`

`recentEventsUpdated`는 두 종류를 분리한다.

- `myRecentEventsUpdated`: 현재 actor의 개인 최근 활동만 포함한다.
- `roomRecentEventsUpdated`: 현재 room/day에 대한 집계 활동만 포함하며 다른 방 이벤트를 포함하지 않는다.

Cross-room non-delivery test는 필수다: Room A 참가자는 Room B의 `pixelUpdated`, presence, recent events를 받으면 안 된다.

## 7. Global canvas migration

### Phase A: additive migration

새 테이블을 추가하되 기존 `global` 캔버스 데이터는 건드리지 않는다.

### Phase B: legacy room 생성

- `rooms.public_id = 'global'`
- `rooms.name = 'Global Legacy Canvas'`
- `privacy = 'unlisted'`
- 기존 `canvases.id = 'global'`을 daily canvas에 연결

### Phase C: 신규 경로 전환

새 제품 경로:

```text
/r/:roomPublicId
/r/:roomPublicId/today
/r/:roomPublicId/:date
/invite/:inviteToken
```

기존 `/`는 당분간 landing 또는 legacy global canvas로 유지할 수 있다.

## 8. 구현 전 확정 기본값

1. Phase 1 daily canvas 생성 방식: 방 생성 시 오늘 캔버스 즉시 생성.
2. Phase 2 daily rollover: 첫 접근 시 lazy creation + 이전 active canvas seal.
3. Quick Pixel 추천 위치 알고리즘: 서버 추천/자동 배치.
4. Dynamic project pacing: map size, target completion time, and participant count determine allowance interval.
5. 저장형 pixel allowance: room + actor scope, dynamic interval 기반 누적, 최대 저장 시간 cap.
6. 방 공개 기본값: private invite-link room.
7. 첫 참여자 identity: anonymous actor cookie + optional display name after success.
8. guest/member 역할: MVP에서는 `guest`로 시작하고 이름을 추가해도 계정/영구 멤버로 승격하지 않는다.
9. legacy global canvas는 신규 friend-room MVP와 분리해 유지하거나 landing으로 보낸다.

## 9. Anti-Annoyance 검토

- 계정 생성 없이 방 참여 가능: 통과.
- 첫 방 생성 입력은 방 이름만 요구: 통과.
- 초대 링크 입장 후 nickname 없이 Quick Pixel부터 가능: 통과.
- 저장형 pixel allowance로 “쿨타임 때마다 접속해야 한다”는 부담을 줄임: 통과.
- 맵 크기/목표 시간/참여자 수로 allowance 속도를 계산해 하루를 넘기지 않는 프로젝트 pacing 가능: 통과.
- 고급 기능은 데이터 모델에는 열어두지만 MVP API/UX에서는 숨김: 통과.
- 단, owner actor 쿠키 분실 문제는 사용자 스트레스를 만들 수 있으므로 추후 계정 claim 또는 복구 링크 설계가 필요하다.

## 10. Self-review

- 방, 멤버, 초대, 일일 캔버스, 실시간 scope, 관리자 scope를 포함했다.
- 기존 `pixels`/`pixel_events` 중심 구조를 유지해 migration 위험을 낮췄다.
- 계정 없는 Quick Pixel 진입을 데이터 모델 수준에서 지원한다.
- 저장형 pixel allowance와 최대 저장 시간 cap을 데이터 모델에 반영했다.
- 동적 project pacing 계산에 필요한 target/participant/required pixel fields를 반영했다.
- replay와 admin 확장을 위한 canvas/day 경계를 명확히 했다.
- 구현 전 결정 사항을 별도 분리해 실제 구현 계획에서 다룰 수 있게 했다.

## File Path

`docs/product/preimplementation/03-room-daily-canvas-data-model.md`
