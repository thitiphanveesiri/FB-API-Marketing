#!/usr/bin/env node
/**
 * Read-only diagnostic for a Meta User Access Token and connected Page tokens.
 * The supplied token is read from the environment, sent only in Authorization headers,
 * and never printed. Returned Page Access Tokens remain in memory and are not output.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_VERSION = "v27.0";
const VERSION_SHAPE = /^v\d+\.\d+$/;
const REQUEST_TIMEOUT_MS = 15_000;

function safeText(value, token) {
  let text = String(value ?? "");
  if (token) text = text.replaceAll(token, "[redacted]");
  return text.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").replace(/\bEAA[\w-]{20,}\b/g, "[redacted]");
}

function versionFromEnv(raw = process.env.META_API_VERSION) {
  if (!raw?.trim()) return DEFAULT_VERSION;
  const version = raw.trim().toLowerCase().startsWith("v") ? raw.trim() : `v${raw.trim()}`;
  if (!VERSION_SHAPE.test(version)) throw new Error("META_API_VERSION must look like v27.0 or 27.0.");
  return version;
}

function apiClient({ token, base, version }) {
  return async function graphGet(path, params = {}, requestToken = token) {
    const url = new URL(`${base}/${version}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${requestToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error) {
      const error = payload?.error ?? {};
      const message = safeText(error.message || `HTTP ${response.status} from Meta Graph API`, requestToken);
      const details = [
        `HTTP ${response.status}`,
        error.code != null ? `Meta code ${error.code}` : "",
        error.error_subcode != null ? `subcode ${error.error_subcode}` : "",
        error.fbtrace_id ? `trace ${error.fbtrace_id}` : "",
      ].filter(Boolean).join(", ");
      throw new Error(`${message} (${details})`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`Meta returned an unexpected response for ${path}.`);
    return payload;
  };
}

async function listPages(graphGet) {
  const pages = [];
  let after;
  for (let page = 0; page < 10; page++) {
    const result = await graphGet("me/accounts", {
      fields: "id,name,tasks,access_token",
      limit: "100",
      ...(after ? { after } : {}),
    });
    if (Array.isArray(result.data)) pages.push(...result.data);
    after = result.paging?.cursors?.after;
    if (!after) return { pages, complete: true };
  }
  return { pages, complete: false };
}

const permissionStatus = (permissions, name) => permissions.find((item) => item.permission === name)?.status || "not returned";

export async function runMetaPageTokenCheck(env = process.env) {
  const token = (env.META_USER_ACCESS_TOKEN || env.FB_USER_ACCESS_TOKEN || "").trim();
  if (!token) throw new Error("Set META_USER_ACCESS_TOKEN in the environment; do not pass a token as a command-line argument.");
  if (/\s/.test(token)) throw new Error("The access token contains whitespace; check that it was copied as one complete value.");
  const version = versionFromEnv(env.META_API_VERSION);
  const base = (env.FB_GRAPH_BASE || "https://graph.facebook.com").replace(/\/+$/, "");
  let parsedBase;
  try { parsedBase = new URL(base); } catch { throw new Error("FB_GRAPH_BASE must be a valid HTTPS URL."); }
  if (parsedBase.protocol !== "https:") throw new Error("FB_GRAPH_BASE must use HTTPS because requests carry access tokens.");

  const graphGet = apiClient({ token, base, version });
  console.log(`Graph API version: ${version}`);
  console.log("Credential supplied: value hidden; /me will verify current usability. Expiry metadata and formal token type are not queried via /debug_token.");

  const me = await graphGet("me", { fields: "id,name" });
  console.log(`Token identity: ${me.name || "unnamed account"} (ID ${me.id || "not returned"})`);

  let permissions = [];
  try {
    const result = await graphGet("me/permissions", { fields: "permission,status" });
    permissions = Array.isArray(result.data) ? result.data : [];
    for (const permission of ["ads_read", "pages_show_list", "pages_read_engagement"]) {
      console.log(`Permission ${permission}: ${permissionStatus(permissions, permission)}`);
    }
  } catch (error) {
    console.warn(`Permission listing unavailable: ${safeText(error.message, token)}`);
  }

  let pageResult;
  try {
    pageResult = await listPages(graphGet);
    console.log(`/me/accounts: ${pageResult.pages.length} Page(s) visible${pageResult.complete ? " (all returned pages checked)" : " (stopped after 1,000 entries)"}.`);
    const wantedPageId = (env.FB_PAGE_ID || env.META_PAGE_ID || "").trim();
    for (const page of pageResult.pages) {
      if (wantedPageId && String(page.id) !== wantedPageId) continue;
      const tasks = Array.isArray(page.tasks) ? page.tasks.map(String) : [];
      console.log(`Page ${page.name || "unnamed"} (ID ${page.id}): tasks=${tasks.length ? tasks.join(", ") : "not returned"}; Page token=${page.access_token ? "available (hidden)" : "not returned"}.`);
    }
    if (wantedPageId && !pageResult.pages.some((page) => String(page.id) === wantedPageId)) {
      console.warn(`Page ${wantedPageId} was not returned by /me/accounts. Check pages_show_list, business assignment, and the user's Page access.`);
    }
  } catch (error) {
    console.warn(`Page-list/tasks check unavailable: ${safeText(error.message, token)}`);
  }

  const accountId = (env.META_TEST_AD_ACCOUNT_ID || "").trim().replace(/^act_/, "");
  if (accountId) {
    if (!/^\d+$/.test(accountId)) throw new Error("META_TEST_AD_ACCOUNT_ID must contain only digits (an optional act_ prefix is accepted).");
    try {
      const account = await graphGet(`act_${accountId}`, { fields: "id,name,account_status,currency" });
      console.log(`Ad Account lookup: PASS — ${account.name || "unnamed account"} (ID ${account.id || accountId}, status ${account.account_status ?? "not returned"}, currency ${account.currency || "not returned"}).`);
    } catch (error) {
      console.warn(`Ad Account lookup: FAIL — ${safeText(error.message, token)}. Confirm ads_read and that the user/token is assigned to this account.`);
    }
  }

  const storyId = (env.META_TEST_STORY_ID || "").trim();
  if (storyId) {
    if (!/^\d+_\d+$/.test(storyId)) throw new Error("META_TEST_STORY_ID must be a Page post ID in the form PAGE_ID_POST_ID.");
    const pageId = storyId.split("_", 1)[0];
    const page = pageResult?.pages.find((item) => String(item.id) === pageId && item.access_token);
    if (!page) {
      console.warn(`Page story lookup: SKIPPED — no Page Access Token for source Page ${pageId} was returned by /me/accounts.`);
    } else {
      try {
        const post = await graphGet(storyId, { fields: "id,full_picture,message,attachments{media_type,target{id}}" }, page.access_token);
        const attachments = Array.isArray(post.attachments?.data) ? post.attachments.data : [];
        console.log(`Page story lookup: PASS — Page ${pageId}; full_picture=${post.full_picture ? "returned" : "not returned"}; message=${post.message ? "returned (content hidden)" : "not returned"}; attachments=${attachments.length}.`);
      } catch (error) {
        console.warn(`Page story lookup: FAIL — ${safeText(error.message, token)}. Check the source Page token, pages_read_engagement, and Page tasks.`);
      }
    }
  }

  return { userId: String(me.id || ""), version, visiblePageCount: pageResult?.pages.length ?? null };
}

function printHelp() {
  console.log(`Read-only Meta token, Page list/tasks, and optional Ad Account/story diagnostic.

Required:
  META_USER_ACCESS_TOKEN    User Access Token (never pass it as an argument)

Optional:
  FB_PAGE_ID                Limit printed Page details to this Page ID
  META_TEST_AD_ACCOUNT_ID   Check account visibility, e.g. 123456789 or act_123456789
  META_TEST_STORY_ID        Check a Page story, e.g. PAGE_ID_POST_ID, using its Page token
  META_API_VERSION          Defaults to ${DEFAULT_VERSION}
  FB_GRAPH_BASE             Defaults to https://graph.facebook.com

Run: node scripts/check-meta-page-token.mjs
No write operations are performed and tokens are never printed.
`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) printHelp();
  else runMetaPageTokenCheck().catch((error) => {
    console.error(`RESULT: FAIL — ${safeText(error.message, process.env.META_USER_ACCESS_TOKEN || process.env.FB_USER_ACCESS_TOKEN)}`);
    process.exitCode = 1;
  });
}
