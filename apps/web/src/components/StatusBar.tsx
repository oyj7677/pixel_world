'use client';

import type { PixelAllowanceStatePayload } from '@pixel-world/shared';

type StatusBarAllowance = Pick<
  PixelAllowanceStatePayload,
  'savedPixelCount' | 'maxSavedPixelCount' | 'dynamicAllowanceIntervalMs' | 'nextPixelSavedAt' | 'maxStorageEndsAt'
>;

interface StatusBarProps {
  onlineCount: number;
  remainingMs: number;
  connected: boolean;
  allowance: StatusBarAllowance | null;
}

function formatNextSavedLabel(remainingMs: number) {
  const safeRemainingMs = Math.max(0, remainingMs);
  if (safeRemainingMs <= 0) return '곧 가능';
  return `${Math.ceil(safeRemainingMs / 1000)}초 후 충전`;
}

export function StatusBar({ onlineCount, remainingMs, connected, allowance }: StatusBarProps) {
  const savedPixelCount = allowance?.savedPixelCount ?? null;
  const savedPixelLabel = savedPixelCount === null ? '—' : `${savedPixelCount}개 저장됨`;
  const allowanceLabel = savedPixelCount !== null && savedPixelCount > 0 ? '이 프로젝트 속도에 맞춰 준비됨' : formatNextSavedLabel(remainingMs);

  return (
    <section className="panel status-bar" aria-label="캔버스 상태">
      <div className="status-row">
        <span>온라인</span>
        <strong>{onlineCount}</strong>
      </div>
      <div className="status-row">
        <span>저장된 픽셀</span>
        <strong>{savedPixelLabel}</strong>
      </div>
      <div className="status-row">
        <span>사용 가능</span>
        <strong>{allowanceLabel}</strong>
      </div>
      <div className="status-row">
        <span>상태</span>
        <strong>{connected ? '연결됨' : '재연결 중'}</strong>
      </div>
    </section>
  );
}
