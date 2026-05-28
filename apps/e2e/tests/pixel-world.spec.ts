import { expect, test } from '@playwright/test';

test('home focuses on public entry, code join, and room creation', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: '모두의 방 입장하기', exact: true })).toBeVisible();
  await expect(page.getByLabel('공개 방 입장 코드')).toContainText('STI5');
  await expect(page.getByRole('heading', { name: '4자리 코드로 입장', exact: true })).toBeVisible();
  await expect(page.getByLabel('방장 닉네임')).toBeVisible();
  await expect(page.getByLabel('방 이름')).toBeVisible();
  await expect(page.getByRole('button', { name: '방 만들기', exact: true })).toBeVisible();
  await expect(page.getByText('기존 전체 캔버스 열기')).toHaveCount(0);
  await expect(page.getByRole('grid', { name: '100×100 픽셀 캔버스', exact: true })).toHaveCount(0);
});
