#!/usr/bin/env node
/**
 * Read-only Meta Graph API check for a User Access Token -> Facebook Page -> Instagram Business Account.
 * Credentials are read only from environment variables and are never printed or placed in a URL.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_VERSION = "v27.0";
const VERSION_SHAPE = /^v\d+\.\d+$/;
const REQUEST_TIMEOUT_MS = 15_000;

class MetaApiError extends Error {
  constructor(message, { code, subcode, traceId, status } = {}) {
    super(message);
    this.name = "MetaApiError";
    this.code = code;
    this.subcode = subcode;
    this.traceId = traceId;
    this.status = status;
  }
}

function versionFromEnv(raw = process.env.META_API_VERSION) {
  if (!raw?.trim()) return DEFAULT_VERSION;
  const version = raw.trim().toLowerCase().startsWith("v") ? raw.trim() : `v${raw.trim()}`;
  if (!VERSION_SHAPE.test(version)) throw new Error("META_API_VERSION must look like v27.0 or 27.0.");
  return version;
}

function safeText(value, token) {
  let text = String(value ?? "");
  if (token) text = text.replaceAll(token, "[redacted]");
  return text
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/\bEAA[\w-]{20,}\b/g, "[redacted]");
}

function graphError(payload, status, token) {
  const error = payload?.error ?? {};
  const message = safeText(error.message || `HTTP ${status} from Meta Graph API`, token);
  return new MetaApiError(message, {
    code: error.code,
    subcode: error.error_subcode,
    traceId: error.fbtrace_id,
    status,
  });
}

function formatError(error) {
  const details = [];
  if (error.status != null) details.push(`HTTP ${error.status}`);
  if (error.code != null) details.push(`Meta code ${error.code}`);
  if (error.subcode != null) details.push(`subcode ${error.subcode}`);
  if (error.traceId) details.push(`trace ${error.traceId}`);
  return `${safeText(error.message)}${details.length ? ` (${details.join(", ")})` : ""}`;
}

function apiClient({ token, base, version }) {
  return async function graphGet(path, params = {}) {
    const url = new URL(`${base}/${version}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error(`Meta request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
      }
      throw error;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error) throw graphError(payload, response.status, token);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`Meta returned an unexpected response for ${path}.`);
    }
    return payload;
  };
}

async function findPageInUserAccounts(graphGet, targetPageId) {
  let after;
  for (let page = 0; page < 10; page++) {
    const result = await graphGet("me/accounts", {
      fields: "id,name",
      limit: "100",
      ...(after ? { after } : {}),
    });
    const match = (Array.isArray(result.data) ? result.data : []).find((item) => String(item?.id ?? "") === targetPageId);
    if (match) return { page: match, complete: true };
    after = result.paging?.cursors?.after;
    if (!after) return { page: null, complete: true };
  }
  return { page: null, complete: false };
}

function printHelp() {
  console.log(`Read-only Instagram Business Account check

Required environment variables:
  META_USER_ACCESS_TOKEN  User Access Token (not a Page Access Token)
  FB_PAGE_ID              Numeric Facebook Page ID to check

Optional:
  META_API_VERSION        Graph API version; defaults to ${DEFAULT_VERSION}
  FB_GRAPH_BASE           Graph API host; defaults to https://graph.facebook.com

Run:
  node scripts/test-instagram-business-account.mjs

The token is sent only in the Authorization header and is never printed.
`);
}

export async function runInstagramBusinessAccountCheck(env = process.env) {
  const token = (env.META_USER_ACCESS_TOKEN || env.FB_USER_ACCESS_TOKEN || "").trim();
  const pageId = (env.FB_PAGE_ID || env.META_PAGE_ID || "").trim();
  if (!token) throw new Error("Set META_USER_ACCESS_TOKEN (or FB_USER_ACCESS_TOKEN) in the environment; do not pass the token as a command-line argument.");
  if (/\s/.test(token)) throw new Error("The User Access Token contains whitespace; check that it was copied as one complete value.");
  if (!pageId || !/^\d+$/.test(pageId)) throw new Error("Set FB_PAGE_ID to the numeric Facebook Page ID to check.");

  const version = versionFromEnv(env.META_API_VERSION);
  const base = (env.FB_GRAPH_BASE || "https://graph.facebook.com").replace(/\/+$/, "");
  let parsedBase;
  try { parsedBase = new URL(base); } catch { throw new Error("FB_GRAPH_BASE must be a valid HTTPS URL."); }
  if (parsedBase.protocol !== "https:") throw new Error("FB_GRAPH_BASE must use HTTPS because the request carries an access token.");

  const graphGet = apiClient({ token, base, version });
  console.log(`Graph API version: ${version}`);
  console.log("Credential: User Access Token provided (value hidden)");

  const me = await graphGet("me", { fields: "id,name" });
  if (!me.id) throw new Error("Meta did not return the User ID for this token.");
  console.log(`Token identity: ${me.name || "unnamed user"} (ID ${me.id})`);
  if (String(me.id) === pageId) {
    throw new Error("/me returned the target Page ID. This appears to be a Page Access Token; supply a User Access Token instead.");
  }

  let permissions;
  try {
    const result = await graphGet("me/permissions", { fields: "permission,status" });
    permissions = Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    console.warn(`Permission listing unavailable: ${formatError(error)}`);
  }
  if (permissions) {
    for (const permission of ["pages_show_list", "pages_read_engagement", "instagram_basic", "business_management"]) {
      const status = permissions.find((item) => item.permission === permission)?.status || "not returned";
      console.log(`Permission ${permission}: ${status}`);
    }
  }

  try {
    const listed = await findPageInUserAccounts(graphGet, pageId);
    if (listed.page) console.log(`Page assignment: visible in /me/accounts as ${listed.page.name || pageId}.`);
    else if (listed.complete) console.warn("Page assignment: this Page was not returned by /me/accounts. Check pages_show_list and the user's Page access.");
    else console.warn("Page assignment: not found in the first 1,000 /me/accounts entries.");
  } catch (error) {
    console.warn(`Page-list check unavailable: ${formatError(error)}. Continuing with the direct Page-field check.`);
  }

  const page = await graphGet(pageId, { fields: "id,name,instagram_business_account{id,username}" });
  if (String(page.id ?? "") !== pageId) throw new Error("Meta returned a different Page ID than the one requested.");
  console.log(`Facebook Page: ${page.name || "unnamed Page"} (ID ${page.id})`);

  const instagram = page.instagram_business_account;
  if (!instagram?.id) {
    throw new Error("The Page was readable, but Meta returned no instagram_business_account. Confirm the Page is linked to an Instagram Professional account and that this user can perform the required Page tasks.");
  }

  console.log(`Instagram Business Account: ${instagram.username ? `@${instagram.username} ` : ""}(ID ${instagram.id})`);
  console.log("RESULT: PASS — this User Access Token can read the Page's instagram_business_account field.");
  return { userId: String(me.id), pageId, instagramAccountId: String(instagram.id), username: instagram.username || "", version };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
  } else {
    runInstagramBusinessAccountCheck().catch((error) => {
      console.error(`RESULT: FAIL — ${formatError(error)}`);
      console.error("Check that this is a User Access Token, the user has the appropriate Page task, and the app has the required permissions. A Business System User may also need business_management.");
      process.exitCode = 1;
    });
  }
}
