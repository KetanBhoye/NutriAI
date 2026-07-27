# NutriAI

Calorie tracking across three surfaces, one backend: an MCP server, a web PWA,
and a native iOS/Android app. Runs anywhere Node.js runs — VPS, Docker,
Railway/Render/Fly, or on-prem. No Cloudflare dependency.

## Repository layout

| Directory | What it is | Run it with |
|---|---|---|
| `src/` | Express + SQLite API and MCP server | `pnpm dev` |
| `web/` | Vue 3 PWA, built into `public/app/` and served by the API | `pnpm web:dev` |
| `mobile/` | Expo / React Native app (iOS + Android) | `cd mobile && npx expo start` |

**[SETUP.md](SETUP.md) is the full guide** — prerequisites, every environment
variable, APK builds, signing, and the Google Sign-In wiring. This file is the
short version.

## What You Get

- MCP tools for food tracking + profile/BMR/TDEE analytics
- Streamable HTTP MCP endpoint (`/mcp`) and legacy SSE MCP endpoint (`/sse` + `/messages`)
- OAuth endpoints for remote MCP connectors (`/oauth/*` + metadata)
- Web signup/login/session auth
- Dashboard for profile, weight/body-fat tracking, and daily entries
- Native app: food logging, photo/barcode logging, AI coach, trends, plan
  tracking, and Apple Health / Health Connect sync
- SQLite persistence with automatic migrations

## Tech Stack

- Runtime: Node.js + Express
- Database: SQLite (`better-sqlite3`)
- MCP: `@modelcontextprotocol/sdk`
- Language: TypeScript
- Validation: Zod
- Testing: Vitest + Supertest

## Quick Start

```bash
pnpm install
cp .env.example .env # optional
pnpm db:migrate
pnpm dev
```

Server starts at `http://localhost:8787` by default.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | Server port |
| `DATABASE_PATH` | `./data/calorie-tracker.db` | SQLite DB path |
| `ADMIN_API_KEY` | `change-this-admin-key` | Required for `/oauth/register` |
| `ADMIN_EMAIL` | `admin@calorie-tracker.local` | Seeded admin email |
| `ADMIN_PASSWORD` | `admin123456` | Seeded admin password (change in production) |
| `SESSION_TTL_HOURS` | `168` | Web session lifetime |
| `BASE_URL` | `http://localhost:<PORT>` | Public server URL for OAuth metadata |

## Mobile app (iOS + Android)

```bash
cd mobile
npm install          # mobile has its own lockfile — npm, not pnpm
```

The app defaults to the **production** API. To point it at a server you're
running locally, set `API_URL` at build time — it's compiled into the binary, so
this is a rebuild rather than a restart, and it must be your machine's LAN IP
(`localhost` on a phone means the phone):

```bash
API_URL=http://192.168.1.x:8787 npx expo run:ios
```

### Running after you change something

**Changed JS/TS only** — anything under `mobile/app/` or `mobile/src/`:

```bash
cd mobile
npx expo start       # then press `i` for iOS, `a` for Android
```

Fast Refresh applies the change on save; no rebuild. If a dev build is already
installed on the device, just launch it and it picks up Metro.

**Changed anything native** — `app.config.ts`, `plugins/*.js`, or added or
removed a dependency that ships native code:

```bash
cd mobile
npx expo prebuild --clean       # regenerate ios/ and android/
cd ios && pod install && cd ..  # iOS only
npx expo run:ios                # or: npx expo run:android
```

Fast Refresh cannot pick these up — icons, permissions, entitlements and native
modules are all compiled in. `ios/` and `android/` are generated and gitignored,
so **never edit them by hand**; the next prebuild discards it.

### Running on a physical device

```bash
# iOS — Release is required, see below
xcrun xctrace list devices                     # find the UDID
npx expo run:ios --device <udid> --configuration Release

# Android
npx expo run:android --variant release
```

A **Debug** iOS build expects a Metro server and falls back to `localhost` on a
device — which is the phone itself, so you get a black screen. Use
`--configuration Release` on hardware.

Release builds bundle the JS, so a Release build is a full rebuild for **every**
change, including JS-only ones. Free Apple provisioning profiles also expire
after 7 days; reinstall to keep a sideloaded build alive.

### Building an APK

