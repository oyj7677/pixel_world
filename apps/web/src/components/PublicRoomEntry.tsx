import { FRIEND_ROOM_ROUTES } from '@pixel-world/shared';

export const PUBLIC_ROOM = {
  roomPublicId: 'room_Wpbj5a9UeQpnNhTz',
  inviteCode: 'STI5',
  name: '모두의 픽셀 월드',
} as const;

export function publicRoomHref() {
  return `${FRIEND_ROOM_ROUTES.room(PUBLIC_ROOM.roomPublicId)}?inviteCode=${encodeURIComponent(PUBLIC_ROOM.inviteCode)}`;
}

export function PublicRoomEntry() {
  return (
    <section className="panel public-room-panel" aria-labelledby="public-room-heading">
      <p className="eyebrow">공개 방</p>
      <h1 id="public-room-heading">모두의 픽셀 월드</h1>
      <p className="friend-room-copy">
        누구나 바로 들어와서 마지막까지 함께 픽셀을 남길 수 있는 공개 방이에요.
      </p>
      <div className="public-room-actions">
        <a className="primary-action public-room-entry" href={publicRoomHref()}>
          모두의 방 입장하기
        </a>
        <span className="public-room-code" aria-label="공개 방 입장 코드">
          입장 코드 <strong>{PUBLIC_ROOM.inviteCode}</strong>
        </span>
      </div>
    </section>
  );
}
