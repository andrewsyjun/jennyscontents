import crypto from "node:crypto";
import fs from "node:fs";
import { Pool } from "pg";

const DEFAULT_ITERATIONS = 310_000;

export function createPoolFromEnv(env = process.env) {
  const connectionString = env.APPS_AUTH_DATABASE_URL || "";
  if (!connectionString) return null;

  return new Pool({
    connectionString,
    max: numberFromEnv("APPS_AUTH_DATABASE_POOL_SIZE", 5, 1, 20, env),
  });
}

export async function ensureAppsAuthSchema(pool) {
  await pool.query(`
    create table if not exists app_accounts (
      id bigserial primary key,
      username text not null unique,
      name text not null default '',
      password_hash text not null,
      is_active boolean not null default true,
      totp_secret text,
      totp_enabled_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz
    );

    alter table app_accounts
      add column if not exists totp_secret text;

    alter table app_accounts
      add column if not exists totp_enabled_at timestamptz;

    create table if not exists app_account_apps (
      account_id bigint not null references app_accounts(id) on delete cascade,
      app_id text not null,
      created_at timestamptz not null default now(),
      primary key (account_id, app_id)
    );

    create table if not exists app_auth_login_events (
      id bigserial primary key,
      account_id bigint references app_accounts(id) on delete set null,
      username text not null,
      success boolean not null,
      client_ip text,
      user_agent text,
      created_at timestamptz not null default now()
    );

    create index if not exists app_auth_login_events_username_created_at_idx
      on app_auth_login_events (username, created_at desc);

    create table if not exists app_password_reset_tokens (
      token_hash text primary key,
      account_id bigint not null references app_accounts(id) on delete cascade,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    );

    create index if not exists app_password_reset_tokens_account_id_created_at_idx
      on app_password_reset_tokens (account_id, created_at desc);
  `);
}

export async function countAccounts(pool) {
  const result = await pool.query("select count(*)::int as count from app_accounts;");
  return result.rows[0]?.count || 0;
}

export async function findAccountByUsername(pool, username) {
  const result = await pool.query(
    `
      select
        a.id,
        a.username,
        a.name,
        a.password_hash as "passwordHash",
        a.is_active as "isActive",
        a.totp_secret as "totpSecret",
        a.totp_enabled_at as "totpEnabledAt",
        coalesce(
          array_agg(aa.app_id order by aa.app_id)
            filter (where aa.app_id is not null),
          '{}'
        ) as apps
      from app_accounts a
      left join app_account_apps aa on aa.account_id = a.id
      where a.username = $1
      group by a.id;
    `,
    [normalizeUsername(username)]
  );

  const account = result.rows[0];
  if (!account || !account.isActive) return null;
  account.totpEnabled = Boolean(account.totpSecret && account.totpEnabledAt);
  return account;
}

export async function listAccounts(pool) {
  const result = await pool.query(`
    select
      a.username,
      a.name,
      a.is_active as "isActive",
      a.totp_enabled_at as "totpEnabledAt",
      a.created_at as "createdAt",
      a.updated_at as "updatedAt",
      a.last_login_at as "lastLoginAt",
      coalesce(
        array_agg(aa.app_id order by aa.app_id)
          filter (where aa.app_id is not null),
        '{}'
      ) as apps
    from app_accounts a
    left join app_account_apps aa on aa.account_id = a.id
    group by a.id
    order by a.username;
  `);

  return result.rows;
}

export async function setAccountTotpSecret(pool, username, secret) {
  const result = await pool.query(
    `
      update app_accounts
      set totp_secret = $2, totp_enabled_at = now(), updated_at = now()
      where username = $1 and is_active = true
      returning id, username, name, is_active as "isActive", totp_enabled_at as "totpEnabledAt";
    `,
    [normalizeUsername(username), String(secret || "").trim()]
  );

  return result.rows[0] || null;
}

export async function clearAccountTotpSecret(pool, username) {
  const result = await pool.query(
    `
      update app_accounts
      set totp_secret = null, totp_enabled_at = null, updated_at = now()
      where username = $1
      returning username, name, is_active as "isActive";
    `,
    [normalizeUsername(username)]
  );

  return result.rows[0] || null;
}

