import { site } from "../config/site";

export const contentSignal = "search=yes, ai-input=yes, ai-train=no";

export function markdownAlternatePath(pathname: string): string | null {
  const path = normalizePath(pathname);

  if (path === "/") return "/index.md";
  if (path === "/blog/") return "/blog/index.md";
  if (path === "/about/") return "/about.md";
  if (path === "/contact/") return "/contact.md";

  const match = path.match(/^\/(blog|categories|tags)\/([^/]+)\/$/);
  return match ? `/${match[1]}/${match[2]}.md` : null;
}

export function canonicalUrl(pathname: string): string {
  const url = new URL(pathname, site.url);
  const lastSegment = url.pathname.split("/").at(-1) ?? "";

  if (
    url.pathname !== "/" &&
    !url.pathname.endsWith("/") &&
    !lastSegment.includes(".")
  ) {
    url.pathname += "/";
  }

  return url.toString();
}

function normalizePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

type AcceptValue = {
  type: string;
  quality: number;
};

export function explicitlyPrefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;

  const values = accept
    .split(",")
    .map(parseAcceptValue)
    .filter((value): value is AcceptValue => value !== null);
  const markdown = qualityFor(values, "text/markdown");
  const html = Math.max(
    qualityFor(values, "text/html"),
    qualityFor(values, "application/xhtml+xml"),
  );

  return markdown > 0 && markdown > html;
}

function parseAcceptValue(value: string): AcceptValue | null {
  const [rawType, ...parameters] = value.trim().toLowerCase().split(";");
  if (!rawType) return null;

  const qualityParameter = parameters.find((parameter) =>
    parameter.trim().startsWith("q="),
  );
  const parsedQuality = qualityParameter
    ? Number.parseFloat(qualityParameter.trim().slice(2))
    : 1;

  return {
    type: rawType,
    quality: Number.isFinite(parsedQuality)
      ? Math.max(0, Math.min(1, parsedQuality))
      : 0,
  };
}

function qualityFor(values: AcceptValue[], type: string): number {
  return values.find((value) => value.type === type)?.quality ?? 0;
}
