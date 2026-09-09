import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import process from "node:process";

const baseUrl = required("AKB_OFFICIAL_SOURCE_WEB_URL").replace(/\/+$/, "");
const secretFile = required("AKB_OFFICIAL_SOURCE_INTERNAL_SECRET_FILE");
const stateDir = process.env.AKB_OFFICIAL_SOURCE_STATE_DIR || "/data/official-source-sync";
const collectionId = process.env.AKB_OFFICIAL_SOURCE_COLLECTION_ID || "czech-law";
const intervalSeconds = positive("AKB_OFFICIAL_SOURCE_INTERVAL_SECONDS", 21_600);
const fullIntervalSeconds = positive("AKB_OFFICIAL_SOURCE_FULL_INTERVAL_SECONDS", 604_800);
const maxNewPerRun = positive("AKB_OFFICIAL_SOURCE_MAX_NEW_PER_RUN", 10);
const requestTimeoutSeconds = positive("AKB_OFFICIAL_SOURCE_REQUEST_TIMEOUT_SECONDS", 180);
const startDelaySeconds = nonnegative("AKB_OFFICIAL_SOURCE_START_DELAY_SECONDS", 30);
const enabled = process.env.AKB_OFFICIAL_SOURCE_AUTOMATION_ENABLED === "true";
const once = process.argv.includes("--once");
const health = process.argv.includes("--health");

await mkdir(stateDir, { recursive: true });
if (health) {
  const heartbeat = await stat(`${stateDir}/heartbeat`).catch(() => null);
  const maxAgeMs = Math.max(intervalSeconds * 2, 600) * 1_000;
  process.exit(heartbeat && Date.now() - heartbeat.mtimeMs <= maxAgeMs ? 0 : 1);
}

if (!once && startDelaySeconds) await delay(startDelaySeconds * 1_000);
do {
  const startedAt = new Date().toISOString();
  try {
    const result = enabled ? await runCycle() : { skipped: true, reason: "automation_disabled" };
    log("info", "official_source_cycle_completed", { startedAt, ...result });
  } catch (error) {
    log("error", "official_source_cycle_failed", { startedAt, message: safeMessage(error) });
  } finally {
    await writeFile(`${stateDir}/heartbeat`, `${new Date().toISOString()}\n`, { mode: 0o600 });
  }
  if (!once) await delay(intervalSeconds * 1_000);
} while (!once);

