import type { ReactNode } from 'react';

export const FEEDBACK_OPEN_CHAT_URL = 'https://open.kakao.com/o/sVe6cZvi';

interface FeedbackLinkProps {
  className?: string;
  children?: ReactNode;
}

export function FeedbackLink({ className = 'feedback-entry', children }: FeedbackLinkProps) {
  return (
    <a
      className={className}
      href={FEEDBACK_OPEN_CHAT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="피드백 보내기"
    >
      {children ?? (
        <>
          <span className="feedback-entry__eyebrow">피드백</span>
          <strong>피드백 보내기</strong>
          <span>카카오톡 오픈채팅</span>
        </>
      )}
    </a>
  );
}
