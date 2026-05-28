'use client';

import { type ChangeEvent, useMemo, useState } from 'react';
import {
  ROOM_PIXEL_TEMPLATE_MAX_NAME_LENGTH,
  type HexColor,
  type RoomPixelTemplateDto,
  type RoomPixelTemplatePixelDto,
  type SaveRoomPixelTemplateRequestDto
} from '@pixel-world/shared';
import { pixelizeImageFile, type PixelizedTemplateDraft } from '../lib/imagePixelizer';
import { saveRoomPixelTemplate } from '../lib/roomApi';

type TemplatePreviewSource = Pick<
  RoomPixelTemplateDto,
  'name' | 'width' | 'height' | 'defaultColorHex' | 'pixels'
>;

interface RoomPixelTemplatePanelProps {
  roomPublicId: string;
  canvasWidth: number;
  canvasHeight: number;
  defaultColorHex: HexColor;
  template: RoomPixelTemplateDto | null;
  isOwner: boolean;
  onTemplateSaved: (template: RoomPixelTemplateDto) => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
}

function fileNameToTemplateName(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').trim();
  return (name || '공유 샘플').slice(0, ROOM_PIXEL_TEMPLATE_MAX_NAME_LENGTH);
}

function pixelsToCells(template: TemplatePreviewSource): HexColor[] {
  const cells = Array<HexColor>(template.width * template.height).fill(template.defaultColorHex);

  for (const pixel of template.pixels) {
    if (pixel.x < 0 || pixel.x >= template.width || pixel.y < 0 || pixel.y >= template.height) {
      continue;
    }
    cells[pixel.y * template.width + pixel.x] = pixel.colorHex;
  }

  return cells;
}

function PixelTemplatePreview({
  template,
  label,
  large = false,
}: {
  template: TemplatePreviewSource;
  label: string;
  large?: boolean;
}) {
  const cells = useMemo(() => pixelsToCells(template), [template]);

  return (
    <div
      className={`pixel-template-preview${large ? ' pixel-template-preview--large' : ''}`}
      role="img"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${template.width}, minmax(0, 1fr))` }}
    >
      {cells.map((color, index) => (
        <span className="pixel-template-cell" key={`${label}-${index}`} style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

function toSavePayload(draft: PixelizedTemplateDraft, name: string): SaveRoomPixelTemplateRequestDto {
  return {
    name,
    width: draft.width,
    height: draft.height,
    defaultColorHex: draft.defaultColorHex,
    pixels: draft.pixels,
  };
}

export function RoomPixelTemplatePanel({
  roomPublicId,
  canvasWidth,
  canvasHeight,
  defaultColorHex,
  template,
  isOwner,
  onTemplateSaved,
  onStatus,
  onError,
}: RoomPixelTemplatePanelProps) {
  const [draft, setDraft] = useState<(PixelizedTemplateDraft & { name: string }) | null>(null);
  const [isPixelizing, setIsPixelizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isLargeOpen, setIsLargeOpen] = useState(false);
  const activeTemplate = draft ?? template;
  const activeTemplateLabel = draft ? `${draft.name} 저장 전 픽셀 샘플` : template ? `${template.name} 공유 픽셀 샘플` : '';

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }

    setLocalError(null);
    setDraft(null);
    setIsPixelizing(true);

    try {
      const pixelized = await pixelizeImageFile(file, {
        targetWidth: canvasWidth,
        targetHeight: canvasHeight,
        defaultColorHex,
      });
      setDraft({
        ...pixelized,
        name: fileNameToTemplateName(file.name),
      });
    } catch {
      const message = '이미지를 픽셀 샘플로 바꾸지 못했어요.';
      setLocalError(message);
      onError?.(message);
    } finally {
      setIsPixelizing(false);
    }
  };

  const handleSave = async () => {
    if (!draft || isSaving) {
      return;
    }

    setIsSaving(true);
    setLocalError(null);
    try {
      const response = await saveRoomPixelTemplate(roomPublicId, toSavePayload(draft, draft.name));
      setDraft(null);
      onTemplateSaved(response.template);
      onStatus?.('공유 샘플을 저장했어요.');
    } catch {
      const message = '공유 샘플을 저장하지 못했어요.';
      setLocalError(message);
      onError?.(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="panel pixel-template-panel" aria-labelledby="pixel-template-panel-heading">
      <div className="pixel-template-panel__header">
        <div>
          <h2 id="pixel-template-panel-heading">공유 샘플</h2>
          <span>{draft ? '저장 전 미리보기' : template ? template.name : '비어 있음'}</span>
        </div>
        {activeTemplate ? (
          <button className="secondary-link pixel-template-panel__small-action" type="button" onClick={() => setIsLargeOpen(true)}>
            크게 보기
          </button>
        ) : null}
      </div>

      {activeTemplate ? (
        <PixelTemplatePreview template={activeTemplate} label={activeTemplateLabel} />
      ) : (
        <div className="pixel-template-empty" aria-live="polite">
          아직 공유 샘플이 없어요.
        </div>
      )}

      {localError ? (
        <p className="pixel-template-message pixel-template-message--error" role="alert">
          {localError}
        </p>
      ) : null}

      {isOwner ? (
        <div className="pixel-template-actions">
          <label className={`secondary-link pixel-template-file-button${isPixelizing ? ' pixel-template-file-button--busy' : ''}`}>
            {isPixelizing ? '변환 중…' : '이미지 선택'}
            <input
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={isPixelizing || isSaving}
              onChange={handleFileChange}
            />
          </label>
          <button
            className="secondary-link"
            type="button"
            disabled={!draft || isSaving || isPixelizing}
            onClick={handleSave}
          >
            {isSaving ? '저장 중…' : '샘플 저장'}
          </button>
        </div>
      ) : null}

      {isLargeOpen && activeTemplate ? (
        <div className="pixel-template-modal" role="dialog" aria-modal="true" aria-labelledby="pixel-template-modal-heading">
          <div className="pixel-template-modal__surface">
            <div className="pixel-template-modal__header">
              <h2 id="pixel-template-modal-heading">{activeTemplate.name}</h2>
              <button className="secondary-link" type="button" onClick={() => setIsLargeOpen(false)}>
                닫기
              </button>
            </div>
            <PixelTemplatePreview template={activeTemplate} label={`${activeTemplate.name} 크게 보기`} large />
          </div>
        </div>
      ) : null}
    </section>
  );
}
