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

// Verify the actual login on each new physical production connection. Pool
// credentials can be misbound even when their environment variable names are correct.
export async function checkDatabaseRole(client:Pick<SqlClient,'query'>, access:'reader'|'operator') {
  const expected='streamframe_'+access;
  const {rows}=await client.query(`SELECT
    pg_has_role(current_user,$1::name,'USAGE') AND
    NOT EXISTS (SELECT FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
        OR r.rolname NOT IN (current_user,$1::name))) AND
    NOT has_schema_privilege(current_user,'streamframe','CREATE') AND
    has_table_privilege(current_user,'streamframe.playback_records','SELECT') AND
    NOT has_table_privilege(current_user,'streamframe.audit_events','DELETE,TRUNCATE,TRIGGER') AND
    NOT has_any_column_privilege(current_user,'streamframe.audit_events','UPDATE') AND
    CASE WHEN $2::boolean THEN
      NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='streamframe' AND c.relkind IN ('r','p','v','m','f') AND (
          has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
          has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES') OR
          (c.relname<>'playback_records' AND has_any_column_privilege(current_user,c.oid,'SELECT'))))
    ELSE has_table_privilege(current_user,'streamframe.sources','UPDATE') END AS allowed`,[expected,access==='reader']);
  if(rows[0]?.allowed!==true) throw new Error('Database account privileges do not match the runtime role.');
}

const pools=new Map<DatabaseAccess,pg.Pool>();
export function databasePool(access:DatabaseAccess):SqlPool {
  let pool=pools.get(access);
  if (!pool) {
    const options=connectionOptions(access);
    if(process.env.NODE_ENV==='production' && access!=='migrator')
      options.onConnect=client=>checkDatabaseRole(client,access);
    pool=new pg.Pool(options);
    pool.on('error',()=>console.error(JSON.stringify({event:'database_connection_failed',access})));
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
