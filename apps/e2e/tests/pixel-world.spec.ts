import { expect, test } from '@playwright/test';

test('home focuses on invite link creation and the lower AdSense slot', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('방장 닉네임')).toBeVisible();
  await expect(page.getByLabel('방 이름')).toBeVisible();
  await expect(page.getByRole('button', { name: '초대 링크 만들기', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '초대 링크 아래 광고', exact: true })).toHaveAttribute(
    'data-ad-placement',
    'home-room-after-create'
  );
  await expect(page.getByText('기존 전체 캔버스 열기')).toHaveCount(0);
  await expect(page.getByRole('grid', { name: '100×100 픽셀 캔버스', exact: true })).toHaveCount(0);
});
