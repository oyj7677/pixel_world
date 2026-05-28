# 11. Image to Pixel Import 기술 설계

작성일: 2026-05-28  
상태: 구현 전 기술 설계  
범위: 사용자가 업로드한 이미지를 현재 방 캔버스 크기에 맞는 픽셀 샘플/템플릿으로 변환

## 1. 결론

기술적으로 가능하다.

권장 MVP는 원본 이미지를 서버에 업로드/저장하지 않고 브라우저에서만 처리하는 방식이다. 사용자가 선택한 이미지 파일을 클라이언트 `<canvas>`로 읽고, 현재 방 캔버스 크기인 16~64 범위로 축소한 뒤 Pixel World 팔레트에 맞춰 색상을 양자화한다. 결과는 “샘플 화면” 또는 “따라 그리기 템플릿”으로 먼저 보여준다.

즉시 모든 픽셀을 방 캔버스에 일괄 적용하는 기능은 가능하지만 Phase 1 MVP로는 권장하지 않는다. 현재 제품은 친구들이 직접 픽셀을 채우는 흐름과 saved pixel allowance를 중심으로 설계되어 있으므로, 첫 단계는 이미지 변환 결과를 참고 자료로 제공하고 실제 칠하기는 사용자가 수행하는 것이 안전하다.

## 2. 제품 목표

빈 캔버스 앞에서 사용자가 무엇을 그릴지 몰라 멈추는 문제를 줄인다.

주요 사용자 가치:

- 내가 가진 사진이나 그림을 픽셀 샘플로 빠르게 변환한다.
- 현재 방 크기에 맞는 48×48, 56×56, 64×64 픽셀 가이드를 얻는다.
- 친구들과 같은 목표 이미지를 보고 자연스럽게 나눠 칠할 수 있다.
- 원본 이미지를 서버에 남기지 않아도 된다.

## 3. 단계별 범위

### Phase A: 로컬 픽셀 샘플 변환

포함:

- 방 화면에서 이미지 파일 선택
- PNG/JPEG/WebP 입력
- 현재 캔버스 크기에 맞게 crop 또는 contain 변환
- Pixel World 팔레트로 색상 변환
- 변환 결과를 샘플 화면 패널에 표시
- 원본 이미지 서버 업로드 없음

제외:

- 변환 결과 서버 저장
- 친구에게 템플릿 공유
- 일괄 캔버스 적용
- AI 이미지 생성/보정

### Phase B: 방 템플릿 공유

포함:

- 변환된 픽셀 템플릿만 서버 저장
- 원본 이미지 저장 금지
- 방 멤버가 같은 템플릿을 볼 수 있음
- 템플릿 삭제/교체

### Phase C: 캔버스에 적용

포함 후보:

- 사용자가 선택한 일부 영역만 적용
- 저장된 픽셀 수를 소모하며 여러 픽셀 배치
- 방장/admin 전용 “초기 밑그림 채우기”

주의:

- 모든 픽셀을 즉시 채우면 협업 게임성이 사라질 수 있다.
- allowance와 이벤트 로그를 우회하면 안 된다.
- 수천 개 socket event를 한 번에 보내면 서버와 클라이언트가 흔들릴 수 있다.

## 4. 권장 UX

방 화면 사이드바에 “이미지로 샘플 만들기” 패널을 추가한다.

흐름:

1. 사용자가 이미지 파일을 선택한다.
2. 브라우저에서 미리보기 이미지를 생성한다.
3. 사용자가 맞춤 방식을 선택한다.
   - 꽉 채우기: cover crop
   - 전체 넣기: contain padding
4. 팔레트 방식을 선택한다.
   - 현재 팔레트에 맞추기
   - 원본 색 유지에 가깝게 맞추기
5. 16~64 캔버스 크기에 맞춘 픽셀 샘플을 표시한다.
6. 사용자는 샘플을 보면서 실제 캔버스에 칠한다.

추가 UI:

- 변환 전/후 비교
- 색상 수 표시
- “샘플 숨기기”
- “다른 이미지 선택”
- “이 샘플을 방에 공유” 버튼은 Phase B에서 추가

## 5. 클라이언트 처리 구조

신규 모듈:

```text
apps/web/src/lib/imagePixelizer.ts
apps/web/src/components/ImagePixelizerPanel.tsx
apps/web/test/imagePixelizer.test.ts
apps/web/test/imagePixelizerPanel.test.tsx
```

핵심 타입:

```ts
interface PixelizedImage {
  width: number;
  height: number;
  defaultColorHex: HexColor;
  pixels: Array<{
    x: number;
    y: number;
    colorHex: HexColor;
  }>;
  paletteUsage: Array<{
    colorHex: HexColor;
    count: number;
  }>;
}
```

