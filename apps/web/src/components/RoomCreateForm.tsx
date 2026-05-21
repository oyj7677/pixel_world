'use client';

import { FormEvent, useState } from 'react';
import type { CreateRoomResponseDto } from '@pixel-world/shared';
import { createRoom } from '../lib/roomApi';

export function RoomCreateForm() {
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [name, setName] = useState('');
  const [createdRoom, setCreatedRoom] = useState<CreateRoomResponseDto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedOwnerDisplayName = ownerDisplayName.trim();
    const trimmedName = name.trim();

    if (!trimmedOwnerDisplayName) {
      setError('초대 링크를 만들려면 방장 닉네임을 입력해 주세요.');
      return;
    }

    if (!trimmedName) {
      setError('초대 링크를 만들려면 방 이름을 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const room = await createRoom({ name: trimmedName, ownerDisplayName: trimmedOwnerDisplayName });
      setCreatedRoom(room);
    } catch {
      setError('방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const createdOwnerName = createdRoom?.ownerDisplayName ?? ownerDisplayName.trim();

  return (
    <section className="panel friend-room-panel" aria-labelledby="create-room-heading">
      <p className="eyebrow">친구 방</p>
      <h1 id="create-room-heading">초대 링크 만들기</h1>
      <p className="friend-room-copy">
        방장 닉네임과 방 이름만 정하면 바로 친구들에게 보낼 초대 링크를 만들 수 있어요.
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
        <button className="primary-action" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '만드는 중…' : '초대 링크 만들기'}
        </button>
      </form>

      {isSubmitting ? (
        <p className="form-message" role="status" aria-live="polite">
          초대 링크를 만드는 중…
        </p>
      ) : null}

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}

      {createdRoom ? (
        <div className="invite-result" aria-live="polite">
          <p>초대 준비 완료</p>
          <strong>{createdRoom.roomName}</strong>
          {createdOwnerName ? <span>방장 {createdOwnerName}</span> : null}
          <div className="invite-code-card" aria-label="4자리 입장 코드">
            <span>입장 코드</span>
            <strong>{createdRoom.inviteCode}</strong>
          </div>
          <a href={createdRoom.inviteUrl}>{createdRoom.inviteUrl}</a>
          <a className="secondary-link" href={`/r/${createdRoom.roomPublicId}`}>
            방 열기
          </a>
        </div>
      ) : null}
    </section>
  );
}
