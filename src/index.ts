import express, { type Express } from 'express';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { getConfig, type AppConfig } from './config.js';
import { migrationsDirFor, openDatabase } from './db/open.js';
import { bootstrapDatabase } from './db/bootstrap.js';
import { registerApiRoutes } from './http/api.js';
import { createOAuthRouter } from './auth/oauth.js';
import { registerMcpRoutes } from './mcp/routes.js';
import { startDailyReminders } from './services/reminders.js';
import { getLatestRelease } from './services/latest-release.js';
import { warmUpVertex } from './services/llm/vertex.js';
import type { AppEnv } from './db/types.js';

export interface RunningApp {
  app: Express;
  env: AppEnv;
  server?: Server;
  close: () => Promise<void>;
}

export async function createApp(config: AppConfig = getConfig()): Promise<RunningApp> {
  const { compat, driver, close: closeDatabase } = openDatabase(config.databasePath, {
    driver: config.dbDriver,
    databaseUrl: config.databaseUrl,
  });
  console.log(`[db] driver: ${driver}`);

  await bootstrapDatabase(compat, {
    migrationsDir: migrationsDirFor(driver),
    adminApiKey: config.adminApiKey,
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
  });

  const env: AppEnv = {
    DB: compat,
    ADMIN_API_KEY: config.adminApiKey,
  };

  const app = express();
  app.disable('x-powered-by');
  // 4mb headroom for meal-photo uploads (resized client-side to well under this).
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Compatibility aliases for OAuth clients that fall back to root auth paths.
  app.use((req, _res, next) => {
    const aliasMap: Record<string, string> = {
      '/authorize': '/oauth/authorize',
      '/token': '/oauth/token',
      '/register': '/oauth/register',
    };

    const aliasTarget = aliasMap[req.path];
    if (aliasTarget) {
      const queryIndex = req.url.indexOf('?');
      const queryString = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
      req.url = `${aliasTarget}${queryString}`;
    }

    next();
  });

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Mcp-Session-Id, Accept, X-API-Key, Last-Event-ID'
    );

    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }

    next();
  });

  registerApiRoutes(app, {
    env,
    sessionTtlHours: config.sessionTtlHours,
    secureCookies: config.nodeEnv === 'production',
  });

  app.use(
    createOAuthRouter({
      db: env.DB,
      adminApiKey: config.adminApiKey,
      baseUrl: config.baseUrl,
    })
  );

  registerMcpRoutes(app, env);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'calorie-tracker-mcp-server',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/openapi.json', (req, res) => {
    const host = req.headers.host || `localhost:${config.port}`;
    const protocol = req.headers['x-forwarded-proto']?.toString() || req.protocol;
    const baseUrl = `${protocol}://${host}`;

    res.json({
      openapi: '3.1.0',
      info: {
        title: 'Calorie Tracker MCP Server',
        version: '2.0.0',
        description: 'Portable MCP calorie tracking server with dashboard and OAuth',
      },
      servers: [{ url: baseUrl }],
      paths: {
        '/mcp': {
          post: { summary: 'MCP streamable HTTP endpoint' },
          get: { summary: 'MCP streamable SSE stream endpoint' },
          delete: { summary: 'Terminate MCP session' },
        },
        '/sse': {
          get: { summary: 'Legacy SSE endpoint' },
        },
      },
    });
  });

  const publicDir = resolve(process.cwd(), 'public');

  /** Where /download sends people. Overridable so the link can outlive GitHub. */
  const apkDownloadUrl =
    process.env.APK_DOWNLOAD_URL ??
    'https://github.com/KetanBhoye/NutriAI/releases/latest/download/NutriAI.apk';

  // The app is the product: root opens NutriAI. This must run BEFORE the static
  // middleware, otherwise static serves public/index.html (the old MCP landing
  // page) as the directory index at "/". We keep the static index enabled so
  // "/app/" still resolves to public/app/index.html (the SPA shell) — disabling
  // it made "/app/" fall through to the /app redirect and loop. The MCP server
  // metadata is still served for connectors at /health, /openapi.json, /mcp,
  // and the old info page is reachable at /info.
  app.get('/', (_req, res) => {
    res.redirect('/app/');
  });

  app.get('/info', (_req, res) => {
    res.sendFile(resolve(publicDir, 'index.html'));
  });

  /**
   * A short, memorable link for the Android build: nutriai.example/download.
   *
   * It redirects rather than serving the file. The APK is ~86 MB and changes
   * every build — baking it into the deployment image would bloat every deploy
   * and force a redeploy just to ship a new app version. GitHub's
   * `releases/latest/download/<asset>` permalink always resolves to the newest
   * release carrying that exact filename, so publishing a release is all it
   * takes to update what this link hands out.
   *
   * Keep the asset name stable across releases or the permalink breaks. Point
   * APK_DOWNLOAD_URL elsewhere (object storage, a Railway volume) to move off
   * GitHub without changing the link people have already been given.
   */
  app.get('/download', (_req, res) => {
    res.redirect(302, apkDownloadUrl);
  });

  /**
   * What the newest Android build is, for the app's own update check.
   *
   * Public on purpose: it carries nothing private, and an app that can't reach
   * it is an app that can never be updated — gating it behind a session would
   * strand anyone signed out on a build that may be the reason they're stuck.
   *
   * `url` is this server's /download, so the redirect stays the single place
   * that decides where APKs actually come from.
   */
  app.get('/api/app-version', async (req, res) => {
    const release = await getLatestRelease();
    const host = req.headers.host || `localhost:${config.port}`;
    const protocol = req.headers['x-forwarded-proto']?.toString() || req.protocol;

    // No usable release is a normal answer, not an error: the app reads it as
    // "nothing to install" and says nothing to the user.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      version: release?.version ?? null,
      notes: release?.notes ?? '',
      size_bytes: release?.size_bytes ?? null,
      published_at: release?.published_at ?? null,
      url: `${protocol}://${host}/download`,
    });
  });

  // Cache policy so PWA updates land fast without a reinstall:
  //  - the service worker, app shell and manifest must NEVER be stale, so the
  //    browser always revalidates them and detects a new version immediately;
  //  - hashed build assets (/app/assets/index-<hash>.js) are immutable, so they
  //    cache forever for instant loads (a new build = a new filename).
  app.use(
    express.static(publicDir, {
      setHeaders: (res, filePath) => {
        if (/(?:sw\.js|workbox-[^/]+\.js|registerSW\.js|\.webmanifest)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );

  app.get('/login', (_req, res) => {
    res.sendFile(resolve(publicDir, 'login.html'));
  });

  app.get('/signup', (_req, res) => {
    res.sendFile(resolve(publicDir, 'signup.html'));
  });

  // The PWA is a client-routed SPA: every /app/* path that isn't a built asset
  // must return index.html so a deep link or a home-screen launch into
  // /app/dashboard resolves instead of 404ing.
  app.get('/app', (_req, res) => {
    res.redirect('/app/');
  });

  app.get(/^\/app\/.*/, (req, res, next) => {
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      next();
      return;
    }
    // The SPA shell must always revalidate so a new deploy is picked up.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(publicDir, 'app', 'index.html'));
  });

  app.get('/dashboard', (_req, res) => {
    res.redirect('/app/');
  });

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.path}` });
  });

  return {
    app,
    env,
    close: closeDatabase,
  };
}

if (process.env.NODE_ENV !== 'test') {
  const config = getConfig();

  createApp(config)
    .then((running) => {
      running.server = running.app.listen(config.port, () => {
        console.log(`Calorie Tracker MCP server running on ${config.baseUrl}`);
      });

      // Daily push reminders (no-op unless push + subscribers exist).
      startDailyReminders(running.env);

      // Spend the cold-connection Vertex stall at startup so the first user's AI
      // action after a deploy doesn't time out. Fire-and-forget.
      const gcpCred = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const gcpProject = process.env.GCP_PROJECT;
      if (gcpCred && gcpProject) {
        void warmUpVertex(
          gcpCred,
          gcpProject,
          process.env.GCP_LOCATION || 'us-central1',
          process.env.LLM_MODEL || 'gemini-2.5-flash'
        );
      }

      const shutdown = async () => {
        if (running.server) {
          await new Promise<void>((resolveShutdown) => {
            running.server?.close(() => resolveShutdown());
          });
        }

        await running.close();
      };

      process.on('SIGINT', () => {
        shutdown().finally(() => process.exit(0));
      });

      process.on('SIGTERM', () => {
        shutdown().finally(() => process.exit(0));
      });
    })
    .catch((error) => {
      console.error('Failed to start application:', error);
      process.exit(1);
    });
}
