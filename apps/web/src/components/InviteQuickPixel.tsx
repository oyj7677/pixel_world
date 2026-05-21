'use client';

import { type CSSProperties, type FormEvent, useState } from 'react';
import type { HexColor, InviteLandingResponseDto, QuickPixelResponseDto } from '@pixel-world/shared';
import { DEFAULT_PALETTE } from '@pixel-world/shared';
import { placeQuickPixel } from '../lib/roomApi';
import { DailyResetNotice } from './DailyResetNotice';

interface InviteQuickPixelProps {
  landing: InviteLandingResponseDto | null;
  inviteToken?: string | undefined;
  inviteCode?: string | undefined;
}

export function InviteQuickPixel({ landing, inviteToken, inviteCode }: InviteQuickPixelProps) {
  const [displayName, setDisplayName] = useState('');
  const [quickPixel, setQuickPixel] = useState<QuickPixelResponseDto | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!landing) {
    return (
      <main className="page-shell invite-shell">
        <section className="panel invite-card invite-card--closed" aria-labelledby="invalid-invite-heading">
          <p className="eyebrow">초대가 닫혔어요</p>
          <h1 id="invalid-invite-heading">이 초대는 더 이상 열려 있지 않습니다</h1>
          <p className="friend-room-copy">친구에게 새 링크를 요청하세요. 초대가 열려 있으면 닉네임으로 바로 참여할 수 있어요.</p>
          <a className="secondary-link" href="/">
            내 방 만들기
          </a>
        </section>
      </main>
    );
  }

  const suggestedColor = (landing.quickPixelSuggestion.colorHex ?? DEFAULT_PALETTE[9]!) as HexColor;
  const quickPixelPreviewStyle = { '--quick-pixel-color': suggestedColor } as CSSProperties;
  const participantDisplayName = landing.participantDisplayName?.trim() ?? '';
  const needsDisplayName = !participantDisplayName;
  const roomParams = new URLSearchParams();
  if (inviteToken) {
    roomParams.set('inviteToken', inviteToken);
  } else if (inviteCode) {
    roomParams.set('inviteCode', inviteCode);
  }
  const roomQuery = roomParams.toString();
  const roomHref = `/r/${encodeURIComponent(landing.roomPublicId)}${roomQuery ? `?${roomQuery}` : ''}`;
  const inviteCredential = inviteToken ? { inviteToken } : inviteCode ? { inviteCode } : {};
  const suggestedParticipantDisplayName = needsDisplayName
    ? landing.suggestedParticipantDisplayName?.trim() ?? ''
    : '';

  async function handleQuickPixel(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!landing) {
      return;
    }

    const trimmedDisplayName = displayName.trim();
    if (needsDisplayName && !trimmedDisplayName) {
      setError('픽셀을 남기려면 닉네임을 입력해 주세요.');
      return;
    }

    setIsPlacing(true);
    setError(null);

    try {
      const placed = await placeQuickPixel(landing.roomPublicId, {
        ...inviteCredential,
        suggestedCoordinate: {
          x: landing.quickPixelSuggestion.x,
          y: landing.quickPixelSuggestion.y,
        },
        suggestedColorHex: suggestedColor,
        ...(needsDisplayName ? { displayName: trimmedDisplayName } : {})
      });
      setQuickPixel(placed);
    } catch {
      setError('이 초대로는 픽셀을 남길 수 없습니다. 새 링크나 코드를 받아 다시 시도해 주세요.');
    } finally {
      setIsPlacing(false);
    }
  }

  return (
    <main className="page-shell invite-shell">
      <section className="panel invite-card" aria-labelledby="invite-room-heading">
        <p className="eyebrow">초대받은 방</p>
        <h1 id="invite-room-heading">{landing.roomName}</h1>
        <p className="friend-room-copy">
          초대받은 사람도 닉네임을 먼저 설정해야 친구들이 누가 참여했는지 알 수 있어요.
        </p>
        <DailyResetNotice context="invite" />
        {landing.inviterDisplayName ? (
          <p className="form-message">방장 {landing.inviterDisplayName}님이 보낸 초대입니다.</p>
        ) : null}

        {!quickPixel ? (
          <form className="quick-pixel-start" onSubmit={handleQuickPixel}>
            <div className="quick-pixel-preview" aria-hidden="true" style={quickPixelPreviewStyle} />
            <p>
              추천 위치: {landing.quickPixelSuggestion.x},{landing.quickPixelSuggestion.y}
            </p>
            {needsDisplayName ? (
              <>
                {suggestedParticipantDisplayName ? (
                  <div className="same-ip-name-suggestion">
                    <p>이 네트워크에서 {suggestedParticipantDisplayName} 닉네임으로 참여한 기록이 있어요.</p>
                    <button
                      className="secondary-link"
                      type="button"
                      onClick={() => setDisplayName(suggestedParticipantDisplayName)}
                    >
                      {suggestedParticipantDisplayName}로 계속하기
                    </button>
                    <small>회사·학교처럼 같은 네트워크를 쓰는 사람이 있으면 다른 닉네임을 입력해도 됩니다.</small>
                  </div>
                ) : null}
                <label className="friend-field quick-pixel-name-field">
                  <span>내 닉네임</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.currentTarget.value)}
                    placeholder="준호"
                    maxLength={40}
                    required
                  />
                </label>
              </>
            ) : (
              <p className="returning-name-message">{participantDisplayName} 닉네임으로 바로 참여합니다.</p>
            )}
            <button className="primary-action" type="submit" disabled={isPlacing}>
              {isPlacing ? '퀵 픽셀 남기는 중…' : '퀵 픽셀 남기기'}
            </button>
            {isPlacing ? (
              <p className="form-message" role="status" aria-live="polite">
                퀵 픽셀을 남기는 중…
              </p>
            ) : null}
          </form>
        ) : (
          <div className="quick-pixel-success" aria-live="polite">
            <p>픽셀을 {quickPixel.x},{quickPixel.y}에 남겼어요.</p>
            <a className="secondary-link" href={roomHref}>
              방으로 들어가기
            </a>
          </div>
        )}

        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