export async function upsertAccount(pool, { username, name, passwordHash, apps = [], isActive = true }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) throw new Error("username is required");
  if (!passwordHash) throw new Error("passwordHash is required");

  const normalizedApps = [...new Set(apps.map((app) => String(app).trim()).filter(Boolean))];
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await client.query(
      `
        insert into app_accounts (username, name, password_hash, is_active)
        values ($1, $2, $3, $4)
        on conflict (username) do update set
          name = excluded.name,
          password_hash = excluded.password_hash,
          is_active = excluded.is_active,
          updated_at = now()
        returning id, username, name, is_active as "isActive";
      `,
      [normalizedUsername, String(name || normalizedUsername).trim(), passwordHash, Boolean(isActive)]
    );

    const account = result.rows[0];
    await client.query("delete from app_account_apps where account_id = $1", [account.id]);

    for (const appId of normalizedApps) {
      await client.query(
        "insert into app_account_apps (account_id, app_id) values ($1, $2) on conflict do nothing",
        [account.id, appId]
      );
    }

    await client.query("commit");
    return { ...account, apps: normalizedApps };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function setAccountActive(pool, username, isActive) {
  const result = await pool.query(
    `
      update app_accounts
      set is_active = $2, updated_at = now()
      where username = $1
      returning username, name, is_active as "isActive";
    `,
    [normalizeUsername(username), Boolean(isActive)]
  );

  return result.rows[0] || null;
}

export async function updateAccountPassword(pool, username, passwordHash) {
  const result = await pool.query(
    `
      update app_accounts
      set password_hash = $2, updated_at = now()
      where username = $1 and is_active = true
      returning id, username, name, is_active as "isActive";
    `,
    [normalizeUsername(username), passwordHash]
  );

  return result.rows[0] || null;
}

export async function createPasswordResetToken(pool, username, { expiresHours = 24 } = {}) {
  const account = await findAccountByUsername(pool, username);
  if (!account) throw new Error(`active account not found: ${username}`);

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = resetTokenHash(token);
  const hours = Math.max(1, Math.min(Number.parseInt(expiresHours, 10) || 24, 168));

  await pool.query(
    `
      insert into app_password_reset_tokens (token_hash, account_id, expires_at)
      values ($1, $2, now() + ($3::text || ' hours')::interval);
    `,
    [tokenHash, account.id, hours]
  );

  return {
    token,
    username: account.username,
    name: account.name,
    expiresHours: hours,
  };
}

export async function findPasswordResetToken(pool, token) {
  const result = await pool.query(
    `
      select
        t.token_hash as "tokenHash",
        t.expires_at as "expiresAt",
        t.used_at as "usedAt",
        a.id as "accountId",
        a.username,
        a.name,
        a.is_active as "isActive"
      from app_password_reset_tokens t
      join app_accounts a on a.id = t.account_id
      where t.token_hash = $1;
    `,
    [resetTokenHash(token)]
  );

  const row = result.rows[0];
  if (!row || !row.isActive || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row;
}

export async function consumePasswordResetToken(pool, token, passwordHash) {
  const tokenHash = resetTokenHash(token);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const tokenResult = await client.query(
      `
        select
          t.token_hash,
          t.account_id,
          t.expires_at,
          t.used_at,
          a.username,
          a.name,
          a.is_active
        from app_password_reset_tokens t
        join app_accounts a on a.id = t.account_id
        where t.token_hash = $1
        for update;
      `,
      [tokenHash]
    );

    const row = tokenResult.rows[0];
    if (!row || !row.is_active || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query("rollback");
      return null;
    }

    await client.query(
      "update app_accounts set password_hash = $2, updated_at = now() where id = $1",
      [row.account_id, passwordHash]
    );
    await client.query(
      "update app_password_reset_tokens set used_at = now() where token_hash = $1",
      [tokenHash]
    );
    await client.query("commit");

    return {
      id: row.account_id,
      username: row.username,
      name: row.name,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordLoginEvent(pool, { username, accountId = null, success, clientIp = "", userAgent = "" }) {
  await pool.query(
    `
      insert into app_auth_login_events (account_id, username, success, client_ip, user_agent)
      values ($1, $2, $3, $4, $5);
    `,
    [accountId, normalizeUsername(username) || "unknown", Boolean(success), clientIp, userAgent]
  );

  if (success && accountId) {
    await pool.query("update app_accounts set last_login_at = now() where id = $1", [accountId]);
  }
}

export function hashPassword(password) {
  if (!password) throw new Error("password is required");
  const salt = crypto.randomBytes(18).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, DEFAULT_ITERATIONS, 32, "sha256").toString("base64url");
  return `pbkdf2-sha256$${DEFAULT_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, hash) {
  const [kind, iterationsText, salt, expected] = String(hash || "").split("$");
  if (kind !== "pbkdf2-sha256" || !iterationsText || !salt || !expected) return false;

  const iterations = Number.parseInt(iterationsText, 10);
  if (!Number.isFinite(iterations) || iterations < 100_000) return false;

  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return timingSafeEqual(actual, expected);
}

export function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function resetTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("base64url");
}

export function loadEnv(file) {
  if (!file || !fs.existsSync(file)) return;

  let contents = "";
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "EACCES" || error.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function numberFromEnv(name, fallback, min, max, env = process.env) {
  const value = Number.parseInt(env[name] || "", 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
