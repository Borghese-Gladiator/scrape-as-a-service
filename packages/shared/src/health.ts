import { createServer, type Server } from 'node:http';
import type { Logger } from './logger.js';

export interface HealthServerOptions {
  port: number;
  /** Extra fields merged into the /health body, read at request time. */
  details?: () => Record<string, unknown>;
  logger?: Logger;
}

export interface HealthServer {
  port: number;
  close(): Promise<void>;
}

function listeningPort(server: Server, fallback: number): number {
  const address = server.address();
  return address !== null && typeof address === 'object' ? address.port : fallback;
}

/** Run a minimal HTTP server that answers GET /health and nothing else. */
export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const { port, details, logger } = options;

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body = {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        ...(details ? details() : {}),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const boundPort = listeningPort(server, port);
  logger?.info({ port: boundPort }, 'health server listening');

  return {
    port: boundPort,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
