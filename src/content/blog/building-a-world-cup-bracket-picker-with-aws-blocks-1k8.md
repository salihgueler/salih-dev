---
title: "Building a World Cup Bracket Picker with AWS Blocks"
description: "Create a full-stack World Cup bracket picker with AWS Blocks, combining authentication, structured data, real-time updates, scheduled jobs, and an AI agent."
pubDate: "2026-06-18T07:28:45Z"
updatedDate: "2026-06-18T13:26:54Z"
category: "AWS Blocks"
tags: ["aws","fullstack","blocks"]
hero:
  src: "https://salih.dev/images/blog/3929764-building-a-world-cup-bracket-picker-with-aws-blocks-1k8.webp"
  alt: "Cover image for Building a World Cup Bracket Picker with AWS Blocks"
  credit: "DEV Community"
  creditUrl: "https://dev.to/aws/building-a-world-cup-bracket-picker-with-aws-blocks-1k8"
aiSummary: "Create a full-stack World Cup bracket picker with AWS Blocks, combining authentication, structured data, real-time updates, scheduled jobs, and an AI agent."
originalUrl: "https://dev.to/aws/building-a-world-cup-bracket-picker-with-aws-blocks-1k8"
sources: [{"name":"DEV Community","url":"https://dev.to/aws/building-a-world-cup-bracket-picker-with-aws-blocks-1k8"}]
draft: false
---

