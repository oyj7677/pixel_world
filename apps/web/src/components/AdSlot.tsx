type AdSlotPlacement = 'home-room-after-create' | 'home-top-leaderboard' | 'home-sidebar-rectangle';

type AdSlotProps = {
  placement: AdSlotPlacement;
  label: string;
};

const placementClass: Record<AdSlotPlacement, string> = {
  'home-room-after-create': 'adsense-slot--room-after-create',
  'home-top-leaderboard': 'adsense-slot--leaderboard',
  'home-sidebar-rectangle': 'adsense-slot--sidebar'
};

export function AdSlot({ placement, label }: AdSlotProps) {
  return (
    <section
      className={`panel adsense-slot ${placementClass[placement]}`}
      aria-label={label}
      data-ad-placement={placement}
    >
      <span className="adsense-slot__eyebrow">광고 영역</span>
      <strong>구글 애드센스</strong>
      <p>초대 링크를 만든 뒤 자연스럽게 보이는 위치입니다. 퍼블리셔 ID와 슬롯 ID를 연결하면 광고가 표시됩니다.</p>
    </section>
  );
}
