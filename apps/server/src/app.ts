import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import Redis from 'ioredis';
import { registerAdminRoutes } from './admin/adminRoutes';
import type { ServerConfig } from './config';
import { createDbPool } from './db/index';
import type { PixelSocketServer } from './realtime/socketServer';
import { registerRoomRoutes } from './rooms/roomRoutes';

export async function buildApp(config: ServerConfig) {
  const app = Fastify({ logger: true, trustProxy: true });
  const db = createDbPool(config);
  const redis = new Redis(config.redisUrl);

  app.decorate('db', db);
  app.decorate('redis', redis);
  app.decorate('config', config);

  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS']
  });

  await app.register(cookie, {
    secret: config.cookieSecret
  });

  app.get('/health', async () => ({ ok: true }));

  await registerRoomRoutes(app);
  await registerAdminRoutes(app);

  app.addHook('onClose', async () => {
    await db.end();
    redis.disconnect();
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDbPool>;
    redis: Redis;
    config: ServerConfig;
    pixelSocketServer?: PixelSocketServer;
  }
}
