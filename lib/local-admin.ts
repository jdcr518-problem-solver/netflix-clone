import 'server-only';

export function localAdminAllowed(headers: Pick<Headers,'get'>, mutation = false) {
  // The existing dashboard remains a local JSON tool, never a production DB UI.
  if (process.env.STREAMFRAME_REGISTRY_MODE && process.env.STREAMFRAME_REGISTRY_MODE !== 'json') return false;
  const proof = process.env.STREAMFRAME_LOCAL_ADMIN_PROOF;
  const port = process.env.STREAMFRAME_LOCAL_ADMIN_PORT;
  if (process.env.NODE_ENV !== 'development' || !proof || !port || headers.get('x-streamframe-local-proof') !== proof) return false;
  const host = headers.get('host');
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return false;
  if (headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = headers.get('origin');
  if (origin && origin !== `http://${host}`) return false;
  return !mutation || (origin === `http://${host}` &&
    headers.get('x-streamframe-admin') === '1' &&
    headers.get('content-type')?.split(';')[0] === 'application/json');
}
