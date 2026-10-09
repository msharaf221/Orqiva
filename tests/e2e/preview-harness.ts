import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Real cross-site TLS traffic: unlike request interception, this preserves browser cookie policy. */
export async function startEmbeddedPreview() {
  const directory = mkdtempSync(join(tmpdir(), 'orqiva-https-test-'));
  const key = join(directory, 'key.pem'),
    certificate = join(directory, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        certificate,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  let port = 0;
  const server = createServer(
    { key: readFileSync(key), cert: readFileSync(certificate) },
    (incoming, outgoing) => {
      if (incoming.url === '/shell') {
        outgoing.writeHead(200, { 'Content-Type': 'text/html' });
        outgoing.end(
          `<!doctype html><title>Preview shell</title><iframe title="Orqiva" src="https://localhost:${port}/" style="width:1400px;height:1000px"></iframe>`,
        );
        return;
      }
      const proxy = request(
        {
          hostname: '127.0.0.1',
          port: 4173,
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, host: '5173-regression.e2b.app' },
        },
        (response) => {
          outgoing.writeHead(response.statusCode || 502, response.headers);
          response.pipe(outgoing);
        },
      );
      proxy.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(proxy);
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('HTTPS test server did not bind a TCP port');
  port = address.port;
  return {
    shell: `https://127.0.0.1:${port}/shell`,
    preview: `https://localhost:${port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
