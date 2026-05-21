'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FRIEND_ROOM_CANVAS_DIMENSION_PRESETS,
  FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION,
  FRIEND_ROOM_ROUTES,
  isValidRoomCanvasDimension,
} from '@pixel-world/shared';
import { createRoom } from '../lib/roomApi';
import { DailyResetNotice } from './DailyResetNotice';

export function RoomCreateForm() {
  const router = useRouter();
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [name, setName] = useState('');
  const [canvasDimension, setCanvasDimension] = useState(FRIEND_ROOM_DEFAULT_CANVAS_DIMENSION);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedOwnerDisplayName = ownerDisplayName.trim();
    const trimmedName = name.trim();

    if (!trimmedOwnerDisplayName) {
      setError('방을 만들려면 방장 닉네임을 입력해 주세요.');
      return;
    }

    if (!trimmedName) {
      setError('방을 만들려면 방 이름을 입력해 주세요.');
      return;
    }

    if (!isValidRoomCanvasDimension(canvasDimension)) {
      setError('캔버스 규모를 다시 선택해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const room = await createRoom({
        name: trimmedName,
        ownerDisplayName: trimmedOwnerDisplayName,
        canvasDimension,
      });
      router.push(`${FRIEND_ROOM_ROUTES.room(room.roomPublicId)}?inviteCode=${encodeURIComponent(room.inviteCode)}`);
    } catch {
      setError('방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel friend-room-panel" aria-labelledby="create-room-heading">
      <p className="eyebrow">친구 방</p>
      <h1 id="create-room-heading">방 만들기</h1>
      <p className="friend-room-copy">
        방장 닉네임과 방 이름, 캔버스 규모를 정하면 바로 방으로 들어갈 수 있어요.
      </p>

      <form className="room-create-form" onSubmit={handleSubmit}>
        <label className="friend-field">
          <span>방장 닉네임</span>
          <input
            value={ownerDisplayName}
            onChange={(event) => setOwnerDisplayName(event.currentTarget.value)}
            placeholder="민아"
            maxLength={40}
            required
          />
        </label>
        <label className="friend-field">
          <span>방 이름</span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="금요일 친구들"
            maxLength={80}
            required
          />
        </label>
        <fieldset className="friend-field canvas-size-field">
          <legend>캔버스 규모</legend>
          <div className="canvas-size-options" role="group" aria-label="캔버스 규모 선택">
            {FRIEND_ROOM_CANVAS_DIMENSION_PRESETS.map((preset) => (
              <button
                aria-pressed={canvasDimension === preset.dimension}
                className="canvas-size-option"
                key={preset.id}
                onClick={() => setCanvasDimension(preset.dimension)}
                type="button"
              >
                <strong>{preset.label}</strong>
                <span>{preset.dimension}픽셀</span>
                <small>{preset.description}</small>
              </button>
            ))}
          </div>
          <small>
            선택한 값으로 가로와 세로가 같은 정사각형 캔버스를 만들어요.
          </small>
        </fieldset>
        <DailyResetNotice context="create" />
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '방 만드는 중…' : '방 만들기'}
        </button>
      </form>

      {isSubmitting ? (
        <p className="form-message" role="status" aria-live="polite">
          방을 만드는 중…
        </p>
      ) : null}

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}

    </section>
  );
}
