import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import next from 'next';

const port = Number(process.argv[2] ?? 4318);
if (process.env.NODE_ENV === 'production' || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Run the local admin in development with a valid port.');
process.env.NODE_ENV = 'development';
process.env.STREAMFRAME_LOCAL_ADMIN_PROOF = randomBytes(32).toString('hex');
process.env.STREAMFRAME_LOCAL_ADMIN_PORT = String(port);
const app = next({dev:true, hostname:'127.0.0.1', port});
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request,response) => {
  delete request.headers['x-streamframe-local-proof'];
  if (request.socket.remoteAddress === '127.0.0.1' &&
    [`localhost:${port}`, `127.0.0.1:${port}`].includes(request.headers.host) &&
    !Object.keys(request.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'))) {
    request.headers['x-streamframe-local-proof'] = process.env.STREAMFRAME_LOCAL_ADMIN_PROOF;
  }
  void handle(request,response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});
server.listen(port,'127.0.0.1', () => console.log(`Local admin: http://127.0.0.1:${port}/admin/sources`));
