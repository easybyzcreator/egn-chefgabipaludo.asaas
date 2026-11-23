import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  getAsaasApiKey,
  getAsaasConfig,
  handleAsaasConfig,
  handleAsaasWebhook,
  handleCreatePayment,
  handlePaymentStatus,
} from './api/_lib/asaas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.get('/api/asaas/config', handleAsaasConfig);
app.post('/api/asaas/create-payment', handleCreatePayment);
app.get('/api/asaas/payment-status/:paymentId', handlePaymentStatus);
app.post('/api/asaas/webhook', handleAsaasWebhook);

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build não encontrado.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const apiKey = getAsaasApiKey();
    const { environment } = getAsaasConfig(apiKey);
    console.log(`Server running on http://0.0.0.0:${PORT} (Asaas: ${apiKey ? environment : 'unconfigured'})`);
  });
}

startServer();
