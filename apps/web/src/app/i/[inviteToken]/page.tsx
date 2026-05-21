import { InviteQuickPixel } from '../../../components/InviteQuickPixel';
import { getInviteLanding } from '../../../lib/roomApi';

interface ShortInvitePageProps {
  params: Promise<{ inviteToken: string }> | { inviteToken: string };
}

export default async function ShortInvitePage({ params }: ShortInvitePageProps) {
  const { inviteToken } = await params;
  const landing = await getInviteLanding(inviteToken);

  return <InviteQuickPixel landing={landing} inviteToken={inviteToken} />;
}
