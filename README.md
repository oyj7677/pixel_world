# Pixel World

**Pixel World**는 친구들과 초대 링크로 같은 방에 들어가 픽셀을 찍는 실시간 협업 캔버스입니다.

2026-05-18 현재 구현된 MVP는 “방 만들기 → 초대 링크 공유 → 친구가 닉네임으로 입장 → 픽셀 찍기 → 방에서 함께 보기” 흐름에 집중합니다.

## 현재 상태 요약

- 첫 화면은 **방장 닉네임**과 **방 이름**만 입력해서 초대 링크를 만드는 구조입니다.
- 방장은 생성 직후 초대 링크를 복사하거나 `방 열기`로 바로 방에 들어갈 수 있습니다.
- 방에 들어간 뒤에도 상단의 **초대 주소 복사** 버튼으로 새 초대 주소를 만들고 복사할 수 있습니다.
- 초대받은 사람은 초대 링크에서 **내 닉네임**을 입력한 뒤 `퀵 픽셀 남기기`로 방에 참여합니다.
- 같은 브라우저로 다시 들어오면 기존 닉네임을 기억합니다.
- 같은 IP만 같을 때는 닉네임을 자동 적용하지 않고, 이전 닉네임을 **제안**만 합니다. 회사/학교처럼 같은 네트워크를 쓰는 사람도 각자 다른 닉네임으로 참여할 수 있습니다.
- 방 안에서는 실시간으로 픽셀 변경, 접속 상태, 최근 활동이 반영됩니다.
- 초기 MVP에서는 개발/운영 모두 픽셀을 시간 제한 없이 찍을 수 있습니다. 나중에 운영 정책이 필요해지면 환경값으로 시간 조건을 다시 켤 수 있습니다.

## 사람들이 사용하는 흐름

### 1. 방장이 방을 만든다

1. `http://localhost:3000` 접속
2. `방장 닉네임` 입력
3. `방 이름` 입력
4. `초대 링크 만들기` 클릭
5. 생성된 초대 링크를 친구에게 공유

### 2. 방장이 초대 링크를 놓쳤을 때

방 생성 후 바로 `방 열기`를 눌러 초대 링크를 복사하지 못했더라도 괜찮습니다.

1. 방 화면 상단의 `초대 주소 복사` 클릭
2. 새 초대 주소가 생성됨
3. 브라우저가 클립보드 복사를 허용하면 자동 복사됨
4. 복사가 차단되면 화면에 표시된 초대 주소를 직접 복사

> 기존 초대 토큰은 보안을 위해 해시로만 저장됩니다. 그래서 원래 초대 주소를 복원하지 않고, 방 멤버가 요청할 때 새 초대 주소를 발급합니다.

### 3. 친구가 초대 링크로 들어온다

1. `/invite/...` 형태의 초대 링크 접속
2. `내 닉네임` 입력
3. `퀵 픽셀 남기기` 클릭
4. `방으로 들어가기` 클릭
5. 방 캔버스에서 함께 픽셀을 찍음

### 4. 다른 브라우저나 시크릿 모드에서 들어갈 때

- `/r/...` 방 주소는 이미 방에 참여한 브라우저에서만 열립니다.
- 다른 브라우저, 시크릿 모드, 다른 기기는 먼저 `/invite/...` 초대 링크로 입장해야 합니다.
- 초대 링크에서 닉네임을 입력하고 퀵 픽셀을 남기면 그 브라우저도 방 멤버가 됩니다.

## 주요 기능

### 친구 방

- 방장 닉네임 + 방 이름으로 방 생성
- 초대 링크 발급
- 방 화면에서 새 초대 주소 발급 및 복사
- 초대받은 사람의 닉네임 필수 입력
- 같은 브라우저 닉네임 기억
- 같은 IP 닉네임 제안
- 방별 32×32 픽셀 캔버스
- 방별 실시간 픽셀 업데이트
- 방별 최근 활동 표시

### 픽셀 찍기

- 초대받은 사람은 입장 시 `퀵 픽셀`을 남깁니다.
- 방에 들어온 멤버는 캔버스에서 직접 픽셀을 찍을 수 있습니다.
- 초기 MVP에서는 시간 제한 없이 계속 찍을 수 있습니다.
- 나중에 운영용 정책이 필요하면 `PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT=false`로 전환해 저장 픽셀/시간 조건을 다시 켤 수 있습니다.

### 한국어 사용자 화면

사용자가 보는 주요 화면과 문구는 한국어로 구성되어 있습니다.

- 첫 화면
- 초대 링크 생성 결과
- 초대 입장 화면
- 닉네임 입력/제안 문구
- 방 화면 상태/버튼
- 오류/안내 문구

### 광고 위치

현재는 실제 광고 송출이 아니라 Google AdSense 배치를 고려한 자리만 잡아둔 상태입니다.

- 첫 화면의 초대 링크 생성 영역 아래에 광고 위치가 있습니다.
- 주요 사용 흐름을 방해하지 않도록 입력 폼보다 아래에 배치했습니다.

### 관리자 화면

`/admin`에서 관리자 기능을 사용할 수 있습니다.

현재 가능한 작업:

- 최근 픽셀 이벤트 확인
- 특정 최신 픽셀 복구
- 사각형 영역 초기화
- 관리 작업 기록 저장

## 로컬에서 실행하기

### 1. 환경 준비

```bash
cp .env.example .env
npm install
docker compose up -d db redis
npm run migrate
```

Docker Compose 플러그인이 없다면 아래 명령을 사용합니다.

```bash
docker-compose up -d db redis
```

