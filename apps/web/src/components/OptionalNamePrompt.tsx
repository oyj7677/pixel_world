'use client';

import { FormEvent, useState } from 'react';
import { updateRoomDisplayName } from '../lib/roomApi';

interface OptionalNamePromptProps {
  roomPublicId: string;
}

export function OptionalNamePrompt({ roomPublicId }: OptionalNamePromptProps) {
  const [displayName, setDisplayName] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'skipped'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('saving');
    setError(null);

    try {
      await updateRoomDisplayName(roomPublicId, displayName.trim());
      setState(displayName.trim() ? 'saved' : 'skipped');
    } catch {
      setState('idle');
      setError('이름을 저장하지 못했습니다. 남긴 픽셀은 그대로 유지됩니다.');
    }
  }

  function skipName() {
    setError(null);
    setState('skipped');
  }

  if (state === 'saved') {
    return <p className="form-message">이름을 저장했어요. 함께 볼 단서가 하나 더 생겼습니다.</p>;
  }

  if (state === 'skipped') {
    return <p className="form-message">건너뛰었어요. 퀵 픽셀은 그대로 유지됩니다.</p>;
  }

  return (
    <section className="optional-name-card" aria-labelledby="optional-name-heading">
      <h2 id="optional-name-heading">이름을 남길까요? 선택 사항이에요.</h2>
      <p className="friend-room-copy">비워 두어도 괜찮아요. 건너뛰어도 남긴 픽셀은 사라지지 않습니다.</p>
      <form className="room-create-form" onSubmit={saveName}>
        <label className="friend-field">
          <span>표시 이름(선택)</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            placeholder="민아"
            maxLength={40}
          />
        </label>
        <div className="inline-actions">
          <button className="primary-action" type="submit" disabled={state === 'saving'}>
            {state === 'saving' ? '이름 저장 중…' : '이름 저장'}
          </button>
          <button className="ghost-action" type="button" onClick={skipName} disabled={state === 'saving'}>
            건너뛰기
          </button>
        </div>
      </form>
      {state === 'saving' ? (
        <p className="form-message" role="status" aria-live="polite">
          선택한 이름을 저장하는 중…
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
