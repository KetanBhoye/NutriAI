# Mac compute

Answers NutriAI's AI requests with Claude Code running on the owner's Mac,
instead of a metered cloud API.

```
app  ->  NutriAI server (Railway)  <-- long-poll --  worker on the Mac  ->  claude -p
```

The server cannot reach a Mac behind a home router, so the worker makes every
connection: it asks the server for a job, runs it through headless Claude Code,
and posts the answer back. Nothing listens on the Mac and no port is opened.

Every AI feature goes through it — the Coach, food-log parsing, photo logging,
the web-sourced macro lookup, meal ideas, the onboarding plan and the weekly
report. When the Mac is asleep, offline or switched off in the admin console,
requests go to the cloud provider exactly as before, and from there to each
feature's own fallback.

## Set up

1. **Server.** Set `MAC_COMPUTE_TOKEN` (the value the installer generates, in
   `~/.nutriai-compute/config.env`) and deploy. Without it the worker endpoints
   do not exist.
2. **Mac.** Sign in to Claude Code (`claude`, once), then:

   ```bash
   deploy/mac-compute/install.sh                      # production
   deploy/mac-compute/install.sh http://localhost:8787  # a local server
   ```

3. **Admin console** (`/app`) → AI controls → **Mac compute**. The dot is green
   while the Mac is connected; the switch turns it off without touching the Mac.

## What the installer does

It copies the worker to `~/.nutriai-compute/`, writes `config.env` there
(mode 600), and registers the launchd agent `com.nutriai.compute`, which starts
the worker at login and restarts it if it exits. `caffeinate -s` keeps the Mac
awake while it runs **on AC power only**.

It starts at *login*, not at power-on: Claude Code's sign-in lives in the login
keychain, which is locked until you log in. For a Mac that should come back
unattended after a power cut, turn on automatic login (System Settings → Users
& Groups) — which requires FileVault to be off — and "Start up automatically
after a power failure" (Energy).

Re-run `install.sh` after upgrading Node: the agent records the absolute path
of `node`.

## Operating it

```bash
tail -f ~/.nutriai-compute/worker.log                          # what it is doing
launchctl kickstart -k gui/$(id -u)/com.nutriai.compute        # restart
launchctl print gui/$(id -u)/com.nutriai.compute | head -20    # state
deploy/mac-compute/uninstall.sh                                # remove
```

Tuning, in `~/.nutriai-compute/config.env` (restart after changing):

| Variable | Default | |
| --- | --- | --- |
| `NUTRIAI_MODEL_ACCURATE` | `sonnet` | Anything that estimates or looks up a number: Coach, food parsing, photos, web lookup. |
| `NUTRIAI_MODEL_FAST` | `haiku` | Wording over numbers that already exist: weekly report, meal ideas, onboarding note. |
| `NUTRIAI_CONCURRENCY` | `2` | Jobs run at once. |

## What a job is allowed to do

The text in a job comes from app users, so it is treated as hostile. Claude runs
with no built-in tools — web search alone for the macro lookup — and none of
this Mac's MCP servers, settings, hooks, skills or `CLAUDE.md`, in an empty
directory. For a Coach turn the app's own tools (log a food, read the diary…)
are *listed* to Claude by a stand-in server that executes nothing; the calls it
makes are returned to the NutriAI server, which runs them against that user's
data as it always has.

## Limits worth knowing

- **Usage is your Claude plan's.** Jobs draw on the same limits as your own
  Claude Code sessions; when the plan is exhausted, jobs fail and requests fall
  back to the cloud provider. Check that serving an app's users this way fits
  the terms of your Claude plan — a subscription is sold for your own use, and
  an API key (`ANTHROPIC_API_KEY` in `config.env`) is the route that is plainly
  permitted for a product backend.
- **One server instance.** The job queue is in memory.
- **Slower than a cloud API.** Each call starts a `claude` process. Measured:
  a Coach turn logging home food takes about 5-9 s, a question about the day
  about 8 s, and a branded product about 20 s the first time anyone logs it —
  the web search is most of that — then about 11 s once it is in the shared
  food repository.
- **Not billed, so not priced.** Mac-run calls are recorded in `ai_usage` with
  zero tokens and zero cost, so they never count against the daily AI budget.
