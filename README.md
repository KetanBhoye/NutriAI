# NutriAI

Calorie tracking across three surfaces, one backend: an MCP server, a web PWA,
and a native iOS/Android app. Runs anywhere Node.js runs — VPS, Docker,
Railway/Render/Fly, or on-prem. No Cloudflare dependency.

## Repository layout

| Directory | What it is | Run it with |
|---|---|---|
| `src/` | Express + SQLite API and MCP server | `pnpm dev` |
| `web/` | Vue 3 PWA, built into `public/app/` and served by the API | `pnpm web:dev` |
| `mobile/` | Expo / React Native app (iOS + Android) | `cd mobile && npm start` |
| `migrations/portable/` | Numbered SQL migrations, applied by `pnpm db:migrate` | |
| `deploy/` | Per-platform deployment guides and scripts | |

One repository, three surfaces. The mobile app has its own `package.json`,
lockfile and test suite, but it lives here and is committed here — there is no
second repo and no submodule.

**New here?** Read this file for the shape of the system, then:

- **[SETUP.md](SETUP.md)** — the full setup guide: prerequisites, every
  environment variable, APK builds, signing, Google Sign-In wiring.
- **[mobile/README.md](mobile/README.md)** — the mobile app's own setup and
  architecture.
- **[mobile/progress.md](mobile/progress.md)** — the engineering log for the
  app: what's deferred, and the decisions that look wrong until you know why.
  Worth reading before your first change.

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

## Architecture

One backend serves three clients. The API is layered, and the layers are worth
respecting — most of the logic that matters is in `services/`, not in routes.

```
src/
  index.ts            entry point: middleware, routes, MCP server registration
  http/api.ts         every REST route + its Zod schema (the API's contract)
  auth/               sessions, OAuth 2.0, bearer tokens for MCP clients
  mcp/                MCP server and tool registration
  services/           business logic — the interesting code lives here
    goal-progress.ts  glide path, adaptive plan progress, weekly deficit
    coach/            LLM: chat agent, photo parsing, weekly insights, onboarding plan
    food-lookup.ts    barcode + external food lookup
  repositories/       data access, one per table; all SQL lives here
  db/                 connection, schema, migration runner
  tools/              MCP tool implementations
```

**Requests flow** route → Zod schema → service → repository → SQLite. A route
should validate and delegate; if it grows arithmetic, that arithmetic belongs in
`services/` where it can be unit-tested (and where the app and the coach are
guaranteed to agree on it).

**Domain maths is duplicated on purpose.** `src/utils/calculations.ts` (server),
`web/src/nutrition.ts` (PWA) and `mobile/src/nutrition.ts` (app) implement
the same Mifflin-St Jeor BMR and activity multipliers, so a client can show
targets without a round trip. If you change one, change all three — the mobile
app's test suite pins the shared values for exactly this reason.

**Two energy rules that look like bugs and aren't:**

- Health-app *active energy* is never added to a day's expenditure. A TDEE built
  from an activity level already assumes normal daily movement; adding it
  double-counts and inflates the deficit.
- Hand-logged exercise **is** added, but only its **net** energy (above resting).
  Your activity level can't have anticipated Tuesday's football match.

Both live in `services/goal-progress.ts` with the reasoning in comments.

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
| `APK_DOWNLOAD_URL` | latest GitHub release asset | Where `/download` redirects — see below |

## Mobile app (iOS + Android)

The app lives in **`mobile/`** and has its own README covering setup,
architecture, testing and the traps — **[mobile/README.md](mobile/README.md)**
is the place to start, with `mobile/progress.md` as the engineering log behind
it.

```bash
cd mobile
npm install            # its own lockfile — npm, not pnpm
npm test               # unit tests, no device needed
npx expo run:ios --device      # or: npx expo run:android
```

The app defaults to the **production** API. To point it at a server you're
running locally, set `API_URL` at build time — it's compiled into the binary, so
this is a rebuild rather than a restart, and it must be your machine's LAN IP
(`localhost` on a phone means the phone; on an Android emulator use
`10.0.2.2`):

```bash
API_URL=http://192.168.1.x:8787 npx expo run:ios --device
```

A few things that bite people, all expanded in the app's own README:

- `ios/` and `android/` are generated by `expo prebuild` and gitignored. Never
  edit them; native config belongs in `app.config.ts` or a plugin in `plugins/`.
- Release APKs are signed from `mobile/credentials/` (gitignored — back it up,
  or you can never update an installed app). Google Sign-In matches the
  signing certificate's SHA-1, so a release build needs its own OAuth client;
  see [SETUP.md §6](SETUP.md#6-google-sign-in).
- iOS push is impossible on a personal Apple team, so reminders are local
  notifications. SETUP.md §7 explains why.
- Health data is read-only on both platforms. Apple Health needs a real device;
  Health Connect needs Android 8.0+ and the Health Connect app.
- `mobile/` never affects the server build: `tsconfig.json` and
  `vitest.config.ts` only include `src/**` (and `web/src/**`), and `biome.json`
  and `.railwayignore` exclude `mobile/` outright. Its tests run separately
  with `npm`, not `pnpm`.

## Sharing the Android build

`GET /download` redirects to the current APK, so there's one short link to hand
out: **`https://<your-host>/download`**.

It redirects rather than serving the file. The APK is ~86 MB and changes every
build; baking it into the deployment image would bloat every deploy and force a
redeploy just to ship a new app version. The default target is GitHub's
`releases/latest/download/NutriAI.apk` permalink, which always resolves to the
newest release carrying that asset name — so publishing a release is all it
takes to change what the link hands out.

```bash
cd mobile && npm run release -- 1.0.1
```

That one command tests, bumps the version, builds, checks the APK is signed
with the release key, and publishes the GitHub release the link resolves to.
See [mobile/README.md](mobile/README.md#shipping-a-new-version).

**Keep the asset name `NutriAI.apk` across releases** or the permalink breaks.
Set `APK_DOWNLOAD_URL` to move to object storage or a Railway volume later
without invalidating a link people already have.

Before sharing a build, check the two things that bite:

- It must be signed with the **same keystore** as any previous build, or
  installing over the top fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
- Google Sign-In matches the signing certificate's SHA-1, so a release build
  needs its own Android OAuth client registered. Email/password is unaffected.

## API surface the app depends on

Full contract: `src/http/api.ts`. The endpoints most likely to surprise you:

| Endpoint | Notes |
|---|---|
| `GET /api/me` | Also returns `onboarded` (true once a calorie target exists) and the current goals. |
| `GET /api/goals` | Plan, macro targets, weekly glide path, **`weigh_ins`** (daily, for the trend chart) and **`progress`** — the server-computed adaptive verdict from `services/goal-progress.ts`. |
| `PUT /api/goals` | Saves the plan *and* the macro targets in one call; macro fields are `nullish`. |
| `PATCH /api/entries/:id` | Partial update. Macros are **nullable** — `null` clears a value, omitted leaves it. Sending `null` where the schema wanted a number used to 400 the whole request. |
| `POST /api/activity` | Upserts one day: steps, weight, and hand-logged exercise (`exercise_type`, `exercise_minutes`, `exercise_kcal`). `.strict()` — unknown keys are rejected rather than silently dropped. |

Adding a column? Add a numbered file in `migrations/portable/` and run
`pnpm db:migrate`. Migrations are applied automatically on boot too.

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
- `cd mobile && npm test` - unit tests for the native app (vitest, 211 tests)
- `cd mobile && npm run e2e` - end-to-end flows on a device (Maestro, 10 flows)
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
