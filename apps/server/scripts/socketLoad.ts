import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_CANVAS_ID,
  type CanvasSnapshotPayload,
  type PixelUpdatedPayload
} from '@pixel-world/shared';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

export interface SocketLoadOptions {
  url: string;
  clients: number;
  batchSize: number;
  connectTimeoutMs: number;
  eventTimeoutMs: number;
  durationMs: number;
  intervalMs: number;
  mode: 'fanout' | 'write-storm' | 'soak';
}

const DEFAULT_OPTIONS: SocketLoadOptions = {
  url: 'http://localhost:4000',
  clients: 100,
  batchSize: 100,
  connectTimeoutMs: 15000,
  eventTimeoutMs: 15000,
  durationMs: 30000,
  intervalMs: 5000,
  mode: 'fanout'
};

type DisconnectableSocket = Pick<ClientSocket, 'disconnect'>;

function parsePositiveInteger(name: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readArgValue(args: string[], index: number, name: string): { value: string; nextIndex: number } {
  const current = args[index]!;
  if (current.includes('=')) {
    return { value: current.slice(current.indexOf('=') + 1), nextIndex: index };
  }

  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }

  return { value: next, nextIndex: index + 1 };
}

export function parseSocketLoadArgs(args: string[], env: NodeJS.ProcessEnv = process.env): SocketLoadOptions {
  const options: SocketLoadOptions = {
    url: env.SOCKET_LOAD_URL ?? DEFAULT_OPTIONS.url,
    clients: env.SOCKET_LOAD_CLIENTS
      ? parsePositiveInteger('SOCKET_LOAD_CLIENTS', env.SOCKET_LOAD_CLIENTS)
      : DEFAULT_OPTIONS.clients,
    batchSize: env.SOCKET_LOAD_BATCH_SIZE
      ? parsePositiveInteger('SOCKET_LOAD_BATCH_SIZE', env.SOCKET_LOAD_BATCH_SIZE)
      : DEFAULT_OPTIONS.batchSize,
    connectTimeoutMs: env.SOCKET_LOAD_CONNECT_TIMEOUT_MS
      ? parsePositiveInteger('SOCKET_LOAD_CONNECT_TIMEOUT_MS', env.SOCKET_LOAD_CONNECT_TIMEOUT_MS)
      : DEFAULT_OPTIONS.connectTimeoutMs,
    eventTimeoutMs: env.SOCKET_LOAD_EVENT_TIMEOUT_MS
      ? parsePositiveInteger('SOCKET_LOAD_EVENT_TIMEOUT_MS', env.SOCKET_LOAD_EVENT_TIMEOUT_MS)
      : DEFAULT_OPTIONS.eventTimeoutMs,
    durationMs: env.SOCKET_LOAD_DURATION_MS
      ? parsePositiveInteger('SOCKET_LOAD_DURATION_MS', env.SOCKET_LOAD_DURATION_MS)
      : DEFAULT_OPTIONS.durationMs,
    intervalMs: env.SOCKET_LOAD_INTERVAL_MS
      ? parsePositiveInteger('SOCKET_LOAD_INTERVAL_MS', env.SOCKET_LOAD_INTERVAL_MS)
      : DEFAULT_OPTIONS.intervalMs,
    mode:
      env.SOCKET_LOAD_MODE === 'write-storm' || env.SOCKET_LOAD_MODE === 'soak'
        ? env.SOCKET_LOAD_MODE
        : DEFAULT_OPTIONS.mode
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const name = arg.split('=')[0]!;

    switch (name) {
      case '--url': {
        const { value, nextIndex } = readArgValue(args, index, name);
        options.url = value;
        index = nextIndex;
        break;
      }
      case '--clients': {
        const { value, nextIndex } = readArgValue(args, index, name);
        options.clients = parsePositiveInteger(name, value);
        index = nextIndex;
        break;
      }
      case '--batch-size': {
        const { value, nextIndex } = readArgValue(args, index, name);
        options.batchSize = parsePositiveInteger(name, value);
        index = nextIndex;
        break;
      }
      case '--connect-timeout-ms': {
        const { value, nextIndex } = readArgValue(args, index, name);
        options.connectTimeoutMs = parsePositiveInteger(name, value);
        index = nextIndex;
        break;
      }
      case '--event-timeout-ms': {
        const { value, nextIndex } = readArgValue(args, index, name);
        options.eventTimeoutMs = parsePositiveInteger(name, value);
        index = nextIndex;
        break;
      }
      case '--duration-ms': {
        const { value, nextIndex } = readArgValue(args, index, name);
        options.durationMs = parsePositiveInteger(name, value);
        index = nextIndex;
        break;
      }
      case '--interval-ms': {
        const { value, nextIndex } = readArgValue(args, index, name);
        options.intervalMs = parsePositiveInteger(name, value);
        index = nextIndex;
        break;
      }
      case '--mode': {
        const { value, nextIndex } = readArgValue(args, index, name);
        if (value !== 'fanout' && value !== 'write-storm' && value !== 'soak') {
          throw new Error(`${name} must be "fanout", "write-storm", or "soak"`);
        }
        options.mode = value;
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${name}`);
    }
  }

  return {
    ...options,
    batchSize: Math.min(options.batchSize, options.clients)
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPixelBroadcasts(
  clients: ClientSocket[],
  expectedPerClient: number,
  timeoutMs: number
): Promise<{ received: number; expected: number }> {
  return new Promise((resolve, reject) => {
    const expected = clients.length * expectedPerClient;
    let received = 0;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for pixelUpdated broadcasts: received ${received}/${expected}`));
    }, timeoutMs);

    function onEvent() {
      received += 1;
      if (received === expected) {
        cleanup();
        resolve({ received, expected });
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      for (const client of clients) {
        client.off('pixelUpdated', onEvent);
      }
    }

    for (const client of clients) {
      client.on('pixelUpdated', onEvent);
    }
  });
}

