import { AdSlot } from '../components/AdSlot';
import { AppNav } from '../components/AppNav';
import { RoomCodeJoinForm } from '../components/RoomCodeJoinForm';
import { RoomCreateForm } from '../components/RoomCreateForm';

export default function HomePage() {
  return (
    <main className="page-shell home-landing">
      <AppNav currentPath="/" />

      <div className="home-room-first">
        <RoomCodeJoinForm />
        <RoomCreateForm />
        <AdSlot placement="home-room-after-create" label="초대 링크 아래 광고" />
      </div>
    </main>
  );
}
