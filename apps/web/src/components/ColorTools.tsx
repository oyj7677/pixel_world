'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { DEFAULT_PALETTE, hexToRgb, normalizeHexColor, type HexColor } from '@pixel-world/shared';

const COMPLETE_HEX_INPUT = /^#?[0-9a-fA-F]{6}$/;

interface ColorToolsProps {
  selectedColor: HexColor;
  eyedropperColor: HexColor | null;
  onColorChange: (color: HexColor) => void;
}

export function ColorTools({ selectedColor, eyedropperColor, onColorChange }: ColorToolsProps) {
  const [draftColor, setDraftColor] = useState<string>(selectedColor);
  const [isEditing, setIsEditing] = useState(false);
  const selectedRgb = hexToRgb(selectedColor);
  const eyedropperRgb = eyedropperColor ? hexToRgb(eyedropperColor) : null;

  function chooseColor(rawColor: string) {
    const normalized = normalizeHexColor(rawColor);
    if (normalized) {
      onColorChange(normalized);
    }
  }

  useEffect(() => {
    if (!isEditing) {
      setDraftColor(selectedColor);
    }
  }, [isEditing, selectedColor]);

  return (
    <section className="panel" aria-label="색상 도구">
      <h2>색상 도구</h2>
      <div className="palette-grid">
        {DEFAULT_PALETTE.map((color) => (
          <button
            aria-label={`${color} 선택`}
            aria-pressed={selectedColor === color}
            className="palette-swatch"
            key={color}
            onClick={() => onColorChange(color)}
            style={{ backgroundColor: color }}
            type="button"
          />
        ))}
      </div>

      <div className="field-stack">
        <label htmlFor="selected-color">HEX 색상값</label>
        <input
          className="hex-input"
          id="selected-color"
          onBlur={() => {
            setIsEditing(false);
            const normalized = normalizeHexColor(draftColor);
            if (normalized) {
              setDraftColor(normalized);
              if (normalized !== selectedColor) {
                onColorChange(normalized);
              }
            } else {
              setDraftColor(selectedColor);
            }
          }}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraftColor(nextDraft);
            if (COMPLETE_HEX_INPUT.test(nextDraft)) {
              const normalized = normalizeHexColor(nextDraft);
              if (!normalized) {
                return;
              }
              onColorChange(normalized);
            }
          }}
          onFocus={() => setIsEditing(true)}
          spellCheck={false}
          value={draftColor}
        />
      </div>

      <div className="custom-color-card">
        <label htmlFor="custom-color">직접 색상 선택</label>
        <div className="custom-color-row">
          <input
            aria-label="직접 색상 선택"
            className="custom-color-input"
            id="custom-color"
            onChange={(event) => chooseColor(event.target.value)}
            type="color"
            value={selectedColor}
          />
          <div className="selected-color-preview" style={{ '--selected-color': selectedColor } as CSSProperties}>
            <span>선택한 색상 {selectedColor}</span>
            {selectedRgb ? (
              <small>
                RGB {selectedRgb.r}, {selectedRgb.g}, {selectedRgb.b}
              </small>
            ) : null}
          </div>
        </div>
      </div>

      <div className="eyedropper-card">
        <span className="eyedropper-label">스포이드</span>
        <span className="eyedropper-value">{eyedropperColor ?? '픽셀을 선택하세요'}</span>
        {eyedropperRgb ? (
          <span className="rgb-value">
            RGB {eyedropperRgb.r}, {eyedropperRgb.g}, {eyedropperRgb.b}
          </span>
        ) : null}
      </div>
    </section>
  );
}
