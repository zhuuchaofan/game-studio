import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const SUBPATH_PREFIX = '/game-studio';
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function startSubpathServer(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === SUBPATH_PREFIX) {
        res.writeHead(301, { Location: `${SUBPATH_PREFIX}/` });
        res.end();
        return;
      }

      if (!pathname.startsWith(`${SUBPATH_PREFIX}/`)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not Found: ${pathname}`);
        return;
      }

      const relPath = pathname.slice(`${SUBPATH_PREFIX}/`.length) || 'index.html';
      const filePath = path.resolve(DIST_DIR, relPath);

      if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Not Found: ${pathname}`);
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

test('loads game assets and renders canvas under /game-studio/ subpath', async ({ page }) => {
  const { server, baseUrl } = await startSubpathServer();

  const failedRequests: string[] = [];
  const pageErrors: string[] = [];

  page.on('requestfailed', (request) => {
    failedRequests.push(
      `requestfailed ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
    );
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  try {
    await page.goto(`${baseUrl}${SUBPATH_PREFIX}/`, { waitUntil: 'load' });

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);

    const canvas = page.locator('#game-container canvas');
    await expect(canvas).toBeVisible();

    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await stopServer(server);
  }
});
