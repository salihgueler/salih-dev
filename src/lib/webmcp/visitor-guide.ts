/**
 * The "use this site with an AI agent" copy on the About page.
 *
 * Feature: webmcp
 *
 * The HTML page and its Markdown alternate both render from this module, so
 * the two representations never drift apart.
 */

export const AGENT_GUIDE = {
  heading: "Use this site with an AI agent",
  intro:
    "Every page on this site registers WebMCP tools. If your browser supports WebMCP, an AI agent running in it can call them to look up my posts, talks, events, and speaker details without reading the page or guessing where to click. The tools only read what the site already publishes. The one exception is the filter on the Talks page, which an agent can change so you see the talks it found.",
  promptsLead: "Some questions to try:",
  prompts: [
    "Where is Salih speaking next, and what has he talked about before?",
    "Find Salih's posts about AWS Amplify and summarize the newest one.",
    "Which of Salih's talks have a recording?",
    "Get Salih's speaker kit so I can invite him to our meetup.",
  ],
  flag: "chrome://flags/#enable-webmcp-testing",
  consoleCall: "await document.modelContext.getTools()",
  toolListPath: "/.well-known/webmcp.json",
} as const;
