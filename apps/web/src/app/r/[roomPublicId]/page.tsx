import { RoomCanvasShell } from '../../../components/RoomCanvasShell';

interface RoomPageProps {
  params: Promise<{ roomPublicId: string }> | { roomPublicId: string };
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomPublicId } = await params;

  return <RoomCanvasShell roomPublicId={roomPublicId} />;
}
