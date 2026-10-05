#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

const APIFY_TOKEN = process.env.APIFY_TOKEN;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long this wrapper waits for a run, in milliseconds. The run itself keeps
// the actor's own default timeout; past this wait the call returns the run id
// and console link instead of an error that hides a run still billing.
const WRAPPER_WAIT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = Number(process.env.MAMBA_POLL_INTERVAL_MS) || 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it while
// the run goes on and keeps billing. Starting the run, polling it to a terminal
// status and then reading the dataset waits as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success, so a crashed run never reads as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-ai-tooling-detector",
  version: pkg.version,
});

// AI Tooling Detector (immutable actor ID EwkHhmqiuJgRoVEbE)
server.registerTool(
  "detect_ai_tooling",
  {
    title: "Detect AI Tooling",
    description:
      "Given a company domain, determine how far that company has actually gone with AI. Returns an ai_maturity tier of none, declared (says AI but nothing observable is running), deployed (AI tooling is live on the site), or commercialized (the pricing page charges for AI via credits, tokens, an add-on, an AI-named plan, or a per-outcome price). Also returns the detected AI vendors and categories, validated llms.txt status, robots.txt AI-crawler policy, and the quotable evidence strings behind the verdict. A domain behind a bot challenge comes back with blocked=true at low confidence rather than as a false negative. Public data only, no login. Returns flat Clay-ready JSON. Read-only; requires an APIFY_TOKEN and consumes Apify credits per domain analyzed.",
    annotations: {
      title: "Detect AI Tooling",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      domain: z
        .string()
        .optional()
        .describe("A single company domain, e.g. intercom.com. Provide either domain or domains."),
      domains: z
        .array(z.string())
        .optional()
        .describe("Batch mode: several company domains analyzed in one call. Takes precedence over domain."),
      vendors: z
        .array(z.enum(["sierra", "decagon", "ada", "forethought", "intercom_fin", "ultimate_ai", "netomi", "yellow_ai", "cognigy", "kore_ai", "chatbase", "voiceflow", "sendbird_ai", "intercom", "zendesk", "drift", "gorgias", "freshworks", "tidio", "crisp", "kustomer", "qualified", "hubspot_breeze", "algolia", "glean", "inkeep", "kapa_ai", "mendable", "mutiny", "dynamic_yield", "openai_api", "anthropic_api", "azure_openai", "aws_bedrock", "google_gemini", "cohere", "mistral", "groq", "together_ai", "fireworks_ai", "replicate", "perplexity_api", "huggingface", "openrouter", "cloudflare_ai_gateway", "pinecone", "weaviate", "qdrant", "vercel_ai_sdk", "langchain", "llamaindex", "assistant_ui"]))
        .optional()
        .describe("Report only these AI vendors, which turns the actor into competitive intelligence for any one of the 52 fingerprinted tools. Detection is unchanged either way, so a filtered call costs the same. The site wide AI maturity read (ai_maturity, confidence, uses_ai, the llms.txt and robots.txt checks, the pricing score) is never narrowed by this. Omit for every vendor."),
      check_pricing: z
        .boolean()
        .optional()
        .describe("Fetch and score the pricing page. Default true. Setting this false is faster but caps the result at 'deployed', because 'commercialized' can only be proven on a pricing page."),
      skipCache: z
        .boolean()
        .optional()
        .describe("Force a fresh analysis and ignore the 7 day result cache."),
      request_timeout_ms: z
        .number()
        .int()
        .min(3000)
        .max(20000)
        .optional()
        .describe("Per-request timeout in milliseconds. 3000 to 20000. Default: 9000."),
      batchSize: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Batch mode only: how many domains the actor analyzes at once. 1 to 10. Default: 5."),
    },
  },
  async ({ domain, domains, vendors, check_pricing, skipCache, request_timeout_ms, batchSize }) => {
    const hasSingle = domain !== undefined && domain !== "";
    const hasBatch = Array.isArray(domains) && domains.length > 0;
    if (!hasSingle && !hasBatch) {
      return {
        isError: true,
        content: [{ type: "text", text: "Provide either domain (a single company domain) or domains (an array)." }],
      };
    }
    return runActor(
      "EwkHhmqiuJgRoVEbE",
      "AI Tooling Detector",
      compact({
        domain: hasBatch ? undefined : domain,
        domains: hasBatch ? domains : undefined,
        vendors,
        check_pricing,
        skipCache,
        request_timeout_ms,
        batchSize,
      }),
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
