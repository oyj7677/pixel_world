'use client';

import {
  DEFAULT_CANVAS_COLOR,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  normalizeHexColor,
  type HexColor,
  type RecentPixelEvent
} from '@pixel-world/shared';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const RESET_CONFIRMATION = '초기화';

interface AreaFormState {
  fromX: string;
  fromY: string;
  toX: string;
  toY: string;
  colorHex: string;
  reason: string;
  confirmation: string;
}

interface AreaBounds {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

const INITIAL_AREA_FORM: AreaFormState = {
  fromX: '',
  fromY: '',
  toX: '',
  toY: '',
  colorHex: DEFAULT_CANVAS_COLOR,
  reason: '',
  confirmation: ''
};

const MODERATION_REASONS = [
  { value: 'spam', label: '스팸 / 광고' },
  { value: 'abuse', label: '욕설 또는 혐오 표현' },
  { value: 'sexual', label: '성적 콘텐츠' },
  { value: 'personal_info', label: '개인정보' },
  { value: 'other', label: '기타 관리 정리' }
] as const;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

function isCoordinateInCanvas(x: number, y: number): boolean {
  return x >= 0 && x < DEFAULT_CANVAS_WIDTH && y >= 0 && y < DEFAULT_CANVAS_HEIGHT;
}

function parseAreaBounds(form: AreaFormState): AreaBounds | null {
  const fromX = parseInteger(form.fromX);
  const fromY = parseInteger(form.fromY);
  const toX = parseInteger(form.toX);
  const toY = parseInteger(form.toY);

  if (fromX === null || fromY === null || toX === null || toY === null) {
    return null;
  }

  if (!isCoordinateInCanvas(fromX, fromY) || !isCoordinateInCanvas(toX, toY)) {
    return null;
  }

  const minX = Math.min(fromX, toX);
  const maxX = Math.max(fromX, toX);
  const minY = Math.min(fromY, toY);
  const maxY = Math.max(fromY, toY);

  return {
    fromX,
    fromY,
    toX,
    toY,
    minX,
    maxX,
    minY,
    maxY,
    count: (maxX - minX + 1) * (maxY - minY + 1)
  };
}

function formatAreaSummary(areaBounds: AreaBounds | null): string {
  if (!areaBounds) {
    return `0부터 ${DEFAULT_CANVAS_WIDTH - 1} 사이 좌표를 입력하세요`;
  }

  return `${areaBounds.count}개 픽셀 선택됨`;
}

export function AdminPanel() {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [events, setEvents] = useState<RecentPixelEvent[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [areaForm, setAreaForm] = useState<AreaFormState>(INITIAL_AREA_FORM);

  const areaBounds = parseAreaBounds(areaForm);
  const resetColor = normalizeHexColor(areaForm.colorHex);
  const trimmedReason = areaForm.reason.trim();
  const areaResetReady =
    areaBounds !== null &&
    resetColor !== null &&
    trimmedReason.length > 0 &&
    areaForm.confirmation === RESET_CONFIRMATION;

  function setReadableError(error: unknown) {
    setMessage(error instanceof Error ? error.message : '관리자 작업에 실패했습니다');
  }

  function updateAreaField(field: keyof AreaFormState, value: string) {
    setAreaForm((current) => ({ ...current, [field]: value }));
  }

  async function login() {
    setLoading(true);
    try {
      await api<{ ok: true }>('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      setLoggedIn(true);
      setPassword('');
      setMessage('관리자 세션이 활성화되었습니다');
    } catch (error) {
      setReadableError(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadEvents() {
    setLoading(true);
    try {
      const data = await api<{ events: RecentPixelEvent[] }>('/admin/events');
      setEvents(data.events);
    } catch (error) {
      setReadableError(error);
    } finally {
      setLoading(false);
    }
  }

  async function restoreFirstEventToDefault() {
    const first = events[0];

    if (!first) {
      setMessage('복구할 최근 이벤트가 없습니다');
      return;
    }

    setLoading(true);
    try {
      await api<{ event: RecentPixelEvent }>('/admin/restore/pixel', {
        method: 'POST',
        body: JSON.stringify({ x: first.x, y: first.y, colorHex: DEFAULT_CANVAS_COLOR })
      });
      setMessage(`${first.x},${first.y} 픽셀을 ${DEFAULT_CANVAS_COLOR}로 복구했습니다`);
      await loadEvents();
    } catch (error) {
      setReadableError(error);
    } finally {
      setLoading(false);
    }
  }

  async function restoreAreaToColor() {
    if (!areaBounds || !resetColor || !trimmedReason) {
      setMessage('유효한 영역, 초기화 색상, 사유, 확인 문구를 먼저 입력하세요');
      return;
    }

    setLoading(true);
    try {
      await api<{ events: RecentPixelEvent[] }>('/admin/restore/area', {
        method: 'POST',
        body: JSON.stringify({
          fromX: areaBounds.fromX,
          fromY: areaBounds.fromY,
          toX: areaBounds.toX,
          toY: areaBounds.toY,
          colorHex: resetColor,
          reason: trimmedReason
        })
      });
      setMessage(`${areaBounds.count}개 픽셀을 ${resetColor}로 초기화했습니다`);
      setAreaForm((current) => ({ ...current, confirmation: '' }));
    } catch (error) {
      setReadableError(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <header className="header">
        <div className="brand">
          <strong>관리자</strong>
          <span>운영 도구</span>
        </div>
      </header>

      <section className="panel admin-panel" aria-label="관리 도구">
        {message ? (
          <p className="admin-status" aria-live="polite" role="status">
            {message}
          </p>
        ) : null}
        {!loggedIn ? (
          <>
            <label className="admin-field" htmlFor="admin-password">
              비밀번호
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="button" onClick={login} disabled={loading}>
              로그인
            </button>
          </>
        ) : (
          <>
            <section className="admin-tool-card" aria-labelledby="area-reset-title">
              <div>
                <h2 id="area-reset-title">영역 초기화</h2>
                <p className="admin-help">
                  운영 정책에 따라 사각형 영역을 초기화합니다. 서버 제한은 그대로 적용됩니다.
                </p>
              </div>

              <div className="admin-coordinate-grid">
                <label className="admin-field" htmlFor="admin-area-from-x">
                  시작 X
                  <input
                    id="admin-area-from-x"
                    inputMode="numeric"
                    min={0}
                    max={DEFAULT_CANVAS_WIDTH - 1}
                    type="number"
                    value={areaForm.fromX}
                    onChange={(event) => updateAreaField('fromX', event.target.value)}
                  />
                </label>
                <label className="admin-field" htmlFor="admin-area-from-y">
                  시작 Y
                  <input
                    id="admin-area-from-y"
                    inputMode="numeric"
                    min={0}
                    max={DEFAULT_CANVAS_HEIGHT - 1}
                    type="number"
                    value={areaForm.fromY}
                    onChange={(event) => updateAreaField('fromY', event.target.value)}
                  />
                </label>
                <label className="admin-field" htmlFor="admin-area-to-x">
                  끝 X
                  <input
                    id="admin-area-to-x"
                    inputMode="numeric"
                    min={0}
                    max={DEFAULT_CANVAS_WIDTH - 1}
                    type="number"
                    value={areaForm.toX}
                    onChange={(event) => updateAreaField('toX', event.target.value)}
                  />
                </label>
                <label className="admin-field" htmlFor="admin-area-to-y">
                  끝 Y
                  <input
                    id="admin-area-to-y"
                    inputMode="numeric"
                    min={0}
                    max={DEFAULT_CANVAS_HEIGHT - 1}
                    type="number"
                    value={areaForm.toY}
                    onChange={(event) => updateAreaField('toY', event.target.value)}
                  />
                </label>
              </div>

              <p className="admin-area-summary" aria-live="polite">
                {formatAreaSummary(areaBounds)}
              </p>

              <label className="admin-field" htmlFor="admin-area-color">
                초기화 색상
                <input
                  id="admin-area-color"
                  className="hex-input"
                  value={areaForm.colorHex}
                  onChange={(event) => updateAreaField('colorHex', event.target.value)}
                />
              </label>

              <label className="admin-field" htmlFor="admin-area-reason">
                관리 사유
                <select
                  id="admin-area-reason"
                  value={areaForm.reason}
                  onChange={(event) => updateAreaField('reason', event.target.value)}
                >
                  <option value="">사유 선택</option>
                  {MODERATION_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-field" htmlFor="admin-area-confirmation">
                확인을 위해 초기화를 입력하세요
                <input
                  id="admin-area-confirmation"
                  value={areaForm.confirmation}
                  onChange={(event) => updateAreaField('confirmation', event.target.value)}
                  placeholder={RESET_CONFIRMATION}
                />
              </label>

              <button type="button" onClick={restoreAreaToColor} disabled={loading || !areaResetReady}>
                선택 영역 초기화
              </button>
            </section>

            <section className="admin-tool-card" aria-labelledby="recent-events-title">
              <div>
                <h2 id="recent-events-title">최근 이벤트</h2>
                <p className="admin-help">개별 수정이나 사용자 확인을 위해 최근 이벤트를 불러옵니다.</p>
              </div>
              <div className="admin-actions-row">
                <button type="button" onClick={loadEvents} disabled={loading}>
                  최근 이벤트 불러오기
                </button>
                <button type="button" onClick={restoreFirstEventToDefault} disabled={loading}>
                  최신 이벤트를 흰색으로 복구
                </button>
              </div>
              <ol className="event-list">
                {events.map((event) => (
                  <li className="event-item" key={event.id}>
                    <strong>{event.newColorHex}</strong> · 위치 {event.x},{event.y} · 사용자 {event.actorKey}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
