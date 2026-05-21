'use client';

import { type FormEvent, useState } from 'react';
import { FRIEND_ROOM_INVITE_CODE_LENGTH, FRIEND_ROOM_ROUTES, normalizeInviteCode } from '@pixel-world/shared';

interface RoomCodeJoinFormProps {
  onNavigate?: (href: string) => void;
}

export function RoomCodeJoinForm({ onNavigate }: RoomCodeJoinFormProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleCodeChange(value: string) {
    const sanitized = value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, FRIEND_ROOM_INVITE_CODE_LENGTH);
    setInviteCode(sanitized);
    if (error) {
      setError(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = normalizeInviteCode(inviteCode);
    if (!normalizedCode) {
      setError('4자리 영문·숫자 코드를 입력해 주세요.');
      return;
    }

    const href = FRIEND_ROOM_ROUTES.inviteCode(normalizedCode);
    if (onNavigate) {
      onNavigate(href);
      return;
    }

    window.location.assign(href);
  }

  return (
    <section className="panel room-code-panel" aria-labelledby="room-code-heading">
      <p className="eyebrow">입장 코드</p>
      <h1 id="room-code-heading">4자리 코드로 입장</h1>
      <p className="friend-room-copy">
        초대 링크를 받지 않아도 방장이 공유한 영문·숫자 코드만 입력하면 바로 참여할 수 있어요.
      </p>

      <form className="room-code-form" onSubmit={handleSubmit}>
        <label className="friend-field room-code-field">
          <span>입장 코드</span>
          <input
            className="room-code-input"
            value={inviteCode}
            onChange={(event) => handleCodeChange(event.currentTarget.value)}
            placeholder="A1B2"
            maxLength={FRIEND_ROOM_INVITE_CODE_LENGTH}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            aria-describedby={error ? 'room-code-error' : undefined}
            required
          />
        </label>
        <button className="primary-action" type="submit">
          코드로 입장
        </button>
      </form>

      {error ? (
        <p id="room-code-error" className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
