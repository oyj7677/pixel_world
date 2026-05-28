import { DEFAULT_CANVAS_COLOR, type HexColor, type SaveRoomPixelTemplateRequestDto } from '@pixel-world/shared';

interface PixelSample {
  name: string;
  rows: string[];
  palette: Record<string, HexColor>;
}

interface PixelSampleGalleryProps {
  canvasWidth?: number;
  canvasHeight?: number;
  defaultColorHex?: HexColor;
  isSaving?: boolean;
  onSampleSelect?: (template: SaveRoomPixelTemplateRequestDto) => void;
}

const samples: PixelSample[] = [
  {
    name: '하트',
    rows: [
      '............',
      '....RR.RR...',
      '...RRRRRRR..',
      '..RRRRRRRRR.',
      '..RRRRRRRRR.',
      '...RRRRRRR..',
      '....RRRRR...',
      '.....RRR....',
      '......R.....',
      '............',
      '............',
      '............'
    ],
    palette: {
      '.': '#FFFFFF',
      R: '#FB7185'
    }
  },
  {
    name: '스마일',
    rows: [
      '..YYYYYYYY..',
      '.YYYYYYYYYY.',
      'YYYYYYYYYYYY',
      'YYBBYYYYBBYY',
      'YYBBYYYYBBYY',
      'YYYYYYYYYYYY',
      'YYYYYYYYYYYY',
      'YYBYYYYYYBYY',
      'YYYBBBBBBYYY',
      'YYYYYYYYYYYY',
      '.YYYYYYYYYY.',
      '..YYYYYYYY..'
    ],
    palette: {
      '.': '#FFFFFF',
      B: '#0F172A',
      Y: '#FACC15'
    }
  },
  {
    name: '작은 집',
    rows: [
      'SSSSSSSSSSSS',
      'SSSSSSSSSSSS',
      'SSSSSRRSSSSS',
      'SSSSRRRRSSSS',
      'SSSRRRRRRSSS',
      'SSRRRRRRRRSS',
      'SSSHHHHHHSSS',
      'SSSHHDHHHSSS',
      'SSSHHDHHHSSS',
      'GGGGGGGGGGGG',
      'GGGGGGGGGGGG',
      'GGGGGGGGGGGG'
    ],
    palette: {
      D: '#8B5CF6',
      G: '#22C55E',
      H: '#E2E8F0',
      R: '#F97316',
      S: '#38BDF8'
    }
  }
];

function sampleCells(sample: PixelSample): HexColor[] {
  return sample.rows.flatMap((row) =>
    Array.from(row, (key) => sample.palette[key] ?? '#FFFFFF')
  );
}

function sampleColor(sample: PixelSample, key: string, defaultColorHex: HexColor): HexColor {
  return key === '.' ? defaultColorHex : sample.palette[key] ?? defaultColorHex;
}

export function pixelSampleToTemplatePayload(
  sample: PixelSample,
  targetWidth: number,
  targetHeight: number,
  defaultColorHex: HexColor
): SaveRoomPixelTemplateRequestDto {
  const sampleWidth = sample.rows[0]?.length ?? 0;
  const sampleHeight = sample.rows.length;
  if (sampleWidth <= 0 || sampleHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return {
      name: `${sample.name} 샘플`,
      width: targetWidth,
      height: targetHeight,
      defaultColorHex,
      pixels: [],
    };
  }

  const scale = Math.max(1, Math.floor(Math.min(targetWidth / sampleWidth, targetHeight / sampleHeight)));
  const scaledWidth = sampleWidth * scale;
  const scaledHeight = sampleHeight * scale;
  const offsetX = Math.floor((targetWidth - scaledWidth) / 2);
  const offsetY = Math.floor((targetHeight - scaledHeight) / 2);
  const pixels: SaveRoomPixelTemplateRequestDto['pixels'] = [];

  for (const [rowIndex, row] of sample.rows.entries()) {
    for (const [columnIndex, key] of Array.from(row).entries()) {
      const colorHex = sampleColor(sample, key, defaultColorHex);
      if (colorHex === defaultColorHex) {
        continue;
      }

      for (let yScale = 0; yScale < scale; yScale += 1) {
        for (let xScale = 0; xScale < scale; xScale += 1) {
          const x = offsetX + columnIndex * scale + xScale;
          const y = offsetY + rowIndex * scale + yScale;
          if (x < 0 || x >= targetWidth || y < 0 || y >= targetHeight) {
            continue;
          }

          pixels.push({
            x,
            y,
            colorHex,
          });
        }
      }
    }
  }

  return {
    name: `${sample.name} 샘플`,
    width: targetWidth,
    height: targetHeight,
    defaultColorHex,
    pixels,
  };
}

export function PixelSampleGallery({
  canvasWidth = 48,
  canvasHeight = 48,
  defaultColorHex = DEFAULT_CANVAS_COLOR,
  isSaving = false,
  onSampleSelect,
}: PixelSampleGalleryProps) {
  const handleSampleSelect = (sample: PixelSample) => {
    onSampleSelect?.(pixelSampleToTemplatePayload(sample, canvasWidth, canvasHeight, defaultColorHex));
  };

  return (
    <section className="panel pixel-sample-gallery" aria-labelledby="pixel-sample-gallery-heading">
      <h2 id="pixel-sample-gallery-heading">샘플 화면</h2>
      <div className="pixel-sample-list">
        {samples.map((sample) => (
          <figure className="pixel-sample" key={sample.name}>
            {onSampleSelect ? (
              <button
                className="pixel-sample-button"
                type="button"
                disabled={isSaving}
                aria-label={`${sample.name} 샘플 화면 공유 샘플로 등록`}
                onClick={() => handleSampleSelect(sample)}
              >
                <span
                  className="pixel-sample-grid"
                  role="img"
                  aria-label={`${sample.name} 샘플 화면`}
                  style={{ gridTemplateColumns: `repeat(${sample.rows[0]?.length ?? 0}, minmax(0, 1fr))` }}
                >
                  {sampleCells(sample).map((color, index) => (
                    <span className="pixel-sample-cell" key={`${sample.name}-${index}`} style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="pixel-sample-caption">{isSaving ? '등록 중…' : sample.name}</span>
              </button>
            ) : (
              <>
                <div
                  className="pixel-sample-grid"
                  role="img"
                  aria-label={`${sample.name} 샘플 화면`}
                  style={{ gridTemplateColumns: `repeat(${sample.rows[0]?.length ?? 0}, minmax(0, 1fr))` }}
                >
                  {sampleCells(sample).map((color, index) => (
                    <span className="pixel-sample-cell" key={`${sample.name}-${index}`} style={{ backgroundColor: color }} />
                  ))}
                </div>
                <figcaption>{sample.name}</figcaption>
              </>
            )}
          </figure>
        ))}
      </div>
    </section>
  );
}