`.env`에 필요한 값:

```text
DATABASE_URL=
COOKIE_SECRET=
ADMIN_PASSWORD=
IP_HASH_SECRET=
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT=true
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
```

### 2. 서버 실행

터미널 1:

```bash
npm run dev:server
```

터미널 2:

```bash
npm run dev:web
```

접속 주소:

```text
웹: http://localhost:3000
API 상태 확인: http://localhost:4000/health
관리자: http://localhost:3000/admin
```

## 다른 기기에서 테스트하기

같은 Wi-Fi의 휴대폰이나 다른 PC에서 접속할 때는 `localhost`를 쓰면 안 됩니다.

예를 들어 개발 PC의 내부 IP가 `192.168.0.25`라면 다음처럼 접속해야 합니다.

```text
http://192.168.0.25:3000
```

이 경우 환경값도 같은 주소 기준으로 맞추는 것이 좋습니다.

```text
WEB_ORIGIN=http://192.168.0.25:3000
NEXT_PUBLIC_API_URL=http://192.168.0.25:4000
```

환경값을 바꾼 뒤에는 서버와 웹을 다시 시작해야 합니다.

## 실제 배포 환경값

운영 배포를 준비할 때는 `.env.production.example`을 기준으로 호스팅 서비스의 환경 변수에 값을 넣습니다.

초기 MVP 정책은 **픽셀 시간 제한 없음**입니다. 따라서 운영에서도 아래 값을 유지합니다.

```text
PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT=true
```

나중에 시간 조건을 다시 켜려면 그때 아래처럼 바꿉니다.

```text
PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT=false
```

쿠키 설정은 배포 구조에 따라 다릅니다.

```text
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
```

- 웹과 API가 같은 사이트의 서브도메인이라면 `lax`를 사용합니다. 예: `pixel-world.example.com`, `api.pixel-world.example.com`
- 웹과 API가 서로 다른 등록 도메인이라면 `none`을 사용하고 `COOKIE_SECURE=true`를 유지합니다. 예: Vercel 기본 도메인 + Render 기본 도메인


## 주요 주소 구조

```text
/                       방 만들기
/invite/:inviteToken    초대받은 사람이 들어오는 화면
/r/:roomPublicId        방 멤버가 보는 캔버스 화면
/admin                  관리자 화면
```

주의:

- 친구에게는 `/r/...`가 아니라 `/invite/...` 초대 주소를 보내야 합니다.
- `/r/...`는 이미 해당 방에 참여한 브라우저에서만 열립니다.
- 방에 들어간 뒤에는 `초대 주소 복사`로 새 초대 주소를 다시 만들 수 있습니다.

## 개발 스크립트

```bash
npm run dev:server     # API / Socket.IO 서버 실행
npm run dev:web        # Next.js 웹 실행
npm run migrate        # DB 마이그레이션
npm run typecheck      # 전체 타입 검사
npm run test           # 단위/통합 테스트
npm run build          # 빌드 검사
npm run verify         # typecheck + test + build
npm run e2e            # Playwright 브라우저 테스트
npm run load:socket -- # Socket.IO 부하 테스트
```

## 기술 스택

- Web: Next.js, React, TypeScript
- Server: Fastify, Socket.IO, TypeScript
- Database: PostgreSQL
- Cache/State: Redis
- Test: Vitest, Playwright
- Local infra: Docker Compose

## 저장소 구조

```text
apps/web/          사용자 화면과 관리자 화면
apps/server/       API, 실시간 서버, DB 마이그레이션
apps/e2e/          Playwright E2E 테스트
packages/shared/   공통 타입, 정책, 이벤트 계약
docs/product/      제품 방향과 기획 문서
docs/superpowers/  설계/구현 계획 문서
```

## 검증 상태

최근 검증한 항목:

- 전체 타입 검사
- 서버/웹/공통 패키지 테스트
- 프로덕션 빌드
- Playwright E2E 테스트
- 방 화면에서 새 초대 주소 복사 후 다른 브라우저로 입장하는 수동 브라우저 스모크 테스트

기본 검증 명령:

```bash
npm run verify
npm run e2e
```

## 아직 운영 전 주의사항

현재 상태는 MVP 개발/검증 단계입니다.

운영 전에는 최소한 다음 항목을 다시 확인해야 합니다.

- 실제 도메인 기준 `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL` 설정
- HTTPS와 쿠키 정책
- 실제 AdSense Publisher ID와 Slot ID 연결
- 초기 MVP는 픽셀 시간 제한 없음으로 운영하고, 나중에 정책 변경 시 `PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT=false` 전환
- 관리자 비밀번호와 시크릿 교체
- 외부 접근 시 방화벽/포트/프록시 설정
- 운영 DB/Redis 백업 정책
- Next/PostCSS 보안 알림: 현재 `npm audit`가 Next 내부 PostCSS moderate 취약점을 보고하지만, 현재 Next 최신 버전에서도 자동 안전 수정이 없습니다. `npm audit fix --force`는 breaking downgrade를 제안하므로 적용하지 말고 Next 보안 패치가 나오면 업데이트합니다.

## 제품 방향

Pixel World의 현재 방향은 전역 공개 캔버스가 아니라 **친구들과 초대 링크로 방을 만들어 함께 완성하는 픽셀 방**입니다.

향후 확장 후보:

- 방 초대 관리
- 방장 권한 강화
- 완성 결과 공유 이미지
- 더 나은 모바일 UI
- 실제 광고 연동
- 픽셀 시간 조건/저장 픽셀 정책 운영화
