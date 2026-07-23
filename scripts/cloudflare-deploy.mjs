import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runWranglerSync } from "./wrangler-runner.mjs";

const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_KV_ID = "00000000000000000000000000000000";
const KV_ID_PATTERN = /^[0-9a-f]{32}$/i;
const PASSWORD_HASH_PATTERN = /^pbkdf2-sha256\$100000\$[^$]+\$[^$]+$/;

const command = process.argv[2] ?? "doctor";
if (!["doctor", "setup"].includes(command)) {
  console.error("Usage: bun scripts/cloudflare-deploy.mjs <doctor|setup>");
  process.exit(1);
}

const envPath = resolve(".env.local");
const envExamplePath = resolve(".env.local.example");
const parseEnv = (content) => {
  const values = new Map();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Bun expands $ references while auto-loading .env files. Values written
    // by this script escape literal dollars as \$ so they survive that load.
    value = value.replace(/\\\$/g, "$");
    values.set(key, value);
  }

  return values;
};

const readEnv = () => {
  const values = existsSync(envPath)
    ? parseEnv(readFileSync(envPath, "utf8"))
    : new Map();

  for (const [key, value] of values) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return values;
};

const scopedKey = (name, values) => {
  const instance = (process.env.EDGE_EVER_INSTANCE || values.get("EDGE_EVER_INSTANCE") || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase();
  return instance ? `EDGE_EVER_${instance}_${name}` : undefined;
};

const envValue = (name, values) => {
  const scoped = scopedKey(name, values);
  return (
    (scoped ? values.get(scoped) || process.env[scoped] : undefined) ||
    values.get(`EDGE_EVER_${name}`) ||
    process.env[`EDGE_EVER_${name}`] ||
    ""
  ).trim();
};

const targetKey = (name, values) => scopedKey(name, values) || `EDGE_EVER_${name}`;

const upsertEnv = (key, value) => {
  const content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  // Keep literal dollars from being expanded by Bun when it auto-loads the file.
  const fileValue = value.replace(/\$/g, "\\$");
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "m");
  const next = pattern.test(content)
    ? content.replace(pattern, () => `${key}=${fileValue}`)
    : `${content.trimEnd()}\n${key}=${fileValue}\n`;

  writeFileSync(envPath, next.startsWith("\n") ? next.slice(1) : next);
  chmodSync(envPath, 0o600);
  process.env[key] = value;
};

const run = (executable, args, options = {}) =>
  spawnSync(executable, args, {
    cwd: resolve("."),
    encoding: "utf8",
    env: process.env,
    shell: false,
    ...options,
  });

const runWrangler = (args, options = {}) =>
  runWranglerSync(args, {
    cwd: resolve("."),
    encoding: "utf8",
    env: process.env,
    ...options,
  });

const check = (label, passed, detail = "") => {
  const status = passed ? "ok" : "fail";
  console.log(`[${status}] ${label}${detail ? `: ${detail}` : ""}`);
  return passed;
};

const printCommandFailure = (result) => {
  if (result.error?.message) console.error(result.error.message);
  if (result.stdout) console.error(String(result.stdout).trim());
  if (result.stderr) console.error(String(result.stderr).trim());
};

const ensureCloudflareAuth = () => {
  let whoami = runWrangler(["whoami"]);
  if (whoami.status === 0) {
    return check("Cloudflare auth", true, "authenticated");
  }

  console.log("[info] Cloudflare authorization is required; starting Wrangler login...");
  const login = runWrangler(["login"], { encoding: undefined, stdio: "inherit" });
  if (login.status !== 0) {
    check("Cloudflare auth", false, "Wrangler login did not complete");
    if (login.error?.message) console.error(login.error.message);
    return false;
  }

  whoami = runWrangler(["whoami"]);
  const authenticated = whoami.status === 0;
  check("Cloudflare auth", authenticated, authenticated ? "authenticated" : "login verification failed");
  if (!authenticated) printCommandFailure(whoami);
  return authenticated;
};

