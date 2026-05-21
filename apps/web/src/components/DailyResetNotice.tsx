interface DailyResetNoticeProps {
  context?: 'create' | 'invite' | 'room';
}

const noticeCopy = {
  create: '캔버스는 매일 00:00(한국시간)에 새로 시작돼요. 중요한 작품은 미리 이미지로 저장해 주세요.',
  invite: '이 방의 오늘 캔버스는 매일 00:00(한국시간)에 새로 시작돼요. 초기화 전까지 자유롭게 참여해 주세요.',
  room: '오늘의 캔버스는 매일 00:00(한국시간)에 새로 시작돼요. 필요한 작품은 초기화 전에 이미지로 저장해 주세요.',
} as const;

export function DailyResetNotice({ context = 'room' }: DailyResetNoticeProps) {
  return (
    <p className={`daily-reset-notice daily-reset-notice--${context}`} role="note">
      <span aria-hidden="true">⏱</span>
      <strong>00:00 초기화 안내</strong>
      <span>{noticeCopy[context]}</span>
    </p>
  );
}
