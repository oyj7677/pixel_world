import { normalizeInviteCode } from '@pixel-world/shared';
import { InviteQuickPixel } from '../../../components/InviteQuickPixel';
import { getInviteCodeLanding } from '../../../lib/roomApi';

interface CodeInvitePageProps {
  params: Promise<{ inviteCode: string }> | { inviteCode: string };
}

export default async function CodeInvitePage({ params }: CodeInvitePageProps) {
  const { inviteCode: rawInviteCode } = await params;
  const inviteCode = normalizeInviteCode(rawInviteCode);
  const landing = inviteCode ? await getInviteCodeLanding(inviteCode) : null;

  return <InviteQuickPixel landing={landing} inviteCode={inviteCode ?? rawInviteCode} />;
}