async function runCycle() {
  const lockPath = `${stateDir}/cycle.lock`;
  const existingLock = await stat(lockPath).catch(() => null);
  const staleAfterMs = Math.max(intervalSeconds * 2, requestTimeoutSeconds * maxNewPerRun * 2) * 1_000;
  if (existingLock && Date.now() - existingLock.mtimeMs > staleAfterMs) await unlink(lockPath).catch(() => undefined);
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") return null;
    throw error;
  });
  if (!lock) return { skipped: true, reason: "cycle_already_running" };
  try {
    const state = await loadState();
    const now = Date.now();
    const full = Boolean(state.lastFullAt) && now - Date.parse(state.lastFullAt) >= fullIntervalSeconds * 1_000;
    const discovery = await invoke({ action: "discover", collection_id: collectionId });
    const candidates = Array.isArray(discovery.candidates) ? discovery.candidates : [];
    const revision = string(discovery.collectionRevision, "collectionRevision");
    const laws = groupByLaw(candidates);
    const fullCursor = Number.isInteger(state.fullCursor) && state.fullCursor >= 0 ? state.fullCursor : 0;
    const selectedLaws = full
      ? laws.slice(fullCursor, fullCursor + maxNewPerRun)
      : laws.filter((law) => law.candidates.some((candidate) => !state.completed[candidateKey(candidate)]))
        .slice(0, maxNewPerRun);
    const selected = selectedLaws.flatMap((law) => full
      ? law.candidates
      : law.candidates.filter((candidate) => !state.completed[candidateKey(candidate)]));
    let succeeded = 0;
    const failures = [];
    for (const candidate of selected) {
      const key = candidateKey(candidate);
      try {
        const result = await invoke({ action: "sync", source: {
          collectionId, collectionRevision: revision,
          sourceUrl: string(candidate.sourceUrl, "sourceUrl"),
          canonicalUrl: string(candidate.canonicalUrl, "canonicalUrl"),
          title: string(candidate.title, "title"),
          ...(candidate.versionLabel ? { versionLabel: string(candidate.versionLabel, "versionLabel") } : {}),
          effectiveFrom: string(candidate.effectiveFrom, "effectiveFrom"),
          effectiveTo: candidate.effectiveTo === null ? null : candidate.effectiveTo ? string(candidate.effectiveTo, "effectiveTo") : null,
        } });
        state.completed[key] = { at: new Date().toISOString(), sha256: string(result.sha256, "sha256") };
        succeeded += 1;
        await saveState(state);
      } catch (error) {
        failures.push({ key, message: safeMessage(error) });
        if (failures.length >= 3) break;
      }
    }
    if (full && failures.length === 0) {
      state.fullCursor = fullCursor + selectedLaws.length;
      if (state.fullCursor >= laws.length) {
        state.lastFullAt = new Date().toISOString();
        state.fullCursor = 0;
      }
    }
    if (!full && selectedLaws.length === 0 && failures.length === 0 && !state.lastFullAt) {
      state.lastFullAt = new Date().toISOString();
    }
    state.lastCycleAt = new Date().toISOString();
    await saveState(state);
    return { skipped: false, full, discovered: candidates.length, discoveredLaws: laws.length,
      selected: selected.length, selectedLaws: selectedLaws.length, succeeded, failures };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

async function invoke(body, attempt = 0) {
  const secret = (await readFile(secretFile, "utf8")).trim();
  if (secret.length < 32) throw new Error("Internal automation secret is invalid.");
  const correlationId = `official-source-${randomUUID()}`;
  let response;
  try {
    response = await fetch(`${baseUrl}/api/internal/public-sources/automation`, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Correlation-ID": correlationId,
        "X-AKB-Official-Source-Automation": secret },
      body: JSON.stringify(body), signal: AbortSignal.timeout(requestTimeoutSeconds * 1_000),
    });
  } catch (error) {
    if (attempt < 1) { await delay(2_000); return invoke(body, attempt + 1); }
    throw error;
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 1) { await delay(2_000); return invoke(body, attempt + 1); }
    throw new Error(`HTTP ${response.status} ${payload?.error?.code || "UPSTREAM_ERROR"}`);
  }
  return payload;
}

async function loadState() {
  const value = await readFile(`${stateDir}/state.json`, "utf8").then(JSON.parse).catch(() => null);
  return value && value.schemaVersion === 1 && value.completed && typeof value.completed === "object"
    ? value : { schemaVersion: 1, lastCycleAt: null, lastFullAt: null, fullCursor: 0, completed: {} };
}

async function saveState(state) {
  const temporary = `${stateDir}/state.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, `${stateDir}/state.json`);
}

function candidateKey(candidate) {
  const sourceUrl = string(candidate.sourceUrl, "sourceUrl");
  const effectiveFrom = string(candidate.effectiveFrom, "effectiveFrom");
  return createHash("sha256").update(`${collectionId}\n${sourceUrl}\n${effectiveFrom}`).digest("hex");
}
function groupByLaw(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const canonicalUrl = string(candidate.canonicalUrl, "canonicalUrl");
    const group = groups.get(canonicalUrl);
    if (group) group.candidates.push(candidate);
    else groups.set(canonicalUrl, { canonicalUrl, candidates: [candidate] });
  }
  return [...groups.values()];
}
function string(value, name) { if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is invalid.`); return value; }
function required(name) { return string(process.env[name], name); }
function positive(name, fallback) { const value = Number(process.env[name] || fallback); if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`); return value; }
function nonnegative(name, fallback) { const value = Number(process.env[name] ?? fallback); if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be nonnegative.`); return value; }
function safeMessage(error) { return error instanceof Error ? error.message.slice(0, 300) : "Unknown error"; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function log(level, event, fields) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields })); }
