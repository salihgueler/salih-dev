export type CapabilityStatus = "available" | "unavailable";

export type Capability = {
  id: string;
  category:
    | "discoverability"
    | "content-accessibility"
    | "bot-access"
    | "protocol-discovery"
    | "commerce";
  status: CapabilityStatus;
  endpoint?: string;
  note: string;
};

export const capabilities: Capability[] = [
  {
    id: "robots",
    category: "discoverability",
    status: "available",
    endpoint: "/robots.txt",
    note: "Crawler policy and content-use signals.",
  },
  {
    id: "sitemap",
    category: "discoverability",
    status: "available",
    endpoint: "/sitemap.xml",
    note: "Canonical HTML content inventory.",
  },
  {
    id: "rss",
    category: "discoverability",
    status: "available",
    endpoint: "/rss.xml",
    note: "Latest published posts.",
  },
  {
    id: "llms",
    category: "discoverability",
    status: "available",
    endpoint: "/llms.txt",
    note: "Concise machine-readable site guide.",
  },
  {
    id: "markdown-negotiation",
    category: "content-accessibility",
    status: "available",
    endpoint: "/index.md",
    note: "Canonical content supports text/markdown negotiation and companion URLs.",
  },
  {
    id: "content-signals",
    category: "bot-access",
    status: "available",
    note: "Search and AI input are allowed; model training is declined.",
  },
  {
    id: "web-bot-auth",
    category: "bot-access",
    status: "unavailable",
    endpoint: "/.well-known/http-message-signatures-directory",
    note: "No request-signature verifier is configured.",
  },
  {
    id: "mcp",
    category: "protocol-discovery",
    status: "unavailable",
    endpoint: "/.well-known/mcp/server-card.json",
    note: "No MCP transport is operated by this site.",
  },
  {
    id: "agent-skills",
    category: "protocol-discovery",
    status: "available",
    endpoint: "/.well-known/skills/index.json",
    note: "A read-only skill describes Markdown access to public content.",
  },
  {
    id: "webmcp",
    category: "protocol-discovery",
    status: "unavailable",
    endpoint: "/.well-known/webmcp.json",
    note: "The site exposes no browser actions.",
  },
  {
    id: "api-catalog",
    category: "protocol-discovery",
    status: "available",
    endpoint: "/api/catalog.json",
    note: "Catalog of public documents and protocol status.",
  },
  {
    id: "oauth-authorization-server",
    category: "protocol-discovery",
    status: "unavailable",
    endpoint: "/.well-known/oauth-authorization-server",
    note: "The site is not an OAuth authorization server.",
  },
  {
    id: "oauth-protected-resource",
    category: "protocol-discovery",
    status: "unavailable",
    endpoint: "/.well-known/oauth-protected-resource",
    note: "Public content does not require OAuth.",
  },
  {
    id: "openid-configuration",
    category: "protocol-discovery",
    status: "unavailable",
    endpoint: "/.well-known/openid-configuration",
    note: "The site is not an OpenID Provider.",
  },
  {
    id: "dns-aid",
    category: "protocol-discovery",
    status: "unavailable",
    endpoint: "/.well-known/dns-aid.json",
    note: "A DNS record cannot be activated before deployment.",
  },
  ...["x402", "mpp", "ucp", "acp"].map(
    (id): Capability => ({
      id,
      category: "commerce",
      status: "unavailable",
      endpoint: `/.well-known/${id}.json`,
      note: "This personal site does not offer transactional capabilities.",
    }),
  ),
];

export const unavailableCapabilities = new Map(
  capabilities
    .filter(
      (
        capability,
      ): capability is Capability & { status: "unavailable"; endpoint: string } =>
        capability.status === "unavailable" && Boolean(capability.endpoint),
    )
    .map((capability) => [
      capability.endpoint.split("/").at(-1)?.replace(/\.json$/, "") ?? "",
      capability,
    ]),
);
