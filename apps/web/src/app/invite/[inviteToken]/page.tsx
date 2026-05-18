import { InviteQuickPixel } from '../../../components/InviteQuickPixel';
import { getInviteLanding } from '../../../lib/roomApi';

interface InvitePageProps {
  params: Promise<{ inviteToken: string }> | { inviteToken: string };
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { inviteToken } = await params;
  const landing = await getInviteLanding(inviteToken);

  return <InviteQuickPixel landing={landing} inviteToken={inviteToken} />;
}
