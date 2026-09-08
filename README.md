# AI Tooling Detector MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-ai-tooling-detector)](https://smithery.ai/servers/mambabuilt/mcp-ai-tooling-detector) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-ai-tooling-detector/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-ai-tooling-detector) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-ai-tooling-detector%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-ai-tooling-detector&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-ai-tooling-detector)](https://www.npmjs.com/package/@mambalabsdev/mcp-ai-tooling-detector) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-ai-tooling-detector)](https://www.npmjs.com/package/@mambalabsdev/mcp-ai-tooling-detector) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-ai-tooling-detector)](https://github.com/mambalabsdev/mcp-ai-tooling-detector/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-ai-tooling-detector)

An MCP server that exposes the Mamba Labs AI Tooling Detector as a single tool. Install one package and give your MCP client a way to ask, for any company domain, whether that company only talks about AI, actually runs AI tooling on its site, or charges money for AI. It wraps the Mamba Labs actor on Apify and returns Clay-ready flat JSON.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Tool and inputs](#tool-and-inputs)
- [Full actor documentation](#full-actor-documentation)
- [Mamba Labs GTM Suite](#mamba-labs-gtm-suite)
- [License](#license)

## What it does

This server gives an AI client one tool:

- `detect_ai_tooling`: return an `ai_maturity` tier for a company domain, plus the evidence behind it.

The tier has four levels and each one needs its own class of evidence:

| Tier | What it means | What proves it |
|---|---|---|
| `commercialized` | The company charges for AI | AI credits, a token allowance, an AI add-on, an AI-named plan, or a per-outcome AI price on the pricing page |
| `deployed` | AI tooling is running on the site | An AI-native vendor, a direct inference endpoint, or an AI-capable platform backed by AI copy |
| `declared` | The company says AI, nothing observable | A validated llms.txt, AI crawler rules in robots.txt, or weighted marketing copy |
| `none` | No signal fired | Nothing |

A domain sitting behind a bot challenge comes back with `blocked: true` at low confidence rather than as a confident no, so a challenged site is never mistaken for a company with no AI.

All of the work runs on Apify. This package is a thin client that routes the tool call to the actor and hands back the result.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mamba-ai-tooling-detector": {
      "command": "npx",
      "args": ["-y", "@mambalabsdev/mcp-ai-tooling-detector"],
      "env": { "APIFY_TOKEN": "your-apify-token" }
    }
  }
}
```

Restart the client and the `detect_ai_tooling` tool appears.

## Prerequisites

- Node.js 18 or newer
- An Apify API token from https://console.apify.com/account/integrations

Calls consume Apify credits, billed per domain analyzed. Free Apify plans get 15 results per calendar month.

## Example prompts

- "Does intercom.com actually charge for AI, or do they just market it?"
- "Check notion.so, figma.com and berkshirehathaway.com for AI adoption and tell me which ones already pay for AI."
- "Which AI vendors are running on zendesk.com?"
- "Does cursor.com publish an llms.txt, and does their robots.txt block GPTBot?"

## Tool and inputs

`detect_ai_tooling`

| Input | Type | Required | Description |
|---|---|---|---|
| `domain` | string | one of these | A single company domain, e.g. `intercom.com`. |
| `domains` | string[] | one of these | Batch mode. Takes precedence over `domain`. |
| `vendors` | array | no | Report only these AI vendors, one or more of the 52 fingerprinted tools (`sierra`, `decagon`, `intercom_fin`, `openai_api`, `anthropic_api`, `pinecone`, `langchain` and the rest). The site wide AI maturity read is never narrowed by this. Omit for every vendor. |
| `check_pricing` | boolean | no | Fetch and score the pricing page. Default true. Setting it false is faster but caps the result at `deployed`, because `commercialized` can only be proven on a pricing page. |
| `skipCache` | boolean | no | Force a fresh analysis and ignore the 7 day result cache. |

The tool is read-only and idempotent. It never writes anything.

## Full actor documentation

Input reference, the complete output field list, pricing tiers, error handling, and the measured limitations are on the actor's Apify Store page:

https://apify.com/mambalabs/ai-tooling-detector

Immutable actor ID: `EwkHhmqiuJgRoVEbE`

## Mamba Labs GTM Suite

This server is part of the **Mamba Labs GTM Suite**, a fleet of specialized MCP servers for go-to-market signal intelligence, each backed by a dedicated Apify actor. The [`@mambalabsdev/mcp-gtm-suite`](https://www.npmjs.com/package/@mambalabsdev/mcp-gtm-suite) umbrella server exposes all of them, including this one, through a single install.

| Actor | Immutable Actor ID |
|---|---|
| [GTM Hiring Signal Scraper](https://console.apify.com/actors/D7O1SA2EqwHGsGr1P) | `D7O1SA2EqwHGsGr1P` |
| [GTM Tech Stack Signal Enrichment](https://console.apify.com/actors/qyd7nNyqFPelQViBx) | `qyd7nNyqFPelQViBx` |
| [GTM Signals Aggregator](https://console.apify.com/actors/xKdRfnfFNkdMpFuNs) | `xKdRfnfFNkdMpFuNs` |
| [Job Board Keyword Signal Scanner](https://console.apify.com/actors/4DvqpvhMR74NLcDDY) | `4DvqpvhMR74NLcDDY` |
| [Domain to LinkedIn URL Resolver](https://console.apify.com/actors/3HtnSaqPHOg1Qg5gx) | `3HtnSaqPHOg1Qg5gx` |
| [ICP Fit Scorer](https://console.apify.com/actors/W161DT8W4kW55dMFh) | `W161DT8W4kW55dMFh` |
| [Domain Deliverability Checker](https://console.apify.com/actors/0tVgxI7A6o9jMlxmc) | `0tVgxI7A6o9jMlxmc` |
| [Company Firmographic Enricher](https://console.apify.com/actors/YlUtLWjfPpqykmB8g) | `YlUtLWjfPpqykmB8g` |
| [Company Social Presence Mapper](https://console.apify.com/actors/4k6CCemkgBDz18m2h) | `4k6CCemkgBDz18m2h` |
| [Company Identity Resolver](https://console.apify.com/actors/lr8fTRAmZCBZmuwwh) | `lr8fTRAmZCBZmuwwh` |
| [Company Change-Event Feed](https://console.apify.com/actors/oX44rS0fkEJ3rXLWe) | `oX44rS0fkEJ3rXLWe` |
| [Funding & Press Signal Scanner](https://console.apify.com/actors/FS13X6dhQVgX3XOM6) | `FS13X6dhQVgX3XOM6` |
| [AI Tooling Detector](https://console.apify.com/actors/EwkHhmqiuJgRoVEbE) | `EwkHhmqiuJgRoVEbE` |

> Built by [Mamba Labs](https://github.com/mambalabsdev) | [npm](https://www.npmjs.com/org/mambalabsdev) | [Apify Store](https://apify.com/mambalabs)

## License

MIT

Built by Mamba Labs. https://apify.com/mambalabs