function waitForEvent<T>(socket: ClientSocket, eventName: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function onEvent(payload: T) {
      clearTimeout(timeout);
      resolve(payload);
    }

    socket.once(eventName, onEvent);
  });
}

async function connectAndWaitForSnapshot(url: string, timeoutMs: number): Promise<ClientSocket> {
  const socket = connectClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        reject(new Error('Timed out waiting for connect'));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timeout);
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
      }

      function onConnect() {
        cleanup();
        resolve();
      }

      function onConnectError(error: Error) {
        cleanup();
        reject(error);
      }

      socket.once('connect', onConnect);
      socket.once('connect_error', onConnectError);
    });

    await waitForEvent<CanvasSnapshotPayload>(socket, 'canvasSnapshot', timeoutMs);
    return socket;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

async function connectClients(options: SocketLoadOptions): Promise<ClientSocket[]> {
  const clients: ClientSocket[] = [];

  for (let offset = 0; offset < options.clients; offset += options.batchSize) {
    const count = Math.min(options.batchSize, options.clients - offset);
    const batch = await settleSocketLoadBatch(
      clients,
      Array.from({ length: count }, () => connectAndWaitForSnapshot(options.url, options.connectTimeoutMs))
    );
    clients.push(...batch);
    console.log(`connected ${clients.length}/${options.clients}`);
  }

  return clients;
}

function disconnectAll(clients: DisconnectableSocket[]) {
  for (const client of clients) {
    client.disconnect();
  }
}

export async function settleSocketLoadBatch<TClient extends DisconnectableSocket>(
  connectedClients: TClient[],
  pendingClients: Array<Promise<TClient>>
): Promise<TClient[]> {
  const results = await Promise.allSettled(pendingClients);
  const batchClients = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

  if (rejected) {
    disconnectAll([...connectedClients, ...batchClients]);
    throw rejected.reason;
  }

  return batchClients;
}

