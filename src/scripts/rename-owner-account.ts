/**
 * Re-presents the data-owning account under a real user identity, without
 * moving any data.
 *
 * All history lives under user_id='admin' — a stable internal ID that entries,
 * foods, goals, the API token, and the MCP connector all reference. Rather than
 * reassign every foreign key (risky) we change what that account *is*: give it
 * the target email/name and adopt the password from a duplicate signup account,
 * then delete the duplicate. The user logs in with the credentials they already
 * know and owns everything.
 *
 *   pnpm owner:rename -- --db <path> --target admin \
 *     --email imketanbhoye100@gmail.com --name Ketan \
 *     --adopt-password-from <signup-user-id> [--apply]
 */
import Database from 'better-sqlite3';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

interface Args {
  db: string;
  target: string;
  email: string;
  name: string;
  adoptFrom: string;
  apply: boolean;
}

function parseArgs(): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const db = get('--db');
  const target = get('--target') ?? 'admin';
  const email = get('--email');
  const name = get('--name') ?? 'Ketan';
  const adoptFrom = get('--adopt-password-from');
  if (!db || !email || !adoptFrom) {
    console.error(
      'Usage: rename-owner-account --db <path> --email <email> --adopt-password-from <user-id> [--target admin] [--name Ketan] [--apply]'
    );
    process.exit(1);
  }
  return { db, target, email, name, adoptFrom, apply: argv.includes('--apply') };
}

function main(): void {
  const args = parseArgs();
  const db = new Database(args.db, { readonly: !args.apply });

  const target = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(args.target) as
    | { id: string; name: string; email: string }
    | undefined;
  const source = db
    .prepare('SELECT id, email FROM users WHERE id = ?')
    .get(args.adoptFrom) as { id: string; email: string } | undefined;
  const sourcePw = db
    .prepare('SELECT password_hash FROM user_passwords WHERE user_id = ?')
    .get(args.adoptFrom) as { password_hash: string } | undefined;

  if (!target) throw new Error(`Target account '${args.target}' not found.`);
  if (!source) throw new Error(`Password-source account '${args.adoptFrom}' not found.`);
  if (!sourcePw) throw new Error(`Password-source account '${args.adoptFrom}' has no password.`);

  const entryCount = (
    db.prepare('SELECT COUNT(*) n FROM food_entries WHERE user_id = ?').get(args.target) as {
      n: number;
    }
  ).n;

  console.log('--- plan ---');
  console.log(`target account   : ${target.id} (${target.email}) — owns ${entryCount} entries`);
  console.log(`  → new email    : ${args.email}`);
  console.log(`  → new name     : ${args.name}`);
  console.log(`  → password     : adopt from ${source.id} (${source.email})`);
  console.log(`delete duplicate : ${source.id}`);

  if (!args.apply) {
    console.log('\nDry run — no changes written. Re-run with --apply.');
    db.close();
    return;
  }

  const beforeEntries = entryCount;
  const beforeFoods = (
    db.prepare('SELECT COUNT(*) n FROM foods WHERE user_id = ?').get(args.target) as { n: number }
  ).n;
  const targetHadToken = Boolean(
    (
      db.prepare('SELECT api_key_hash FROM users WHERE id = ?').get(args.target) as {
        api_key_hash: string | null;
      }
    ).api_key_hash
  );

  const run = db.transaction(() => {
    // Delete the duplicate first so its email can't collide with the new one.
    // ON DELETE CASCADE clears its password row and sessions.
    db.prepare('DELETE FROM users WHERE id = ?').run(args.adoptFrom);

    db.prepare('UPDATE users SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      args.name,
      args.email,
      args.target
    );
    db.prepare(
      'UPDATE user_passwords SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?'
    ).run(sourcePw.password_hash, args.target);
  });

  run();

  // Validate: identity changed, data and token untouched, duplicate gone.
  const after = db.prepare('SELECT name, email, api_key_hash FROM users WHERE id = ?').get(args.target) as {
    name: string;
    email: string;
    api_key_hash: string | null;
  };
  const afterPw = (
    db.prepare('SELECT password_hash FROM user_passwords WHERE user_id = ?').get(args.target) as {
      password_hash: string;
    }
  ).password_hash;
  const afterEntries = (
    db.prepare('SELECT COUNT(*) n FROM food_entries WHERE user_id = ?').get(args.target) as {
      n: number;
    }
  ).n;
  const afterFoods = (
    db.prepare('SELECT COUNT(*) n FROM foods WHERE user_id = ?').get(args.target) as { n: number }
  ).n;
  const duplicateGone =
    (db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(args.adoptFrom) as { n: number })
      .n === 0;

  console.log('\n--- validation ---');
  console.log(`identity      : ${after.name} <${after.email}>`);
  console.log(`entries       : ${beforeEntries} -> ${afterEntries}`);
  console.log(`foods         : ${beforeFoods} -> ${afterFoods}`);
  console.log(`password      : ${afterPw === sourcePw.password_hash ? 'adopted ✓' : 'MISMATCH'}`);
  console.log(`token intact  : ${targetHadToken ? Boolean(after.api_key_hash) : 'n/a'}`);
  console.log(`duplicate gone: ${duplicateGone}`);

  if (afterEntries !== beforeEntries || afterFoods !== beforeFoods) {
    throw new Error('Data count changed — aborting, this migration must not move data.');
  }
  if (after.email !== args.email || afterPw !== sourcePw.password_hash || !duplicateGone) {
    throw new Error('Post-migration state is not as expected.');
  }
  if (targetHadToken && !after.api_key_hash) {
    throw new Error('API token was lost — the connector would break.');
  }

  console.log('✓ migration complete');
  db.close();
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
