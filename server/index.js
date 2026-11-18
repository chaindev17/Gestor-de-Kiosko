import express from 'express';
import http from 'node:http';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import authRoutes from './routes/auth.js';
import configRoutes from './routes/config.js';
import warehouseRoutes from './routes/warehouse.js';
import posRoutes from './routes/pos.js';
import financeRoutes from './routes/finance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function createApiApp(dbPath) {
  const db = getDb(dbPath);
  seedIfEmpty(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'gestor-de-kiosko', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/config', configRoutes);
  app.use('/api/warehouse', warehouseRoutes);
  app.use('/api/pos', posRoutes);
  app.use('/api/finance', financeRoutes);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Ruta de API no encontrada.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[Gestor-de-Kiosko Error]', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  });

  return app;
}

async function startServer() {
  const app = createApiApp();
  const httpServer = http.createServer(app);
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    const distPath = path.join(rootDir, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: rootDir,
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(port, host, () => {
    console.log(`Gestor de Kiosko activo en http://${host}:${port} (${isProd ? 'producción' : 'desarrollo'})`);
  });
}

// Run when invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
