import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp({ config });
serve({ fetch: app.fetch, port: config.port });
console.log(
  `Water Inspector server listening on http://localhost:${config.port} (${config.demo ? 'DEMO mode: fixtures only, no network' : 'live mode'})`,
);
