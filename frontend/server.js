/**
 * Grafana k6 UI Tester — Express frontend server
 *
 * Serves the static SPA (public/) and proxies /api/* to the
 * k6 runner backend (default: http://localhost:4000).
 *
 * Usage:
 *   node server.js
 *   PORT=8080 API_BACKEND=http://localhost:4000 node server.js
 */

'use strict';

const express = require('express');
const path    = require('path');
const http    = require('http');
const https   = require('https');

const app         = express();
const PORT        = parseInt(process.env.PORT || '8080', 10);
const API_BACKEND = process.env.API_BACKEND || 'http://localhost:4000';

// Parse JSON bodies (needed to forward POST /api/run payloads)
app.use(express.json());

// ── Static files (SPA) ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API proxy → k6 backend ───────────────────────────────
app.use('/api', (req, res) => {
  let targetUrl;
  try {
    targetUrl = new URL('/api' + req.url, API_BACKEND);
  } catch (err) {
    return res.status(502).json({ error: 'Invalid API backend URL', details: API_BACKEND });
  }

  const isHttps  = targetUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (isHttps ? 443 : 80),
    path:     targetUrl.pathname + targetUrl.search,
    method:   req.method,
    headers:  {
      ...req.headers,
      host:             targetUrl.hostname,
      'x-forwarded-for': req.ip,
    },
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    // Forward status + headers
    res.status(proxyRes.statusCode || 502);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      // Skip hop-by-hop headers
      if (!['connection', 'keep-alive', 'transfer-encoding'].includes(k)) {
        res.setHeader(k, v);
      }
    });
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        error:   'Backend unavailable',
        details: err.message,
        hint:    `Ensure the k6 backend is running at ${API_BACKEND}`,
      });
    }
  });

  // Forward request body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    const body = JSON.stringify(req.body);
    proxyReq.setHeader('content-length', Buffer.byteLength(body));
    proxyReq.write(body);
  }

  proxyReq.end();
});

// ── SPA fallback (all other routes → index.html) ─────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║     Grafana k6 UI Tester — Frontend          ║
╠══════════════════════════════════════════════╣
║  Dashboard:  http://localhost:${PORT}           ║
║  API proxy:  /api/* → ${API_BACKEND.padEnd(22)}║
╚══════════════════════════════════════════════╝
`);
});
