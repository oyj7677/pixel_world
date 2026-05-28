import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const quickPixelColor = 'rgb(56, 189, 248)';
const defaultCanvasColor = 'rgb(255, 255, 255)';
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const roomCanvasAccessibleName = '48×48 픽셀 캔버스';
const centerPixelName = '픽셀 24,24';

function uniqueRoomName(prefix: string): string {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

async function createRoom(page: Page, roomName = uniqueRoomName('E2E 친구 방'), ownerName = '방장 민아') {
  await page.goto('/');
  await page.getByLabel('방장 닉네임').fill(ownerName);
  await page.getByLabel('방 이름').fill(roomName);
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();

  await page.waitForURL(/\/r\/room_/);
  await expect(page.getByRole('grid', { name: roomCanvasAccessibleName, exact: true })).toBeVisible();
  const visibleInviteCode = await page.locator('.room-invite-code-card strong').innerText();
  expect(visibleInviteCode).toMatch(/^[A-Z0-9]{4}$/);
  const currentUrl = new URL(page.url());
  const roomPath = `${currentUrl.pathname}${currentUrl.search}`;
  const inviteUrl = `/c/${visibleInviteCode}`;
  expect(roomPath).toMatch(/^\/r\//);

  return { inviteUrl, roomPath, roomName };
}

async function waitForRoomCanvas(page: Page, roomPath: string) {
  await page.goto(roomPath);
  await expect(page.getByRole('grid', { name: roomCanvasAccessibleName, exact: true })).toBeVisible();
}

async function placeQuickPixel(page: Page, inviteUrl: string, displayName = '초대 준호') {
  await page.goto(inviteUrl);
  const nameField = page.getByLabel('내 닉네임');
  if (await nameField.isVisible().catch(() => false)) {
    await nameField.fill(displayName);
  } else {
    await expect(page.getByText(`${displayName} 닉네임으로 바로 참여합니다.`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '퀵 픽셀 남기기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '퀵 픽셀 남기기', exact: true }).click();
  await expect(page.getByText(/픽셀을 \d+,\d+에 남겼어요\./)).toBeVisible();
  await expect(page.getByRole('link', { name: '방으로 들어가기', exact: true })).toBeVisible();
}

async function newIsolatedPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

async function generatedPixelSample(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('canvas_context_unavailable');
    }

    context.fillStyle = '#ef4444';
    context.fillRect(0, 0, 4, 8);
    context.fillStyle = '#22c55e';
    context.fillRect(4, 0, 4, 8);

    return canvas.toDataURL('image/png').split(',')[1]!;
  });

  return Buffer.from(base64, 'base64');
}

test('creator creates room and invitee leaves named Quick Pixel', async ({ browser }) => {
  const creator = await browser.newPage();
  const { context: inviteeContext, page: invitee } = await newIsolatedPage(browser);

  try {
    const { inviteUrl, roomPath, roomName } = await createRoom(creator);

    await placeQuickPixel(invitee, inviteUrl, '초대 준호');
    await expect(invitee.getByRole('heading', { name: '이름을 남길까요? 선택 사항이에요.', exact: true })).toHaveCount(0);

    await waitForRoomCanvas(creator, roomPath);
    await expect(creator.getByText(roomName, { exact: true })).toBeVisible();
    await expect(creator.getByRole('button', { name: centerPixelName, exact: true })).toHaveCSS(
      'background-color',
      quickPixelColor
    );
  } finally {
    await creator.close();
    await inviteeContext.close();
  }
});

test('room creator can place multiple pixels immediately in test mode', async ({ browser }) => {
  const creator = await browser.newPage();

  try {
    const { roomPath } = await createRoom(creator, uniqueRoomName('방장 직접 칠하기'));
    await waitForRoomCanvas(creator, roomPath);

    const creatorPixel = creator.getByRole('button', { name: '픽셀 1,1', exact: true });
    await expect(creatorPixel).toHaveAccessibleDescription(/선택한 색상 #38BDF8로 칠할 수 있습니다/);
    await expect(creator.getByRole('region', { name: '방 직접 칠하기 도구', exact: true })).toBeVisible();

    await creatorPixel.click();

    await expect(creatorPixel).toHaveCSS('background-color', quickPixelColor);

    const secondPixel = creator.getByRole('button', { name: '픽셀 2,1', exact: true });
    await expect(secondPixel).toHaveAccessibleDescription(/선택한 색상 #38BDF8로 칠할 수 있습니다/);
    await secondPixel.click();
    await expect(secondPixel).toHaveCSS('background-color', quickPixelColor);
  } finally {
    await creator.close();
  }
});

test('room members can share and use a code-backed invite address from the room screen', async ({ browser }) => {
  const creator = await browser.newPage();
  const { context: inviteeContext, page: invitee } = await newIsolatedPage(browser);

  try {
    const { roomPath } = await createRoom(creator, uniqueRoomName('방 화면 초대 복사'));
    await waitForRoomCanvas(creator, roomPath);

    await creator.getByRole('button', { name: '초대 주소 복사', exact: true }).click();
    await expect(creator.getByText(/초대 주소를/)).toBeVisible();
    const inviteCode = await creator.locator('.room-invite-code-card strong').innerText();

    await placeQuickPixel(invitee, `/c/${inviteCode}`, '초대 소라');
  } finally {
    await creator.close();
    await inviteeContext.close();
  }
});

test('room owner can publish an image-based shared pixel template', async ({ browser }) => {
  const creator = await browser.newPage();

  try {
    const { roomPath } = await createRoom(creator, uniqueRoomName('이미지 샘플 방'));
    await waitForRoomCanvas(creator, roomPath);

    await expect(creator.getByRole('heading', { name: '공유 샘플', exact: true })).toBeVisible();
    await creator.locator('input[type="file"]').setInputFiles({
      name: 'qa-sample.png',
      mimeType: 'image/png',
      buffer: await generatedPixelSample(creator),
    });
    await expect(creator.getByRole('img', { name: 'qa-sample 저장 전 픽셀 샘플', exact: true })).toBeVisible();
    await creator.getByRole('button', { name: '샘플 저장', exact: true }).click();
    await expect(creator.getByText('공유 샘플을 저장했어요.', { exact: true })).toBeVisible();
    await expect(creator.getByRole('img', { name: 'qa-sample 공유 픽셀 샘플', exact: true })).toBeVisible();
    await creator.getByRole('button', { name: '크게 보기', exact: true }).click();
    await expect(creator.getByRole('dialog')).toBeVisible();
  } finally {
    await creator.close();
  }
});

test('invitee nickname is required and same-IP nickname is only suggested for another browser', async ({ browser }) => {
  test.setTimeout(45_000);
  const creator = await browser.newPage();
  const { context: inviteeContext, page: invitee } = await newIsolatedPage(browser);

  try {
    const { inviteUrl } = await createRoom(creator);

    await invitee.goto(inviteUrl);
    await expect(invitee.getByLabel('내 닉네임')).toBeVisible();
    await expect(invitee.getByRole('heading', { name: '이름을 남길까요? 선택 사항이에요.', exact: true })).toHaveCount(0);
    await invitee.getByLabel('내 닉네임').fill('초대 준호');
    await invitee.getByRole('button', { name: '퀵 픽셀 남기기', exact: true }).click();
    await expect(invitee.getByText(/픽셀을 \d+,\d+에 남겼어요\./)).toBeVisible();

    const { context: revisitContext, page: revisit } = await newIsolatedPage(browser);
    try {
      await revisit.goto(inviteUrl);
      await expect(revisit.getByLabel('내 닉네임')).toBeVisible();
      await expect(revisit.getByText('이 네트워크에서 초대 준호 닉네임으로 참여한 기록이 있어요.', { exact: true })).toBeVisible();
      await revisit.getByRole('button', { name: '초대 준호로 계속하기', exact: true }).click();
      await expect(revisit.getByLabel('내 닉네임')).toHaveValue('초대 준호');
    } finally {
      await revisitContext.close();
    }
  } finally {
    await creator.close();
    await inviteeContext.close();
  }
});

test('two rooms do not receive each other realtime pixel updates', async ({ browser }) => {
  const creatorContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  const roomA = await createRoom(creator, uniqueRoomName('A 방'));
  const roomB = await createRoom(creator, uniqueRoomName('B 방'));
  const roomAPage = await creatorContext.newPage();
  const roomBPage = await creatorContext.newPage();
  const { context: inviteeContext, page: invitee } = await newIsolatedPage(browser);

  try {
    await waitForRoomCanvas(roomAPage, roomA.roomPath);
    await waitForRoomCanvas(roomBPage, roomB.roomPath);

    const roomAPixel = roomAPage.getByRole('button', { name: centerPixelName, exact: true });
    const roomBPixel = roomBPage.getByRole('button', { name: centerPixelName, exact: true });
    await expect(roomAPixel).toHaveCSS('background-color', defaultCanvasColor);
    await expect(roomBPixel).toHaveCSS('background-color', defaultCanvasColor);

    await placeQuickPixel(invitee, roomA.inviteUrl);

    await expect(roomAPixel).toHaveCSS('background-color', quickPixelColor);
    await expect(roomBPixel).toHaveCSS('background-color', defaultCanvasColor);
  } finally {
    await inviteeContext.close();
    await creatorContext.close();
  }
});

test('invalid invite cannot place a pixel', async ({ page, request }) => {
  const { roomPath } = await createRoom(page, uniqueRoomName('잘못된 초대 방'));
  const roomPublicId = new URL(roomPath, 'http://localhost:3000').pathname.replace('/r/', '');

  await page.goto('/invite/not-a-valid-invite-token');

  await expect(page.getByRole('heading', { name: '이 초대는 더 이상 열려 있지 않습니다', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '퀵 픽셀', exact: true })).toHaveCount(0);

  const response = await request.post(`${apiOrigin}/api/rooms/${roomPublicId}/quick-pixel`, {
    data: { inviteToken: 'not-a-valid-invite-token', suggestedColorHex: '#38BDF8' }
  });
  expect(response.status()).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: 'invalid_invite',
    message: 'Use a fresh invite link or room code to place your first Quick Pixel.'
  });
});
