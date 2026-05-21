import { AppNav } from '../components/AppNav';
import { RoomCodeJoinForm } from '../components/RoomCodeJoinForm';
import { PublicRoomEntry } from '../components/PublicRoomEntry';
import { RoomCreateForm } from '../components/RoomCreateForm';

export default function HomePage() {
  return (
    <main className="page-shell home-landing">
      <AppNav currentPath="/" />

      <div className="home-room-first">
        <PublicRoomEntry />
        <RoomCodeJoinForm />
        <RoomCreateForm />
      </div>
    </main>
  );
}