function placementForIndex(index: number) {
  return {
    canvasId: DEFAULT_CANVAS_ID,
    x: index % 100,
    y: Math.floor(index / 100) % 100,
    colorHex: '#A855F7'
  };
}

async function runFanoutLoad(options: SocketLoadOptions, clients: ClientSocket[], connectedAt: number, startedAt: number) {
  const broadcastWaits = clients.map((client) =>
    waitForEvent<PixelUpdatedPayload>(client, 'pixelUpdated', options.eventTimeoutMs)
  );

  clients[0]!.emit('placePixel', placementForIndex(Math.floor(Date.now() / 1000)));

  const results = await Promise.allSettled(broadcastWaits);
  const broadcastReceived = results.filter((result) => result.status === 'fulfilled').length;
  const finishedAt = performance.now();
  const summary = {
    mode: options.mode,
    clients: options.clients,
    connected: clients.length,
    broadcastReceived,
    connectMs: Math.round(connectedAt - startedAt),
    broadcastMs: Math.round(finishedAt - connectedAt),
    totalMs: Math.round(finishedAt - startedAt)
  };
  console.log(JSON.stringify(summary, null, 2));

  if (broadcastReceived !== options.clients) {
    throw new Error(`Expected ${options.clients} broadcast receipts, got ${broadcastReceived}`);
  }
}

async function runWriteStormLoad(
  options: SocketLoadOptions,
  clients: ClientSocket[],
  connectedAt: number,
  startedAt: number
) {
  const broadcastWait = waitForPixelBroadcasts(clients, clients.length, options.eventTimeoutMs);

  clients.forEach((client, index) => {
    client.emit('placePixel', placementForIndex(index));
  });

  const { received, expected } = await broadcastWait;
  const finishedAt = performance.now();
  const summary = {
    mode: options.mode,
    clients: options.clients,
    connected: clients.length,
    placementsAttempted: clients.length,
    broadcastReceived: received,
    broadcastExpected: expected,
    connectMs: Math.round(connectedAt - startedAt),
    broadcastMs: Math.round(finishedAt - connectedAt),
    totalMs: Math.round(finishedAt - startedAt)
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function runSoakLoad(options: SocketLoadOptions, clients: ClientSocket[], connectedAt: number, startedAt: number) {
  const iterations = Math.max(1, Math.floor(options.durationMs / options.intervalMs));
  let broadcastReceived = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const broadcastWait = waitForPixelBroadcasts(clients, 1, options.eventTimeoutMs);
    clients[iteration % clients.length]!.emit('placePixel', placementForIndex(5000 + iteration));
    const { received } = await broadcastWait;
    broadcastReceived += received;

    if (iteration < iterations - 1) {
      await delay(options.intervalMs);
    }
  }

  const finishedAt = performance.now();
  const summary = {
    mode: options.mode,
    clients: options.clients,
    connected: clients.length,
    durationMs: options.durationMs,
    intervalMs: options.intervalMs,
    placementsAttempted: iterations,
    broadcastReceived,
    broadcastExpected: clients.length * iterations,
    connectMs: Math.round(connectedAt - startedAt),
    soakMs: Math.round(finishedAt - connectedAt),
    totalMs: Math.round(finishedAt - startedAt)
  };
  console.log(JSON.stringify(summary, null, 2));
}

export async function runSocketLoad(options: SocketLoadOptions): Promise<void> {
  const startedAt = performance.now();
  const clients = await connectClients(options);
  const connectedAt = performance.now();

  try {
    if (options.mode === 'soak') {
      await runSoakLoad(options, clients, connectedAt, startedAt);
    } else if (options.mode === 'write-storm') {
      await runWriteStormLoad(options, clients, connectedAt, startedAt);
    } else {
      await runFanoutLoad(options, clients, connectedAt, startedAt);
    }
  } finally {
    for (const client of clients) {
      client.disconnect();
    }
  }
}

const argvPath = process.argv[1];
if (argvPath && import.meta.url === pathToFileURL(argvPath).href) {
  runSocketLoad(parseSocketLoadArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
