---
title: "7 Tips to Make Your AI Agent More Predictable"
description: "After months of building with AI coding tools, I found the difference between generated code that..."
pubDate: "2026-08-11T10:20:35Z"
category: "AI Development"
tags: ["ai","programming","productivity","aidlc"]
hero:
  src: "https://salih.dev/images/blog/4361150-7-tips-to-make-your-ai-agent-more-predictable-1ga4.webp"
  alt: "Cover image for 7 Tips to Make Your AI Agent More Predictable"
  credit: "DEV Community"
  creditUrl: "https://dev.to/aws/7-tips-to-make-your-ai-agent-more-predictable-1ga4"
aiSummary: "After months of building with AI coding tools, I found the difference between generated code that..."
originalUrl: "https://dev.to/aws/7-tips-to-make-your-ai-agent-more-predictable-1ga4"
sources: [{"name":"DEV Community","url":"https://dev.to/aws/7-tips-to-make-your-ai-agent-more-predictable-1ga4"}]
draft: false
---

After months of building with AI coding tools, I found the difference between generated code that works and generated code that ships comes down to how you communicate with the AI. I have been sharing these lessons in a talk called "It's Dangerous to Code Alone! Take This: Developer's AI Survival Guide" and people keep asking me to write them down. How big is the gap? An [MIT study across 100,000+ developers](https://www.forbes.com/sites/josipamajic/2026/06/10/ai-coding-agents-write-180-more-code-but-ship-only-30-more-software/) found that AI agents boosted code *written* by ~180%, while code that actually *shipped to production* rose by only ~30%.

::youtube{id="Uf7FvWcqoDw" title="7 Tips to Make Your AI Agent More Predictable video 1"}

To demonstrate these tips, I built a link-sharing platform so my teammates can share resources without juggling multiple QR codes. I generated the frontend with Codex GPT 5.6 Sol and Figma MCP, and I am adding an AWS Blocks backend to swap out local mocks with real cloud infrastructure. You can find all the prompts in [this repository](https://github.com/salihgueler/some-useful-links).

All of these tips are applicable to greenfield projects as well. I can't promise you it is going to have the 42 effect :)

## #1 Talk to AI in Clear Prompts

Each model reacts to prompts differently. The clearer you get, the faster you achieve your goal.

You also need to remember that now we don't only have models, we also have effort levels. If you are not mindful about which model you are running with which effort level, you will have a hard time getting the results you want.

Here are some general rules I follow (you can check the `BUILD_PROMPT.md` and the AWS Blocks skill in the repo for the full picture):

### Zero-Shot

Describe what you want. Works for simple, well-defined tasks.

Here is my frontend build prompt. One sentence, clear outcome:

```markdown
Build "Some Useful Links" — a LinkTree-style web application using
Next.js with SSR enabled. The complete visual design specification
is in `DESIGN_SPEC.md` and reference screenshots are in the
`design-previews/` folder. Implement the design pixel-perfectly.
```

And for the backend migration to AWS Blocks:

```markdown
Replace the local JSON mock services in src/lib/services/local/ with
AWS Blocks implementations. The service registry (index.ts) is the
only file that should change in the existing codebase. Frontend must
not be modified.
```

Both are zero-shot: one clear task, no ambiguity.

### Few-Shot

Show examples. Input, output. Input, output. The model picks up the shape. Research shows the format matters more than whether the examples are perfectly correct.

In my `BUILD_PROMPT.md`, I use this for the service registry pattern. I show the AI what an implementation swap looks like:

```typescript
// src/lib/services/index.ts
import { LocalAnalyticsStore } from './local/analytics-store.local';
import { LocalLinkStore } from './local/link-store.local';
import { LocalVisitTracker } from './local/visit-tracker.local';

// SWAP POINT: Replace these with cloud implementations
export const analyticsStore = new LocalAnalyticsStore();
export const linkStore = new LocalLinkStore();
export const visitTracker = new LocalVisitTracker();
```

When I ask the AI to build the AWS Blocks backend, it sees this pattern and knows the target: create a `BlocksAnalyticsStore`, `BlocksLinkStore`, and `BlocksVisitTracker` that implement the same interfaces, then swap them in `index.ts`. I do not need to explain the concept of dependency injection. The example IS the explanation.

### Chain-of-Thought

Force the model to reason step by step before acting. For debugging, architecture decisions, or anything multi-step, this cuts logical errors significantly.

I use this when asking the AI to plan the AWS Blocks migration:

```markdown
Before writing any code, analyze the existing service interfaces in
src/lib/services/interfaces/. For each interface method, determine:
1. Which AWS Blocks building block maps to it (DistributedTable, KVStore, FileBucket, etc.)
2. What the key schema should be to support the query patterns
3. Whether the method needs authentication (check if the frontend
   calls it from an admin route or a public route)

Write your analysis as a numbered plan. I will review it before you
start implementing.
```

The AI produces a plan I can review before it writes a single line of code. Without this step, it would just start building and often pick the wrong storage pattern for a given query.

## #2 Set Absolute Boundaries

Use words like **MUST**, **NEVER**, **ALWAYS**, and **STRICTLY FORBIDDEN**. Avoid weak phrasing like "Please try to," "It is preferred," or "Usually we do."

Here is a comparison from my project. The frontend `BUILD_PROMPT.md` sets boundaries like this:

```markdown
All backend infrastructure must be local mocks — no cloud dependencies.
The mocks must be documented clearly enough that another AI agent or
developer can swap them for any cloud provider without restructuring.
```

And the AWS Blocks skill sets boundaries for the backend side:

```markdown
Backend lives in `aws-blocks/index.ts`. Frontend imports from
'aws-blocks' (workspace package). The `client.js` is auto-generated
— never edit it.
```

Both are direct, absolute, and leave no room for interpretation.

### Prioritize negative boundaries (Guardrails)

Telling the AI what NOT to do is often more effective than listing everything it should do.

**Frontend (`AGENTS.md`):**

```markdown
- Do not add cloud SDKs, deployment configuration, external persistence,
  or source-controlled credentials unless the task explicitly requires them.
- Import services from `@/lib/services`; components and route handlers
  must not import `src/lib/services/local/*` directly.
- Keep unrelated refactors and generated-file churn out of focused changes.
```

**Backend (AWS Blocks skill):**

```markdown
- Adding to an existing project? Scaffold into a temp dir, copy only
  `aws-blocks/` folder, then manually merge workspace config, scripts,
  and dependencies. The scaffolder overwrites root package.json,
  tsconfig.json, vite.config.ts, .gitignore.
- Never edit index.cdk.ts, index.handler.ts, or client.js — these are
  auto-generated.
```

## #3 Give Your AI Persistent Context

You need to steer the agent in the correct direction. AI tools have dedicated files for this purpose:

- `AGENTS.md`
- `CLAUDE.md`
- Kiro steering files (`.kiro/steering/`)
- Kiro skills (`.kiro/skills/`)

Some of these are loaded every session (steering files), giving the AI persistent rules. Others are loaded on demand (skills), giving the AI specialized knowledge only when it needs it. Both keep your context window lean.

### Always-loaded: Steering files

For the frontend, I have an `AGENTS.md` at the root that covers the full Next.js application:

```markdown
# AGENTS.md

## Project Overview
Some Useful Links is a local-first, multi-page link-sharing application
built with Next.js App Router, React, strict TypeScript, and Tailwind CSS.

## Commands
npm install
npm run dev
npm run validate:links
npm run lint
npm run build

## Architecture
- src/app: App Router pages, layouts, route handlers
- src/components: UI grouped by admin, analytics, layout, links, share
- src/lib/services/interfaces: Backend-neutral service contracts
- src/lib/services/local: Local JSON-backed implementations
- src/lib/services/index.ts: The only provider registration and swap point
```

I also have two Kiro steering files that enforce cross-cutting rules regardless of the task:

**TypeScript rules** (`.kiro/steering/typescript.md`) — enforces strict typing and build validation:

```markdown
# TypeScript Project Instructions

## Workflows & Validation
- Pre-completion Check: Before completing any task or reporting success,
  you MUST run `npm run build` in the terminal.
- Do not consider a task finished if the build command returns errors. Fix
  the errors first.

## Coding Conventions
- Strict typing is enforced. You are strictly forbidden from using the
  `any` type.
- Always define and apply the exact, correct types and interfaces for all
  variables, function parameters, and return values.
- You are STRICTLY FORBIDDEN from using @ts-ignore.
  If unavoidable, use @ts-expect-error with a detailed comment.
```

**Agent behavior rules** (`.kiro/steering/agent.md`) — controls what the AI can and cannot do on its own:

```markdown
# Agent Behavior Rules

## File and Folder Boundaries
- DO NOT create any new Markdown files unless explicitly instructed by
  the user.
- STRICTLY FORBIDDEN to auto-generate changelogs or documentation.
- You MUST update the existing README.md if your changes alter the
  project's public API or architecture.

## Technology Boundaries
- You MUST ALWAYS use the Strands Agents library with TypeScript for any
  agent development.
- You are STRICTLY REQUIRED to use Claude Haiku 4.5 from Amazon Bedrock
  for all agent models.
- You MUST ALWAYS use React and Vite with TypeScript for web development.
- NEVER write or generate unit tests unless the user explicitly commands
  it.

## Security Boundaries
- NEVER commit or hardcode sensitive information (client secrets, API
  keys, client IDs, resource IDs).

## Git Boundaries
- Commits MUST stay under 150 lines of source code.
- Every commit: single-sentence summary, blank line, detailed explanation
  (max 20 lines).
- You MUST append `(Kiro)` to the author name using:
  git commit --author="[Git Username] (Kiro) <[User Email]>"
```

These prevent the common annoyances: AI generating unwanted test files, committing giant diffs, sneaking `any` types past the compiler, or littering the repo with markdown files nobody asked for.

### On-demand: Skills

Steering files are always loaded. But what about capabilities that are only needed sometimes? You do not want to load everything upfront because that wastes context.

A **Skill** is a reusable, discoverable capability. The AI loads it only when it becomes relevant to the current task. The most important part of a Skill is the name and description. That is how the AI decides whether to use it.

My AWS Blocks skill activates with this frontmatter:

```yaml
---
name: building-aws-blocks-apps
description: Builds fullstack TypeScript applications on AWS using
  @aws-blocks/blocks. Use when working with any Building Block
  (KVStore, DistributedTable, Agent, AuthBasic...), ApiNamespace,
  BlocksStack, or the create-blocks-app CLI.
---
```

The main `SKILL.md` is the overview: decision guides, project structure, quick start. Detailed reference lives in separate files:

```plaintext
.kiro/skills/aws-blocks-development/
├── SKILL.md                    # Overview + decision guide (under 200 lines)
├── CORE-ARCHITECTURE.md        # Scope, ApiNamespace, JSON-RPC, CORS
├── TROUBLESHOOTING.md          # Common errors and fixes
└── blocks/
    ├── auth-basic.md           # AuthBasic patterns
    ├── distributed-table.md    # DistributedTable patterns
    ├── api-namespace.md        # ApiNamespace deep dive
    └── ... (20+ block files)
```

When the AI needs to implement authentication, it loads `blocks/auth-basic.md`. When it needs to set up a database, it loads `blocks/distributed-table.md`. It does not carry all 122 KB of reference material in every conversation.

### Keep it lean

Keep the root file **under 200 lines**. My `AGENTS.md` is 127 lines. The AWS Blocks `SKILL.md` is the overview (under 200 lines), with detailed reference files loaded on demand.

Use the "Router Pattern": a root file that points to detailed references when needed. The AWS Blocks skill does exactly this with its block reference table.

### Separate context from instructions

**Project Context** tells the AI where it is:
> "This is a Next.js 14 App Router project using Tailwind CSS."

**Actionable Rules** tell the AI what to do:
> "Import services from `@/lib/services`; components must not import `src/lib/services/local/*` directly."

Keep these separate. Context helps the AI orient itself. Rules constrain its behavior.

## #4 Manage Your Context Window

Your AI sees everything in a stack:

1. System instructions + steering files
2. Full conversation history (every message)
3. Tool output (files, terminal, search results)
4. Your current request

**Performance degrades at 25% capacity, not 100%.** You do not have the full context window available. The degradation starts much earlier than you think.

### Context rot

Long sessions lead to the model "forgetting" earlier decisions, fixing one thing and breaking two others. Hallucinations increase as context fills up and your original constraints stop being followed.

I have seen this firsthand. On the frontend side, I asked my AI to follow the service registry pattern from my `AGENTS.md`. After 15 turns of unrelated work, it started importing directly from `src/lib/services/local/`, exactly what I told it not to do.

On the backend side, I had a session where I was building multiple API methods with AWS Blocks. After building the analytics endpoints, I asked it to add authentication. It generated a whole custom auth system instead of using the `AuthBasic` block that was in the skill file. The context was too full for it to reference back.

### Fighting context rot

- Start **fresh sessions** for each new task
- Keep steering files under 200 lines
- **Summarize progress** in a file the AI can re-read, do not rely on conversation history
- Keep interactions to **5–7 turns per task** max

## #5 Follow a Spec-Driven Development Process

Vibe coding skips everything we know about building software: planning, analysis, design, testing, maintenance. All of it gone.

Vibe coding works for prototyping and tiny fixes. But for anything beyond that, you need structure.

**Spec-Driven Development (SDD)** is a methodology where detailed, unambiguous requirements are written and agreed upon before any actual coding begins. The spec is the contract between you and your AI.

### Frontend spec (from `BUILD_PROMPT.md`)

```markdown
<task>
Build "Some Useful Links" — a LinkTree-style web application using Next.js
with SSR enabled. The complete visual design specification is in
`DESIGN_SPEC.md` and reference screenshots are in the `design-previews/`
folder.

All backend infrastructure must be local mocks — no cloud dependencies. The
mocks must be documented clearly enough that another AI agent or developer
can swap them for any cloud provider without restructuring.
</task>

<architecture>
1. Framework: Next.js (App Router) with Server-Side Rendering enabled
2. Styling: Tailwind CSS with a custom theme from the design spec
3. Backend: Local mocks only — no cloud services, no external APIs
</architecture>
```

### Backend spec (from `MIGRATING_TO_CLOUD_PROMPT.md`)

```markdown
<task>
Replace the local JSON mock services in `src/lib/services/local/` with AWS
Blocks implementations. The existing service interfaces in
`src/lib/services/interfaces/` are the contract. The service registry
(`src/lib/services/index.ts`) is the only file that should change in the
existing codebase.

The frontend, routing, components, and design must remain untouched.
</task>

<architecture>
1. Backend runtime: AWS Blocks (`aws-blocks/index.ts`)
2. API layer: ApiNamespace with methods that mirror the existing service
   interface contracts
3. Auth: AuthBasic for admin routes (analytics dashboard, page management)
4. Data — Link pages: DistributedTable (stores page configurations and
   link entries)
5. Data — Analytics: DistributedTable (stores daily aggregate snapshots
   per page slug and date)
6. Data — Visit events: DistributedTable (stores raw page-view, link-click,
   and share events)
7. Hosting: Blocks Hosting for the Next.js frontend
</architecture>

<acceptance_criteria>
- [ ] All existing frontend functionality works unchanged
- [ ] `npm run dev` starts both frontend and AWS Blocks local server on
      port 3000
- [ ] Admin routes require AuthBasic login
- [ ] Click tracking persists events to DistributedTable
- [ ] `npm run build` completes without TypeScript errors
- [ ] `npm run deploy` deploys the full stack to AWS
</acceptance_criteria>
```

The AI knows exactly what to build, what the constraints are, and what "done" looks like. No ambiguity on either side.

### Writing good specs

1. Start with **Goals and Non-Goals**: what are you building? What are you explicitly NOT building?
2. Define your **tech stack and project structure**
3. Add **executable commands** so the AI knows how to build and run things
4. Write clear **acceptance criteria** so everyone knows when the work is done
5. Set your **boundaries**: what should the AI always do? What should it ask you first?

## #6 Use MCP to Extend AI Beyond Its Knowledge

Model Context Protocol (MCP) is an open standard for connecting AI to the outside world. With MCP, your AI can:

- Connect to data sources (local files, databases, APIs)
- Run tools (search engines, calculators, linters)
- Follow workflows and specialized prompts
- Access knowledge that did not exist when it was trained

Right now there is an MCP server for almost everything: GitHub, Slack, databases, documentation, cloud services.

In my project, I used this in two places:

**Frontend**: I connected Figma MCP so the AI could reference my actual design system when generating components. Instead of describing colors and spacing in text, it pulled the tokens directly from the Figma file.

**Backend**: AWS Blocks is a new framework. The AI does not know its API surface from training data. Instead of pasting documentation into the chat (wasting context), I added an MCP server that gives the AI access to the AWS Blocks docs and API references on demand. It queries what it needs, when it needs it.

The result: zero hallucinated API calls. The AI uses `new ApiNamespace(scope, 'api', (context) => ({...}))` because it can look up the actual signature, instead of guessing something like `createApi(...)`.

## #7 Know When to Vibe Code and When to Spec

Some tasks deserve a spec. Others work fine as a quick conversation with the AI. Knowing which approach to use is what saves you time.

### Use vibe coding when:
- Prototyping something
- Making smaller changes and tiny fixes
- Learning syntax and a new technology
- Automating one-off tasks

### Use Spec-Driven Development when:
- Building production software
- Working in a team
- Designing complex architecture
- Working on brownfield projects (like adding AWS Blocks to an existing Next.js app)

In my project, I vibe coded the initial design exploration with Figma MCP. But the moment I started building the actual app and the backend migration, I switched to specs. The frontend `BUILD_PROMPT.md` and the backend AWS Blocks skill together gave the AI everything it needed to produce consistent, predictable results.

## Wrapping Up

I am currently finishing the AWS Blocks backend for the link-sharing project and deploying it. I will write up that process in the next post.

You can find the full project, including the `BUILD_PROMPT.md`, `AGENTS.md`, `MIGRATING_TO_CLOUD_PROMPT.md`, and the AWS Blocks skill files in [this repository](https://github.com/salihgueler/some-useful-links).