```bash
cd mobile
npx expo prebuild -p android --clean
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew assembleRelease
```

Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`.
Install with `adb install -r <path>`, or copy it to the phone and open it.

Release APKs are signed from `mobile/credentials/` (gitignored — back it up).
Google Sign-In on Android matches the signing certificate's SHA-1, so that
fingerprint has to be registered in Google Cloud; see
[SETUP.md §6](SETUP.md#6-google-sign-in).

### Notes

- Health data is **read-only** on both platforms. Apple Health needs a real
  device (the simulator has no health store); Health Connect needs Android 8.0+
  and the Health Connect app.
- iOS push notifications are impossible without a paid Apple Developer account —
  the app uses local notifications for reminders instead. SETUP.md §7 explains
  why.
- `mobile/` is excluded from this repo's `tsconfig.json`, `vitest.config.ts`,
  `biome.json` and `.railwayignore`, so it never affects the server build or the
  Railway image.

## MCP Endpoints

- `POST/GET/DELETE /mcp` (Streamable HTTP)
- `GET /sse` + `POST /messages?sessionId=...` (legacy SSE)

Authentication: `Authorization: Bearer <token>`

Bearer token can be:
- OAuth access token from `/oauth/token`
- OAuth client secret from `/oauth/register`
- User API token generated in dashboard (`Generate API Token`)

## OAuth Endpoints

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `GET /oauth/authorize`
- `POST /oauth/token`
- `POST /oauth/register`

Register client example:

```bash
curl -X POST http://localhost:8787/oauth/register \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_ADMIN_API_KEY" \
  -d '{
    "client_name": "Claude Desktop",
    "redirect_uris": ["http://127.0.0.1/callback"],
    "user_id": "admin"
  }'
```

## Dashboard

- `/signup` - create user
- `/login` - sign in
- `/dashboard` - profile + entries + token generation

## Integrating with Claude / ChatGPT

### Claude (Bearer token)

```json
{
  "mcpServers": {
    "calorie-tracker": {
      "command": "npx",
      "args": ["mcp-remote", "http://YOUR_HOST:8787/sse"],
      "env": {
        "BEARER_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

### OAuth-capable MCP clients

Use:
- Resource/MCP URL: `https://YOUR_HOST/mcp`
- OAuth metadata: `https://YOUR_HOST/.well-known/oauth-authorization-server`
- Register separate OAuth clients per platform (`Claude` and `ChatGPT`) using `/oauth/register`.

## Deploy Anywhere

### 1) Direct Node deployment

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
NODE_ENV=production PORT=8787 DATABASE_PATH=/var/lib/calorie-tracker/db.sqlite ADMIN_API_KEY=... pnpm start
```

### 2) Docker

```bash
docker build -t calorie-tracker-mcp .
docker run -p 8787:8787 \
  -e ADMIN_API_KEY=change-me \
  -e DATABASE_PATH=/data/calorie-tracker.db \
  -v calorie-data:/data \
  calorie-tracker-mcp
```

### 3) Railway (free plan available)

Easiest cloud deployment with automatic HTTPS and $5/month free tier:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Generate public domain
railway domain

# Set environment variables (see deploy/railway/README.md)
railway variables set ADMIN_API_KEY=$(openssl rand -hex 32)
railway variables set ADMIN_EMAIL=admin@yourdomain.com
# ... (see full guide)
```

Full Railway deployment guide: `deploy/railway/README.md`

### 4) Windows laptop + Tailscale Funnel (free HTTPS)

- Full deployment guide: `deploy/windows/README.md`
- Production env template: `.env.production.example`
- One-command stack start: `deploy/windows/start-stack.ps1`
- Funnel setup: `deploy/windows/start-funnel.ps1`
- Full acceptance test (health, persistence, OAuth, MCP): `deploy/windows/run-acceptance.ps1`

## Scripts

- `pnpm dev` - run with watcher
- `pnpm start` - run production server
- `pnpm db:migrate` - apply migrations + admin seed
- `pnpm test` - run tests
- `pnpm type-check` - TypeScript check
- `pnpm web:dev` / `pnpm web:build` - PWA dev server / production build
- `cd mobile && npm run typecheck` - type-check the native app
- `node deploy/windows/acceptance-test.mjs ...` - deployment acceptance checks

## Core MCP Tools

- `get_user_preferences`
- `set_user_preferences`
- `list_entries`
- `add_entry`
- `update_entry`
- `delete_entry`
- `get_profile`
- `update_profile`
- `get_profile_history`
- `add_body_measurement`
- `list_body_measurements`
- `add_progress_photo`
- `list_progress_photos`
- `compare_progress`
- `register_user` (admin)
- `revoke_user` (admin)
