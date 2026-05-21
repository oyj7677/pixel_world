import { RoomCanvasShell } from '../../../components/RoomCanvasShell';

interface RoomPageProps {
  params: Promise<{ roomPublicId: string }> | { roomPublicId: string };
  searchParams?: Promise<{ inviteToken?: string | string[]; inviteCode?: string | string[] }> | {
    inviteToken?: string | string[];
    inviteCode?: string | string[];
  };
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const { roomPublicId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const inviteToken = firstQueryValue(resolvedSearchParams.inviteToken);
  const inviteCode = firstQueryValue(resolvedSearchParams.inviteCode);

  return <RoomCanvasShell roomPublicId={roomPublicId} inviteToken={inviteToken} inviteCode={inviteCode} />;
}
