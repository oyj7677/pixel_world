import { describe, expect, it, vi } from 'vitest';
import { parseSocketLoadArgs, settleSocketLoadBatch } from '../scripts/socketLoad';

describe('socket load test options', () => {
  it('parses client count, URL, and batching options from CLI args', () => {
    expect(
      parseSocketLoadArgs([
        '--url',
        'http://127.0.0.1:4000',
        '--clients',
        '1000',
        '--batch-size',
        '100',
        '--connect-timeout-ms',
        '20000',
        '--event-timeout-ms',
        '30000'
      ])
    ).toEqual({
      url: 'http://127.0.0.1:4000',
      clients: 1000,
      batchSize: 100,
      connectTimeoutMs: 20000,
      eventTimeoutMs: 30000,
      durationMs: 30000,
      intervalMs: 5000,
      mode: 'fanout'
    });
  });

  it('parses write-storm mode for many clients placing pixels at once', () => {
    expect(parseSocketLoadArgs(['--clients', '1000', '--mode', 'write-storm'], {})).toEqual({
      url: 'http://localhost:4000',
      clients: 1000,
      batchSize: 100,
      connectTimeoutMs: 15000,
      eventTimeoutMs: 15000,
      durationMs: 30000,
      intervalMs: 5000,
      mode: 'write-storm'
    });
  });

  it('parses soak mode with duration and interval options', () => {
    expect(
      parseSocketLoadArgs([
        '--mode',
        'soak',
        '--clients',
        '1000',
        '--duration-ms',
        '60000',
        '--interval-ms',
        '10000'
      ], {})
    ).toEqual({
      url: 'http://localhost:4000',
      clients: 1000,
      batchSize: 100,
      connectTimeoutMs: 15000,
      eventTimeoutMs: 15000,
      durationMs: 60000,
      intervalMs: 10000,
      mode: 'soak'
    });
  });

  it('disconnects existing and newly connected clients when a later batch connection fails', async () => {
    const existing = { disconnect: vi.fn() };
    const connectedInFailedBatch = { disconnect: vi.fn() };
    const connectionError = new Error('connect failed');

    await expect(
      settleSocketLoadBatch([existing], [Promise.resolve(connectedInFailedBatch), Promise.reject(connectionError)])
    ).rejects.toThrow(connectionError);

    expect(existing.disconnect).toHaveBeenCalledTimes(1);
    expect(connectedInFailedBatch.disconnect).toHaveBeenCalledTimes(1);
  });
});
