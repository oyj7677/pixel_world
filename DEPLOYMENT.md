# Pixel World 배포 가이드

이 문서는 Pixel World MVP를 실제 서비스 환경에 배포하기 위한 단계별 가이드입니다.

권장 배포 구성:

- **Web**: Vercel
- **API / Socket.IO 서버**: Render Web Service
- **Database**: Render PostgreSQL
- **Redis**: Render Key Value / Redis

초기 MVP 정책은 **픽셀 선택/찍기 시간제한 없음**입니다.

```text
PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT=true
```

---

## 0단계. 현재 전제 확인

현재 프로젝트는 GitHub 원격 저장소가 없을 수 있습니다.

```bash
git remote -v
```

아무것도 출력되지 않으면 아직 remote가 없는 상태입니다.

---

## 1단계. GitHub 저장소 만들고 push

GitHub에서 `pixel_world` 저장소를 만든 뒤, 로컬 프로젝트에서 아래 명령을 실행합니다.

```bash
git remote add origin https://github.com/내계정/pixel_world.git
git push -u origin main
```

주의:

- `.env` 파일은 절대 GitHub에 올리면 안 됩니다.
- 실제 운영 비밀번호, DB 주소, Redis 주소, 쿠키 시크릿은 호스팅 서비스의 환경 변수에만 넣습니다.

---

## 2단계. Render에서 PostgreSQL / Redis 만들기

Render Dashboard에서 아래 리소스를 생성합니다.

1. **New → PostgreSQL**
2. **New → Key Value / Redis**

생성 후 다음 연결 주소를 복사해 둡니다.

```text
DATABASE_URL=Render PostgreSQL 연결 주소
REDIS_URL=Render Redis 연결 주소
```

---

## 3단계. Render에 API 서버 배포

Render Dashboard에서:

1. **New → Web Service**
2. GitHub repository 연결
3. 아래 설정 입력

```text
Root Directory: 비워두기
Runtime: Node
Build Command: npm ci --include=dev && npm run build --workspace @pixel-world/server
Start Command: npm run start --workspace @pixel-world/server
```

`Root Directory`를 비워두는 이유:

- 이 프로젝트는 npm workspaces 기반 모노레포입니다.
- API 서버가 `packages/shared` 패키지를 함께 사용합니다.
- 저장소 루트에서 설치/빌드해야 workspace 의존성이 정상 연결됩니다.

### Render API 환경 변수

Render Web Service의 Environment Variables에 아래 값을 넣습니다.

```text
NODE_ENV=production
PORT=10000
WEB_ORIGIN=https://나중에-나올-vercel-url.vercel.app
DATABASE_URL=Render PostgreSQL 연결 주소
REDIS_URL=Render Redis 연결 주소
COOKIE_SECRET=긴 랜덤 문자열
ADMIN_PASSWORD=강한 관리자 비밀번호
IP_HASH_SECRET=긴 랜덤 문자열
PIXEL_ALLOWANCE_UNLIMITED_PLACEMENT=true
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

초기에는 Vercel 기본 도메인과 Render 기본 도메인이 서로 다른 사이트이므로 `COOKIE_SAME_SITE=none`을 권장합니다.

랜덤 문자열은 로컬 터미널에서 아래 명령으로 만들 수 있습니다.

```bash
openssl rand -base64 48
```

`COOKIE_SECRET`과 `IP_HASH_SECRET`은 서로 다른 값으로 만드는 것을 권장합니다.

---

## 4단계. DB 마이그레이션 실행

Render 유료 Web Service를 사용한다면 **Pre-Deploy Command**에 아래 명령을 넣습니다.

```text
npm run migrate --workspace @pixel-world/server
```

Pre-Deploy Command를 사용할 수 없다면 첫 배포 후 Render Shell에서 한 번 실행합니다.

```bash
npm run migrate --workspace @pixel-world/server
```

---

## 5단계. API 서버 상태 확인

Render API 주소가 예를 들어 아래와 같다면:

```text
https://pixel-world-api.onrender.com
```

터미널이나 브라우저에서 상태를 확인합니다.

```bash
curl https://pixel-world-api.onrender.com/health
```

정상 응답:

```json
{"ok":true}
```

---

## 6단계. Vercel에 Web 배포

Vercel Dashboard에서:

1. **Add New Project**
2. GitHub repository import
3. 아래 설정 입력

```text
Root Directory: apps/web
Framework Preset: Next.js
Build Command: npm run build
```

### Vercel Web 환경 변수

Vercel Project의 Environment Variables에 아래 값을 넣습니다.

```text
NEXT_PUBLIC_API_URL=https://pixel-world-api.onrender.com
```

여기서 `https://pixel-world-api.onrender.com`은 실제 Render API 주소로 바꿉니다.