const ensureEnvLocal = () => {
  if (existsSync(envPath)) {
    chmodSync(envPath, 0o600);
    return;
  }

  copyFileSync(envExamplePath, envPath);
  chmodSync(envPath, 0o600);
  console.log("[ok] created .env.local from .env.local.example");
};

const extractUuid = (text) => {
  const assignment = text.match(/database_id\s*=\s*"([^"]+)"/);
  if (assignment?.[1] && UUID_PATTERN.test(assignment[1])) {
    return assignment[1];
  }

  const match = text.match(UUID_PATTERN);
  return match?.[0] ?? "";
};

const findD1DatabaseId = (databaseName) => {
  const result = runWrangler(["d1", "list", "--json"]);
  if (result.status !== 0) {
    return "";
  }

  try {
    const databases = JSON.parse(result.stdout);
    const database = Array.isArray(databases)
      ? databases.find((item) => item?.name === databaseName)
      : undefined;
    return database?.uuid || database?.id || "";
  } catch {
    return "";
  }
};

const listD1Databases = () => {
  const result = runWrangler(["d1", "list", "--json"]);
  if (result.status !== 0) {
    printCommandFailure(result);
    return null;
  }

  try {
    const databases = JSON.parse(result.stdout);
    return Array.isArray(databases) ? databases : null;
  } catch {
    console.error(String(result.stdout).trim());
    return null;
  }
};

const ensureD1 = (values) => {
  const currentId = envValue("D1_DATABASE_ID", values);
  if (currentId && currentId !== PLACEHOLDER_D1_ID) {
    return check("D1 database id", UUID_PATTERN.test(currentId), currentId);
  }

  const databaseName = envValue("D1_DATABASE_NAME", values) || "edgeever";
  const existingId = findD1DatabaseId(databaseName);
  if (existingId) {
    return check(
      "D1 database name collision",
      false,
      `${databaseName} already exists; set ${targetKey("D1_DATABASE_ID", values)}=${existingId} only after verifying ownership`,
    );
  }

  const result = runWrangler(["d1", "create", databaseName]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) {
    console.error(output.trim());
    return check("create D1 database", false, `set ${targetKey("D1_DATABASE_ID", values)} manually`);
  }

  const databaseId = extractUuid(output);
  if (!databaseId) {
    console.error(output.trim());
    return check("read D1 database id", false, "could not parse wrangler output");
  }

  upsertEnv(targetKey("D1_DATABASE_ID", values), databaseId);
  console.log(`[ok] created D1 database ${databaseName}`);
  return true;
};

const listKvNamespaces = () => {
  const result = runWrangler(["kv", "namespace", "list"]);
  if (result.status !== 0) {
    printCommandFailure(result);
    return null;
  }

  try {
    const namespaces = JSON.parse(result.stdout);
    return Array.isArray(namespaces) ? namespaces : null;
  } catch {
    console.error(String(result.stdout).trim());
    return null;
  }
};

const ensureKvNamespace = (values, nameKey, idKey) => {
  const namespaceName = envValue(nameKey, values);
  const configuredId = envValue(idKey, values);
  if (!namespaceName) {
    return check(nameKey, false, "missing namespace name");
  }

  if (configuredId && configuredId !== PLACEHOLDER_KV_ID && !KV_ID_PATTERN.test(configuredId)) {
    return check(idKey, false, "invalid KV namespace ID");
  }

  const namespaces = listKvNamespaces();
  if (!namespaces) {
    return check("list KV namespaces", false);
  }

  if (configuredId && configuredId !== PLACEHOLDER_KV_ID) {
    const configured = namespaces.find((namespace) => namespace?.id === configuredId);
    return check(
      `KV namespace ${namespaceName}`,
      configured?.title === namespaceName,
      configured?.title === namespaceName
        ? configuredId
        : "configured ID does not match an existing namespace with the expected name",
    );
  }

  const existing = namespaces.find((namespace) => namespace?.title === namespaceName);
  if (existing?.id) {
    return check(
      "KV namespace name collision",
      false,
      `${namespaceName} already exists; set ${targetKey(idKey, values)}=${existing.id} only after verifying ownership`,
    );
  }

  const result = runWrangler(["kv", "namespace", "create", namespaceName]);
  if (result.status !== 0) {
    printCommandFailure(result);
    return check(`create KV namespace ${namespaceName}`, false);
  }

  const createdNamespaces = listKvNamespaces();
  const created = createdNamespaces?.find((namespace) => namespace?.title === namespaceName);
  if (!created?.id || !KV_ID_PATTERN.test(created.id)) {
    return check(`read KV namespace ${namespaceName}`, false, "could not resolve created namespace ID");
  }

  upsertEnv(targetKey(idKey, values), created.id);
  console.log(`[ok] created KV namespace ${namespaceName}`);
  return true;
};

