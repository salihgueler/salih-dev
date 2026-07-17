# salih.dev Personal Website Building

The purpose of this document is to build a text-heavy personal website that will eventually live at the salih.dev address.

# Rules
- You MUST use Astro to build this website.
- You MUST use TypeScript as the language.
- You MUST create the content using Astro's markdown support.
- You SHOULD NOT write tests for it.
- You MUST commit your iterations and changes with logical commit messages.
- You MUST use images/reference-image-for-design.png as the design reference. For changes, always ask for approval.
- For each task, you MUST come up with a plan describing what you are going to do and ask for approval with clear acceptance criteria.

# Goals
- The website has a responsive design.
- The website is SEO optimized.
- The website is AEO optimized.
- The website considers the following for agent readiness:
  - Multiple checks across 5 categories:
    - Discoverability — robots.txt, Sitemap, Link response headers, DNS for AI Discovery (DNS-AID)
    - Content Accessibility — Markdown content negotiation
    - Bot Access Control — AI bot rules in robots.txt, Content Signals, Web Bot Auth
    - Protocol Discovery — MCP Server Card, Agent Skills, WebMCP, API Catalog, OAuth discovery, OAuth Protected Resource
    - Commerce — x402, MPP, UCP, ACP 
- The website's markdown support handles:
  - All text types
  - Links
  - Code (with syntax highlighting)
  - Image embedding
  - Video embedding from YouTube
  - And anything else that blog posts typically require
- The website is fully functional locally.

# Non-Goals
- Deployment to a hosting service.