AWS just launched [AWS Blocks](https://aws.amazon.com/products/developer-tools/blocks/), an open-source TypeScript framework that gives you backend capabilities on AWS without learning infrastructure tools. Everything runs locally without an AWS account. When you're ready, deploy the same code to AWS with zero changes.

In this post, I'll build a full-stack World Cup bracket picker with it. The app lets users:

- Pick 1st, 2nd, and 3rd place in each of the 12 groups
- Predict knockout round winners all the way to the final
- Chat with an AI agent that knows every team's roster and FIFA ranking
- See other users' picks appear in real time
- Automatically sync real match results on an hourly schedule
- Compete on a leaderboard once real results come in

The full source code is on [GitHub](https://github.com/salihgueler/worldcup-bracket-picker). The `mock` branch has the frontend-only starting point with prompts if you want to build along.

::youtube{id="cBtInhCQTpQ" title="Building a World Cup Bracket Picker with AWS Blocks video 1"}

## Prerequisites

- Node.js 22 or higher
- An IDE ([Kiro](https://kiro.dev) is preferred)
- Ollama (optional, for running the AI agent locally)

## Getting ready

Clone the repository and checkout the `mock` branch. This gives you a React 19 + Vite + Tailwind frontend with all the UI components already built, but no backend.

```bash
git clone https://github.com/salihgueler/worldcup-bracket-picker.git
cd worldcup-bracket-picker
git checkout mock
npm install
npm run dev
```

Open `http://localhost:3000` to see the UI shell. Nothing works yet because there's no backend.

Next, add AWS Blocks to the project:

```bash
npm create @aws-blocks/blocks-app@latest .
```

This scaffolds an `aws-blocks/` folder with a dev server, CDK deployment config, and a sample todo app. We'll replace the sample code with our own. Run `npm run dev` again and you'll see both the Vite frontend on port 3000 and the Blocks backend on port 3001.

## Authentication

AWS Blocks offers different authentication types: basic username/password, Cognito User Pools, and OIDC/OAuth2 with external providers like Google or GitHub. For this app, we'll use basic auth. It stores credentials in a database and issues JWT tokens for session management.

```typescript
import { Scope, AuthBasic } from "@aws-blocks/blocks";

const scope = new Scope("wc");

const auth = new AuthBasic(scope, "auth", {
  passwordPolicy: { minLength: 8, requireDigits: true },
});

export const authApi = auth.createApi();
```

`Scope` defines the resource boundary for the app. All blocks attach to it. `AuthBasic` creates the auth system with a password policy. `auth.createApi()` exports a state-machine API that the frontend Authenticator widget hooks into.

You can configure session duration, cross-domain cookies for sandbox mode, email code delivery, and more. For now, the defaults work fine.

On the frontend, open `AuthGate.tsx` and wire up the Authenticator widget:

```typescript
import { useEffect, useRef, type ReactNode } from "react";
import { authApi } from "aws-blocks";
import { Authenticator } from "@aws-blocks/blocks/ui";
import { useAuth } from "../hooks/useAuth";

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading || user || !mountRef.current) return;
    const host = mountRef.current;
    host.innerHTML = "";
    host.appendChild(Authenticator(authApi));
    return () => {
      host.innerHTML = "";
    };
  }, [loading, user]);

  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <div ref={mountRef} />;
  return <>{children}</>;
}
```

The `Authenticator` is a framework-agnostic DOM element. It renders sign-up/sign-in forms and is tied directly to `authApi`. When auth state changes, it updates automatically. The `useAuth` hook listens for those changes:

```typescript
import { useState, useEffect, useCallback } from "react";
import { authApi } from "aws-blocks";
import { onAuthChange, broadcastAuthChange } from "@aws-blocks/blocks/ui";

export interface AuthUser {
  userId: string;
  username: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange(authApi, (u) => {
      setUser(u ? { userId: u.userId, username: u.username } : null);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signOut = useCallback(async () => {
    const next = await authApi.setAuthState({ action: "signOut" });
    broadcastAuthChange(next.user ?? null);
  }, []);

  return { user, loading, signOut };
}
```

`onAuthChange` subscribes to auth state changes across the same window and across tabs. It fires immediately with the current user, then on every sign-in or sign-out.

## Data

Blocks gives you three storage options: NoSQL tables (`DistributedTable`), Postgres (`Database`), and key-value (`KVStore`). We'll use `DistributedTable` for structured data with indexes and `KVStore` for simple flags.

The scaffolder generates a sample todos table. Here's what a `DistributedTable` looks like:

```typescript
const todoSchema = z.object({
  userId: z.string(),
  todoId: z.string(),
  title: z.string(),
  completed: z.boolean(),
  priority: z.number(),
  version: z.number(),
  createdAt: z.number(),
});

const todos = new DistributedTable(scope, "todos", {
  schema: todoSchema,
  key: { partitionKey: "userId", sortKey: "todoId" },
  indexes: {
    byPriority: { partitionKey: "userId", sortKey: "priority" },
    byTitle: { partitionKey: "userId", sortKey: "title" },
  },
});
```

One Zod schema gives you runtime validation, TypeScript types, and the database shape in a single definition. The `partitionKey` determines how items are distributed across storage. The `sortKey` orders items within a partition. Indexes let you query by different sort orders without scanning the entire table.

Remove the todos code and add the match table for our World Cup data:

```typescript
const matchSchema = z.object({
  matchId: z.string(),
  matchType: z.string(),
  stage: z.string(),
  team1Id: z.string(),
  team2Id: z.string(),
  scheduledDate: z.string(),
  result: z.string().optional(),
  score: z.string().optional(),
});

const matches = new DistributedTable(scope, "matches", {
  schema: matchSchema,
  key: { partitionKey: "matchType", sortKey: "matchId" },
  indexes: {
    byStage: { partitionKey: "stage", sortKey: "matchId" },
  },
});
```

For simple per-user state like "has this user locked their bracket?", `KVStore` is easier than a full table:

```typescript
const lockStore = new KVStore<boolean>(scope, "bracket-lock");
```

CRUD operations are straightforward:

```typescript
// Upsert (insert or update)
await matches.put({ ...match, result, score });

// Batch write
await matches.putBatch(items);

// Delete
await matches.delete({ matchType: "MATCH", matchId });

// Query by index
const groupMatches = await Array.fromAsync(
  matches.query({
    index: "byStage",
    where: { stage: { equals: "group" } },
  })
);
```

The frontend calls these through `ApiNamespace` methods. Types flow end-to-end from the Zod schema to the frontend function call with no code generation step.

## Realtime

Blocks supports WebSocket pub/sub through the `Realtime` block. In our app, users see other people's bracket picks appear live as they're made.

First, create the picks table and a Realtime block:

```typescript
const picks = new DistributedTable(scope, "picks", {
  schema: pickSchema,
  key: { partitionKey: "oddsType", sortKey: "oddsId" },
  indexes: {
    byUser: { partitionKey: "userId", sortKey: "matchId" },
    byMatch: { partitionKey: "matchId", sortKey: "userId" },
  },
});

const PICKS_CHANNEL = "all";
const rt = new Realtime(scope, "rt", {
  namespaces: {
    picks: Realtime.namespace(
      z.object({
        userId: z.string(),
        username: z.string(),
        matchId: z.string(),
        predictedWinner: z.string(),
      }),
    ),
  },
});
```

When a user makes a pick, publish it to the channel:

```typescript
await rt.publish("picks", PICKS_CHANNEL, {
  userId: user.userId,
  username: user.username,
  matchId,
  predictedWinner,
});
```

On the frontend, subscribe to the channel and render events as they arrive:

```typescript
const sub = channel.subscribe((msg: PickEvent) => {
  setEvents((prev) => [msg, ...prev].slice(0, MAX_EVENTS));
});
```

What this gives you:

- One Zod schema defines the database shape, TypeScript types, and runtime validation. Defined once.
- `makePick` does auth, a database write, and a realtime broadcast in three lines. No API Gateway config, no DynamoDB setup, no WebSocket server.
- The same code runs locally with automatic mocks and deploys to AWS with zero config.
- The realtime payload type flows straight from the schema into your `subscribe` handler with full type safety.

## Agents

My favorite feature of Blocks is the Agent block. You define an AI agent with tools that have direct access to your data layer. Locally it runs with Ollama (or a canned mock if Ollama isn't available). On AWS it runs on Amazon Bedrock.

```typescript
const predictor = new Agent(scope, "predictor", {
  model: {
    deployed: BedrockModels.BALANCED,
    local: OllamaModels.SMALL,
  },
  systemPrompt: [
    "You are the official AI predictor for FIFA World Cup 2026.",
    "You help fans understand the teams and forecast match outcomes.",
    "Always ground your answers in real data by calling your tools:",
    "- lookupTeam to fetch a team's group, FIFA ranking, and confederation",
    "- getTeamSquad to inspect a team's player roster",
    "- getMatchConsensus to see how the community has picked a match",
    "- getUserBracket to review the current user's predictions",
    "- getMatchResult to fetch the actual outcome of a played match",
  ].join("\n"),
  toolContextSchema: z.object({ userId: z.string() }),
  tools: (tool) => ({
    lookupTeam: tool({
      description: "Look up a team's details by id or name",
      parameters: z.object({
        teamId: z.string().describe("Team id (e.g. 'BRA') or full name"),
      }),
      handler: async ({ input }) => {
        const direct = await teams.get({ type: "TEAM", teamId: input.teamId });
        if (direct) return direct;
        // Fallback: case-insensitive name search
        const all = await Array.fromAsync(
          teams.query({ where: { type: { equals: "TEAM" } } })
        );
        const needle = input.teamId.trim().toLowerCase();
        return all.find(
          (t) => t.name.toLowerCase().includes(needle) ||
                 t.teamId.toLowerCase() === needle
        ) ?? { error: `No team found matching "${input.teamId}"` };
      },
    }),
    // getTeamSquad, getMatchConsensus, getUserBracket, getMatchResult...
  }),
});
```

The `tools` callback pattern gives each tool typed `input` derived from its Zod `parameters` schema. The `toolContextSchema` passes the authenticated user's ID into tools so they can scope queries to the caller, without the model seeing it.

To expose the agent via your API:

```typescript
export const api = new ApiNamespace(scope, "api", (context) => ({
  async chatWithPredictor(message: string) {
    const user = await auth.requireAuth(context);
    let conversationId = await predictorConversations.get(user.username);
    if (!conversationId) {
      conversationId = await predictor.createConversationId(user.username);
      await predictorConversations.put(user.username, conversationId);
    }
    const result = await predictor.stream(message, {
      conversationId,
      userId: user.username,
      context: { userId: user.username },
    });
    return { reply: (await result.complete()).text ?? "" };
  },
}));
```

From the frontend, one function call:

```typescript
const { reply } = await api.chatWithPredictor(message);
```

To run the agent locally with a real LLM, install Ollama and pull a model:

```bash
ollama serve
ollama pull llama3.1:8b
```

If Ollama isn't running, Blocks falls back to a canned provider that returns keyword-based mock responses. Zero config needed either way.

## Scheduled tasks

AWS Blocks lets you write cloud functions that trigger on a schedule. For our app, an hourly job checks for new match results from a public API, updates the database, and refreshes the leaderboard:

```typescript
new CronJob(scope, "results-sync", {
  schedule: "rate(1 hour)",
  description: "Check for finished matches and refresh the leaderboard.",
  handler: async (event) => {
    console.log(`[results-sync] triggered at ${event.scheduledTime}`);
    const summary = await syncMatchResultsFromFeed();
    const standings = await refreshLeaderboard();
    console.log(
      `[results-sync] done — checked ${summary.checked}, ` +
      `updated ${summary.updated}; leaderboard has ${standings.length} entries`
    );
  },
});
```

The handler fetches results from [openfootball's World Cup JSON feed](https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.json), matches them against our fixtures, writes scores to the database, and recomputes standings. Locally, the job runs synchronously in-process when triggered. On AWS, it becomes an EventBridge Scheduler + Lambda.

## Running the app

```bash
npm run dev
```

Open `http://localhost:3000`. Sign up with a username and password. On first login, `ensureSeeded()` populates the database with all 48 teams, their 26-player rosters, and 88 group-stage matches. Start picking your bracket.

Mock data persists in `.bb-data/` across dev server restarts. To reset everything: `rm -rf .bb-data`.

## Deploying to AWS

When you're ready to go live:

```bash
npm run sandbox          # Ephemeral backend on AWS (2-3 minutes)
npm run deploy           # Production with S3 + CloudFront hosting
npm run sandbox:destroy  # Tear down when done
```

No AWS experience required. The same code you tested locally runs on DynamoDB, Lambda, API Gateway, AppSync, and CloudFront without changes.

## Conclusion

We built a full-stack World Cup bracket picker with authentication, structured data, realtime updates, an AI agent, and scheduled background jobs. Every block ran locally with zero AWS credentials. The source code is on [GitHub](https://github.com/salihgueler/worldcup-bracket-picker) (full implementation on `main`, frontend-only starting point on `mock`).

To get started with AWS Blocks:

- [AWS Blocks product page](https://aws.amazon.com/products/developer-tools/blocks/)
- [Getting started guide](https://docs.aws.amazon.com/blocks/latest/devguide/getting-started.html)
- [AWS Blocks on GitHub](https://github.com/aws-devtools-labs/aws-blocks)
