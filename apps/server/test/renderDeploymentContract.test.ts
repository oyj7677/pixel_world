import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Render deployment contract', () => {
  it('keeps root npm start delegated to the API server workspace', async () => {
    const rootPackageJson = JSON.parse(
      await readFile(resolve(repoRoot, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };

    expect(rootPackageJson.scripts?.start).toBe('npm run start --workspace @pixel-world/server');
  });

  it('runs database migrations before starting the API server', async () => {
    const serverPackageJson = JSON.parse(
      await readFile(resolve(repoRoot, 'apps/server/package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };

    expect(serverPackageJson.scripts?.prestart).toBe('npm run migrate');
    expect(serverPackageJson.scripts?.start).toBe('tsx src/index.ts');
  });
});
