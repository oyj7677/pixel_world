import pg from 'pg';
import type { ServerConfig } from '../config';

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createDbPool(config: ServerConfig): DbPool {
  return new Pool({ connectionString: config.databaseUrl });
}
