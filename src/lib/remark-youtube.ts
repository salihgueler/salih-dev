type MarkdownNode = {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined>;
  children?: MarkdownNode[];
  value?: string;
};

const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function visit(node: MarkdownNode): void {
  if (node.type === "leafDirective" && node.name === "youtube") {
    const id = node.attributes?.id;
    const title = node.attributes?.title ?? "YouTube video";

    if (!id || !youtubeIdPattern.test(id)) {
      throw new Error("YouTube directives require a valid 11-character video id.");
    }

    node.type = "html";
    node.value = [
      '<div class="video-embed">',
      `<iframe src="https://www.youtube-nocookie.com/embed/${id}"`,
      ` title="${escapeAttribute(title)}"`,
      ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin"',
      ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"',
      ' allowfullscreen></iframe>',
      "</div>",
    ].join("");
    delete node.name;
    delete node.attributes;
    delete node.children;
    return;
  }

  node.children?.forEach(visit);
}

export default function remarkYouTube() {
  return (tree: unknown): void => visit(tree as MarkdownNode);
}
