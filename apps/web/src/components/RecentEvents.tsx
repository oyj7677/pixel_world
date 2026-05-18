'use client';

import type { PublicRecentPixelEvent } from '@pixel-world/shared';

interface RecentEventsProps {
  events: PublicRecentPixelEvent[];
  title?: string;
  ariaLabel?: string;
}

export function RecentEvents({ events, title = '내 최근 활동', ariaLabel = '내 최근 픽셀 변경' }: RecentEventsProps) {
  const visibleEvents = events.slice(0, 8);

  return (
    <section className="panel" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {visibleEvents.length > 0 ? (
        <ul className="event-list">
          {visibleEvents.map((event) => (
            <li className="event-item" key={event.id}>
              <strong>{event.newColorHex}</strong> · 위치 {event.x},{event.y}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">최근 변경이 없습니다.</p>
      )}
    </section>
  );
}
