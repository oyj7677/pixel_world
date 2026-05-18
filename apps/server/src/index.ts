import { buildApp } from './app';
import { loadConfig } from './config';
import { attachRealtimeSocketServer } from './realtime/socketServer';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  attachRealtimeSocketServer(app);
  await app.ready();

  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, '0.0.0.0', () => {
      app.server.off('error', reject);
      app.log.info({ address: app.server.address() }, 'Server listening');
      resolve();
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
