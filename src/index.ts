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

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?timeout=300`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }

    let message: string;
    switch (response.status) {
      case 401:
        message = "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
        break;
      case 402:
        message =
          "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
        break;
      case 408:
        message = `The ${actorLabel} run timed out after 300 seconds. Try again, or run the actor on Apify directly for longer jobs.`;
        break;
      default:
        message = `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
    return { isError: true, content: [{ type: "text", text: message }] };
  }

  const items = await response.json();
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
        .optional()
        .describe("Per-request timeout in milliseconds. 3000 to 20000. Default: 9000."),
    },
  },
  async ({ domain, domains, check_pricing, skipCache, request_timeout_ms }) => {
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
        check_pricing,
        skipCache,
        request_timeout_ms,
      }),
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
