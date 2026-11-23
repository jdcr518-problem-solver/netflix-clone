import 'server-only';
import pg from 'pg';

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{rows: Record<string, any>[]; rowCount?: number | null}>;
  release(): void;
}
export interface SqlPool { connect(): Promise<SqlClient>; end(): Promise<void> }

export type DatabaseAccess = 'reader' | 'operator' | 'migrator';
const names = {reader:'STREAMFRAME_DATABASE_READ_URL',operator:'STREAMFRAME_DATABASE_WRITE_URL',migrator:'STREAMFRAME_DATABASE_MIGRATION_URL'} as const;

export function connectionOptions(access:DatabaseAccess, env:Partial<NodeJS.ProcessEnv>=process.env): pg.PoolConfig {
  const value=env[names[access]];
  if (!value) throw new Error(`Missing ${names[access]}.`);
  let url:URL;
  try {url=new URL(value);} catch {throw new Error('Invalid database connection configuration.');}
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.hash)
    throw new Error('Invalid database connection configuration.');
  // Reject URL flags which can override TLS verification in node-postgres.
  if ([...url.searchParams.keys()].some(key=>key!=='sslmode') ||
    (url.searchParams.has('sslmode') && url.searchParams.get('sslmode')!=='verify-full'))
    throw new Error('Database URLs accept only sslmode=verify-full; configure TLS explicitly.');
  url.search='';
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const insecure=env.STREAMFRAME_DATABASE_LOCAL_INSECURE==='1';
  if (insecure && (!local || env.NODE_ENV==='production')) throw new Error('Insecure database connections are limited to local development.');
  return {connectionString:url.toString(), ssl:insecure ? false : {rejectUnauthorized:true, ...(env.STREAMFRAME_DATABASE_CA ? {ca:env.STREAMFRAME_DATABASE_CA}: {})},
    max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:10000,
    idle_in_transaction_session_timeout:15000,application_name:`streamframe-${access}`,allowExitOnIdle:true};
}

const pools=new Map<DatabaseAccess,pg.Pool>();
export function databasePool(access:DatabaseAccess):SqlPool {
  let pool=pools.get(access);
  if (!pool) {
    pool=new pg.Pool(connectionOptions(access));
    pool.on('error',()=>console.error('Database connection became unavailable.'));
    pools.set(access,pool);
  }
  return pool;
}
export async function closeDatabasePools() {
  const current=[...pools.values()]; pools.clear();
  await Promise.all(current.map(pool=>pool.end()));
}

export async function transaction<T>(pool:SqlPool, work:(client:SqlClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
}