const ensureAuthPassword = (values) => {
  const currentHash = envValue("AUTH_PASSWORD_HASH", values);
  if (currentHash) {
    const valid = PASSWORD_HASH_PATTERN.test(currentHash);
    return check("auth password hash", valid, valid ? "configured" : "invalid");
  }

  const password = process.env.EDGE_EVER_PASSWORD?.trim();
  if (password) {
    upsertEnv(targetKey("AUTH_PASSWORD", values), password);
    console.log("[ok] configured auth password secret");
    return true;
  }

  const currentPassword = envValue("AUTH_PASSWORD", values);
  return currentPassword
    ? check("auth password", true, "configured as a secret")
    : check(
        "auth password",
        false,
        "set EDGE_EVER_PASSWORD and rerun setup, or set EDGE_EVER_AUTH_PASSWORD",
      );
};

const doctor = () => {
  const values = readEnv();
  let passed = true;

  passed = check("Bun", run(process.execPath, ["--version"]).status === 0) && passed;
  const wranglerVersion = runWrangler(["--version"]);
  const wranglerAvailable = wranglerVersion.status === 0;
  passed = check("Wrangler", wranglerAvailable) && passed;
  if (!wranglerAvailable) printCommandFailure(wranglerVersion);
  passed = check(".env.local", existsSync(envPath), existsSync(envPath) ? "present" : "missing") && passed;
  if (existsSync(envPath) && process.platform !== "win32") {
    const permissions = statSync(envPath).mode & 0o777;
    passed = check(
      ".env.local permissions",
      permissions === 0o600,
      permissions.toString(8),
    ) && passed;
  }

  if (wranglerAvailable) {
    const whoami = runWrangler(["whoami"]);
    passed = check("Cloudflare auth", whoami.status === 0, whoami.status === 0 ? "authenticated" : "run bun scripts/run-wrangler.mjs login") && passed;
    if (whoami.status !== 0) printCommandFailure(whoami);
  } else {
    passed = check("Cloudflare auth", false, "Wrangler is unavailable") && passed;
  }

  const databaseId = envValue("D1_DATABASE_ID", values);
  const databaseName = envValue("D1_DATABASE_NAME", values);
  const d1Databases = wranglerAvailable ? listD1Databases() : null;
  const d1Matches = Boolean(
    databaseName
    && databaseId
    && databaseId !== PLACEHOLDER_D1_ID
    && UUID_PATTERN.test(databaseId)
    && d1Databases?.some(
      (database) => (database?.uuid || database?.id) === databaseId && database?.name === databaseName,
    ),
  );
  passed =
    check(
      `D1 database ${databaseName || "name missing"}`,
      d1Matches,
      d1Matches ? databaseId : "missing or mismatched",
    ) && passed;

  const kvNamespaces = wranglerAvailable ? listKvNamespaces() : null;
  for (const [nameKey, idKey] of [
    ["KV_NAMESPACE_NAME", "KV_NAMESPACE_ID"],
    ["KV_PREVIEW_NAMESPACE_NAME", "KV_PREVIEW_NAMESPACE_ID"],
  ]) {
    const namespaceName = envValue(nameKey, values);
    const namespaceId = envValue(idKey, values);
    const configured = Boolean(
      namespaceName
      && namespaceId
      && namespaceId !== PLACEHOLDER_KV_ID
      && KV_ID_PATTERN.test(namespaceId),
    );
    const matches = configured
      && Boolean(kvNamespaces?.some((namespace) => namespace?.id === namespaceId && namespace?.title === namespaceName));
    passed = check(`KV namespace ${namespaceName || nameKey}`, matches, matches ? namespaceId : "missing or mismatched") && passed;
  }

  const storageLimit = Number(envValue("RESOURCE_STORAGE_LIMIT_BYTES", values));
  passed =
    check(
      "resource storage hard limit",
      storageLimit === 786_432_000,
      Number.isFinite(storageLimit) ? `${storageLimit} bytes` : "missing",
    ) && passed;
  passed =
    check(
      "Workers Free plan confirmation",
      envValue("WORKERS_FREE_CONFIRMED", values).toLowerCase() === "true",
      envValue("WORKERS_FREE_CONFIRMED", values).toLowerCase() === "true"
        ? "confirmed"
        : "must be explicitly confirmed before deployment",
    ) && passed;

  const r2RuntimeSources = [
    "wrangler.toml",
    "apps/api/src/index.ts",
    "apps/api/src/resource-store.ts",
    "scripts/run-wrangler.mjs",
    "scripts/cloudflare-workers-builds.mjs",
  ].map((path) => readFileSync(resolve(path), "utf8")).join("\n");
  passed =
    check(
      "R2 disabled",
      !/r2_buckets|R2Bucket|R2_BUCKET|wrangler\s+r2/i.test(r2RuntimeSources),
      "runtime code and deployment configuration must not contain an R2 dependency",
    ) && passed;

  const demoMode = envValue("DEMO_MODE", values).toLowerCase();
  passed =
    check(
      "demo mode",
      !demoMode || ["true", "false"].includes(demoMode),
      demoMode === "true" ? "enabled, daily reset cron will be generated" : "disabled",
    ) && passed;

  const passwordHash = envValue("AUTH_PASSWORD_HASH", values);
  const password = envValue("AUTH_PASSWORD", values);
  const passwordHashValid = Boolean(passwordHash && PASSWORD_HASH_PATTERN.test(passwordHash));
  const passwordConfigured = Boolean(password);
  passed =
    check(
      "auth password",
      passwordHash ? passwordHashValid : passwordConfigured,
      passwordHash
        ? passwordHashValid
          ? password
            ? "hash configured and takes precedence over password secret"
            : "hash configured"
          : "invalid password hash; remove or replace it because it takes precedence"
        : password
          ? "password secret configured"
          : "missing",
    ) && passed;

  const allowUnauthenticated = envValue("ALLOW_UNAUTHENTICATED", values).toLowerCase();
  passed =
    check(
      "production authentication policy",
      allowUnauthenticated !== "true",
      allowUnauthenticated === "true"
        ? "EDGE_EVER_ALLOW_UNAUTHENTICATED is local-only and must not be enabled for deployment"
        : "fail-closed",
    ) && passed;

  process.exit(passed ? 0 : 1);
};

const setup = () => {
  ensureEnvLocal();
  const values = readEnv();
  let passed = true;

  const wranglerVersion = runWrangler(["--version"]);
  const wranglerAvailable = wranglerVersion.status === 0;
  passed = check("Wrangler", wranglerAvailable) && passed;
  if (!wranglerAvailable) printCommandFailure(wranglerVersion);

  if (wranglerAvailable) {
    passed = ensureCloudflareAuth() && passed;
  }

  if (!passed) {
    process.exit(1);
  }

  passed = ensureD1(values) && passed;
  passed = ensureKvNamespace(values, "KV_NAMESPACE_NAME", "KV_NAMESPACE_ID") && passed;
  passed = ensureKvNamespace(values, "KV_PREVIEW_NAMESPACE_NAME", "KV_PREVIEW_NAMESPACE_ID") && passed;
  passed = ensureAuthPassword(values) && passed;

  process.exit(passed ? 0 : 1);
};

if (command === "setup") {
  setup();
} else {
  doctor();
}
