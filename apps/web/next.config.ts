import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ['@pixel-world/shared'],
  turbopack: {
    root: join(appDirectory, '../..')
  }
};

export default nextConfig;