### Vercel에서 shared 패키지를 못 찾는 경우

만약 Vercel 빌드 로그에서 `@pixel-world/shared`를 찾지 못한다는 오류가 나오면, Vercel Project Settings에서 아래 옵션을 켭니다.

```text
Include source files outside of the Root Directory
```

그 뒤 다시 배포합니다.

---

## 7단계. Vercel URL을 Render API에 다시 반영

Vercel 배포가 끝나면 Web URL이 생깁니다.

예:

```text
https://pixel-world.vercel.app
```

Render API 서버의 환경 변수에서 `WEB_ORIGIN`을 실제 Vercel URL로 바꿉니다.

```text
WEB_ORIGIN=https://pixel-world.vercel.app
```

변경 후 Render API 서버를 다시 배포합니다.

---

## 8단계. 실제 동작 확인

Vercel Web 주소에서 아래 흐름을 확인합니다.

1. Vercel 웹 주소 접속
2. `방장 닉네임` 입력
3. `방 이름` 입력
4. `초대 링크 만들기` 클릭
5. 초대 링크를 다른 브라우저 또는 시크릿 모드에서 열기
6. `내 닉네임` 입력
7. `퀵 픽셀 남기기` 클릭
8. `방으로 들어가기` 클릭
9. 방 화면에서 픽셀 여러 번 찍기

초기 MVP는 시간제한이 없으므로 픽셀이 바로 여러 번 찍혀야 합니다.

---

## 9단계. 관리자 화면 확인

관리자 화면:

```text
https://pixel-world.vercel.app/admin
```

확인할 항목:

- `ADMIN_PASSWORD`로 로그인 가능
- 최근 픽셀 이벤트 조회 가능
- 픽셀 복구 / 영역 초기화 기능 접근 가능

---

## 10단계. 커스텀 도메인을 붙이는 경우

나중에 아래처럼 같은 사이트의 서브도메인 구조로 배포하면:

```text
https://pixel-world.com
https://api.pixel-world.com
```

Render API 환경 변수를 아래처럼 바꿀 수 있습니다.

```text
WEB_ORIGIN=https://pixel-world.com
COOKIE_SAME_SITE=lax
COOKIE_SECURE=true
```

Vercel 기본 도메인과 Render 기본 도메인을 계속 쓴다면 `COOKIE_SAME_SITE=none`을 유지합니다.

---

## 11단계. 운영 배포 후 체크리스트

배포 후 아래 항목을 확인합니다.

- [ ] `https://API주소/health`가 `{"ok":true}`를 반환한다.
- [ ] Vercel Web 첫 화면이 열린다.
- [ ] 방을 만들 수 있다.
- [ ] 초대 링크가 생성된다.
- [ ] 다른 브라우저/시크릿 모드에서 초대 링크로 입장할 수 있다.
- [ ] 닉네임 입력 후 퀵 픽셀을 남길 수 있다.
- [ ] 방 화면에서 픽셀을 여러 번 찍을 수 있다.
- [ ] 실시간으로 다른 브라우저에 픽셀 변경이 반영된다.
- [ ] 방 화면에서 `초대 주소 복사`가 동작한다.
- [ ] `/admin` 로그인이 가능하다.

---

## 12단계. 현재 남은 배포 리스크

현재 `npm audit --audit-level=moderate`에서 Next 내부 `postcss <8.5.10` 취약점 경고가 남아 있습니다.

주의:

- `npm audit fix --force`는 breaking change를 만들 수 있으므로 적용하지 않습니다.
- Next에서 안전한 패치가 나오면 Next 버전을 업데이트해서 해결합니다.

---

## 참고 공식 문서

- Vercel Monorepos: https://vercel.com/docs/monorepos
- Vercel Build 설정: https://vercel.com/docs/builds/configure-a-build
- Render Node 배포: https://render.com/docs/deploy-node-express-app
- Render Deploy / Pre-Deploy Command: https://render.com/docs/deploys
- Render 환경 변수: https://render.com/docs/environment-variables
- Render Monorepo Support: https://render.com/docs/monorepo-support