권장 함수:

```ts
async function pixelizeImageFile(input: {
  file: File;
  width: number;
  height: number;
  defaultColorHex: HexColor;
  palette: HexColor[];
  fit: 'cover' | 'contain';
  transparentColor?: HexColor;
}): Promise<PixelizedImage>
```

## 6. 변환 알고리즘

### 6.1 파일 읽기

권장 순서:

1. 파일 MIME type 확인
2. 파일 크기 제한 확인
3. `createImageBitmap(file)` 사용
4. fallback으로 `HTMLImageElement + URL.createObjectURL`

초기 제한:

- 파일 크기: 10MB 이하
- 원본 가로/세로: 4096px 이하 권장
- 허용 타입: `image/png`, `image/jpeg`, `image/webp`
- SVG는 Phase A에서 제외

### 6.2 리사이즈

브라우저 offscreen `<canvas>`에 현재 방 캔버스 크기로 그린다.

```text
targetWidth = today.canvasSize.width
targetHeight = today.canvasSize.height
```

fit 모드:

- cover: 중앙 crop 후 꽉 채움
- contain: 전체 이미지를 넣고 남는 영역은 default canvas color

### 6.3 픽셀 샘플링

리사이즈된 canvas에서 `getImageData(0, 0, width, height)`를 읽는다.

투명도 처리:

- alpha < 128이면 `defaultColorHex`
- alpha >= 128이면 RGB 변환 대상

### 6.4 팔레트 양자화

Pixel World 기본 팔레트에 가장 가까운 색상을 선택한다.

기본 거리 계산:

```text
distance = (r1-r2)^2 + (g1-g2)^2 + (b1-b2)^2
```

Phase A에서는 단순 RGB 거리로 충분하다.

Phase B 이후 개선 후보:

- perceptual distance
- CIELAB 기반 거리
- Floyd-Steinberg dithering
- 색상 수 제한 슬라이더

### 6.5 결과 압축

UI 미리보기용으로는 모든 cell을 배열로 들고 있어도 된다. 최대 64×64 = 4096개라 브라우저 메모리 부담이 낮다.

서버 저장이 필요해지는 Phase B에서는 default color와 다른 픽셀만 저장한다.

```json
{
  "width": 48,
  "height": 48,
  "defaultColorHex": "#FFFFFF",
  "pixels": [
    { "x": 12, "y": 8, "colorHex": "#38BDF8" }
  ]
}
```

## 7. 서버/API 설계

### Phase A

서버 API 없음.

장점:

- 원본 이미지 개인정보 위험이 낮다.
- Vercel/Render 업로드 제한과 스토리지 비용을 피한다.
- 구현 범위가 작다.
- 오프라인에 가까운 즉시 미리보기가 가능하다.

### Phase B

템플릿 공유를 원하면 변환 결과만 저장한다.

제안 API:

```text
POST /api/rooms/:roomPublicId/templates
GET  /api/rooms/:roomPublicId/templates/current
DELETE /api/rooms/:roomPublicId/templates/:templateId
```

`POST` body:

```json
{
  "name": "고양이 샘플",
  "width": 48,
  "height": 48,
  "defaultColorHex": "#FFFFFF",
  "pixels": [
    { "x": 10, "y": 12, "colorHex": "#0F172A" }
  ]
}
```

권한:

- 방장 또는 방 멤버만 생성 가능
- 초대 토큰/입장 코드로 접근한 사용자는 현재 방 권한 정책을 따른다.
- 원본 이미지 파일은 받지 않는다.

### Phase C

일괄 적용 API는 별도 검토가 필요하다.

후보:

```text
POST /api/rooms/:roomPublicId/import-pixels
```

정책 질문:

- 적용 주체가 누구인가?
- 적용 픽셀 수만큼 saved allowance를 소모할 것인가?
- 방장만 가능한가?
- pixel_events에 한 픽셀씩 기록할 것인가, batch event를 둘 것인가?
- 기존 픽셀을 덮어쓸 수 있는가?

권장: Phase C 전에는 “미리보기/따라 그리기” 데이터와 “실제 캔버스 상태”를 분리한다.

## 8. 데이터 모델

Phase A는 데이터 모델 변경 없음.

Phase B 후보:

```sql
CREATE TABLE room_pixel_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id),
  daily_canvas_id UUID REFERENCES daily_canvases(id),
  created_by_actor_key TEXT NOT NULL,
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  default_color_hex TEXT NOT NULL,
  pixels JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

인덱스:

```sql
CREATE INDEX room_pixel_templates_room_active_idx
ON room_pixel_templates(room_id, created_at DESC)
WHERE deleted_at IS NULL;
```

저장하지 말 것:

- 원본 이미지 바이너리
- 원본 파일명
- EXIF metadata
- 위치 정보

## 9. 보안/개인정보

이미지는 얼굴, 위치, 문서, 화면 캡처 등 민감정보를 포함할 수 있다.

Phase A 원칙:

- 파일은 서버에 전송하지 않는다.
- EXIF를 읽거나 저장하지 않는다.
- Object URL은 사용 후 revoke한다.
- 변환 결과도 사용자가 새로고침하면 사라지는 local UI state로 둔다.

Phase B 원칙:

- 원본 이미지는 절대 저장하지 않는다.
- 변환된 픽셀 배열만 저장한다.
- 템플릿 이름은 사용자가 직접 입력하지 않으면 자동 기본값을 쓴다.
- analytics에는 이미지 내용, 파일명, 색상 배열을 남기지 않는다.

## 10. 성능

현재 최대 캔버스가 64×64이므로 변환 비용은 작다.

병목 후보:

- 큰 원본 이미지를 디코딩할 때 메모리 사용
- 모바일 Safari에서 큰 이미지 디코딩 지연
- `getImageData` 호출

대응:

- 파일 크기와 원본 크기 제한
- 처리 중 버튼 disabled
- 변환 실패 시 안전한 에러 메시지
- 필요 시 Web Worker로 이동

Phase A에서는 메인 스레드 처리로 충분할 가능성이 높다.

## 11. 테스트 계획

### Unit

- `cover` crop 좌표 계산
- `contain` padding 좌표 계산
- alpha 투명도 처리
- 가장 가까운 팔레트 색상 선택
- 허용되지 않는 MIME type reject
- 너무 큰 파일 reject
- 48×48 입력 결과가 2304 cell 이하로 정상 생성

### Component

- 이미지 선택 전 empty state
- 변환 중 loading state
- 변환 성공 후 샘플 그리드 표시
- 다른 이미지 선택
- 잘못된 파일 타입 오류

### E2E

- 방 생성
- 이미지 업로드
- 픽셀 샘플 생성
- 샘플을 보면서 픽셀 하나 칠하기
- 새로고침 후 Phase A 샘플은 사라지고 실제 캔버스 픽셀은 유지

## 12. 구현 순서

1. `imagePixelizer.ts` 순수 함수 작성
2. 테스트용 작은 PNG fixture 생성 또는 canvas 기반 synthetic image test 작성
3. `ImagePixelizerPanel` 컴포넌트 추가
4. `RoomCanvasShell` 사이드바에 패널 배치
5. 변환 결과를 기존 `PixelSampleGallery`와 같은 렌더링 방식으로 표시
6. 웹 테스트 추가
7. Playwright로 방 화면 수동/자동 스모크 확인

## 13. 수용 기준

- 사용자가 PNG/JPEG/WebP 이미지를 선택할 수 있다.
- 원본 이미지는 서버로 전송되지 않는다.
- 현재 방 캔버스 크기에 맞는 픽셀 샘플이 생성된다.
- 변환 결과는 Pixel World 팔레트 색상만 사용한다.
- 투명 픽셀은 기본 캔버스 색상으로 처리된다.
- 변환 실패 시 앱이 깨지지 않고 오류 메시지를 보여준다.
- 샘플은 실제 캔버스를 자동으로 덮어쓰지 않는다.

## 14. 열린 결정

- MVP에서 cover와 contain 중 어떤 모드를 기본값으로 둘 것인가?
- 색상 변환에 dithering을 처음부터 넣을 것인가?
- 방장만 템플릿을 공유할 수 있게 할 것인가, 모든 멤버에게 허용할 것인가?
- 변환 결과를 “샘플 화면”으로만 둘 것인가, 캔버스 위 ghost overlay로도 보여줄 것인가?
- Phase C의 일괄 적용은 제품 방향과 맞는가?

## 15. 최종 권장안

먼저 Phase A만 구현한다.

이유:

- 현재 코드 구조와 잘 맞는다.
- 서버/DB 변경 없이 빠르게 검증할 수 있다.
- 개인정보 위험이 낮다.
- “빈 캔버스에서 무엇을 그릴지 모르겠다”는 문제를 직접 해결한다.
- 협업 픽셀 배치의 재미를 망치지 않는다.

Phase A가 실제로 사용되면, 다음 단계에서 변환 결과를 방 멤버와 공유하는 Phase B를 추가한다. 일괄 적용인 Phase C는 abuse, allowance, 이벤트 로그 정책을 별도 제품 결정으로 통과한 뒤에만 진행한다.
