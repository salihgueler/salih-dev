export function viewerRequestCode(domainName: string): string {
  return `
function qualityFor(accept, type) {
  var values = accept.toLowerCase().split(",");
  for (var index = 0; index < values.length; index += 1) {
    var parts = values[index].trim().split(";");
    if (parts[0] !== type) continue;
    for (var parameter = 1; parameter < parts.length; parameter += 1) {
      var value = parts[parameter].trim();
      if (value.indexOf("q=") === 0) {
        var quality = parseFloat(value.slice(2));
        return isNaN(quality) ? 0 : Math.max(0, Math.min(1, quality));
      }
    }
    return 1;
  }
  return 0;
}

function markdownPath(uri) {
  if (uri === "/") return "/index.md";
  if (uri === "/blog" || uri === "/blog/") return "/blog/index.md";
  if (uri === "/talks" || uri === "/talks/") return "/talks/index.md";
  if (uri === "/about" || uri === "/about/") return "/about.md";
  if (uri === "/contact" || uri === "/contact/") return "/contact.md";
  var match = uri.match(/^\\/(blog|categories|tags)\\/([^/]+)\\/?$/);
  return match ? "/" + match[1] + "/" + match[2] + ".md" : null;
}

function serializeQuery(query) {
  var parts = [];
  for (var key in query) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
    var values = query[key].multiValue || [query[key]];
    for (var index = 0; index < values.length; index += 1) {
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(values[index].value));
    }
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : "";

  if (host === "www.${domainName}") {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: {
          value: "https://${domainName}" + request.uri + serializeQuery(request.querystring)
        }
      }
    };
  }

  var accept = request.headers.accept ? request.headers.accept.value : "";
  var markdownQuality = qualityFor(accept, "text/markdown");
  var htmlQuality = Math.max(
    qualityFor(accept, "text/html"),
    qualityFor(accept, "application/xhtml+xml")
  );
  var alternate = markdownPath(request.uri);

  if (alternate && markdownQuality > 0 && markdownQuality > htmlQuality) {
    request.uri = alternate;
    return request;
  }

  if (request.uri.endsWith("/")) {
    request.uri += "index.html";
  } else {
    var lastSegment = request.uri.split("/").pop();
    if (lastSegment && lastSegment.indexOf(".") === -1) {
      request.uri += "/index.html";
    }
  }

  return request;
}
`;
}

export function viewerRenderRequestCode(domainName: string): string {
  return `
function qualityFor(accept, type) {
  var values = accept.toLowerCase().split(",");
  for (var index = 0; index < values.length; index += 1) {
    var parts = values[index].trim().split(";");
    if (parts[0] !== type) continue;
    for (var parameter = 1; parameter < parts.length; parameter += 1) {
      var value = parts[parameter].trim();
      if (value.indexOf("q=") === 0) {
        var quality = parseFloat(value.slice(2));
        return isNaN(quality) ? 0 : Math.max(0, Math.min(1, quality));
      }
    }
    return 1;
  }
  return 0;
}

function serializeQuery(query) {
  var parts = [];
  for (var key in query) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
    var values = query[key].multiValue || [query[key]];
    for (var index = 0; index < values.length; index += 1) {
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(values[index].value));
    }
  }
  return parts.length ? "?" + parts.join("&") : "";
}

// The render origin serves the dynamic routes with Astro SSR. Unlike the
// S3 origin's function, this one never appends "/index.html": it keeps the
// clean route path the SSR server matches (/, /talks/, /blog/ and the post,
// category and tag paths), and only negotiates
// the Markdown alternate (/index.md, /talks/index.md, /blog/index.md, and the
// /blog|categories|tags/<slug>.md forms). The www redirect is kept so both
// origins behave the same for a www visitor.
function markdownAlternate(uri) {
  if (uri === "/") return "/index.md";
  if (uri === "/talks" || uri === "/talks/") return "/talks/index.md";
  if (uri === "/blog" || uri === "/blog/") return "/blog/index.md";
  var match = uri.match(/^\\/(blog|categories|tags)\\/([^/]+)\\/?$/);
  return match ? "/" + match[1] + "/" + match[2] + ".md" : null;
}

// Clean-path forms the SSR server matches use a trailing slash; normalize the
// no-slash variants of the dynamic route roots and of a blog/category/tag item.
function normalizeRenderPath(uri) {
  if (uri === "/talks") return "/talks/";
  if (uri === "/blog") return "/blog/";
  var item = uri.match(/^\\/(blog|categories|tags)\\/([^/.]+)$/);
  if (item) return "/" + item[1] + "/" + item[2] + "/";
  return uri;
}

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : "";

  if (host === "www.${domainName}") {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: {
          value: "https://${domainName}" + request.uri + serializeQuery(request.querystring)
        }
      }
    };
  }

  // Normalize clean-path forms to the trailing-slash the SSR server matches.
  request.uri = normalizeRenderPath(request.uri);

  var accept = request.headers.accept ? request.headers.accept.value : "";
  var markdownQuality = qualityFor(accept, "text/markdown");
  var htmlQuality = Math.max(
    qualityFor(accept, "text/html"),
    qualityFor(accept, "application/xhtml+xml")
  );
  var alternate = markdownAlternate(request.uri);

  if (alternate && markdownQuality > 0 && markdownQuality > htmlQuality) {
    request.uri = alternate;
  }

  return request;
}
`;
}

/**
 * Viewer-request function for the API-authored slide-deck behavior.
 *
 * The public slide path is `/talks/slides/api/<deckId>.pdf`; the deck object
 * lives in the content bucket at `talks/decks/<deckId>.pdf`. This function
 * rewrites the request URI to that key so the deck is served straight from the
 * content bucket through CloudFront, with no render Lambda and no build. Only
 * the exact `<deckId>` shape this feature generates (a lowercase RFC 4122 v4
 * UUID) is accepted; anything else is answered with a 404 at the edge, so the
 * behavior can never be walked into another key or another prefix of the
 * content bucket even though the bucket policy already scopes CloudFront's read
 * to `talks/decks/*`.
 */
export function viewerDeckRequestCode(domainName: string): string {
  return `
var DECK_PATH = /^\\/talks\\/slides\\/api\\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\.pdf$/;

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : "";

  if (host === "www.${domainName}") {
    return {
      statusCode: 404,
      statusDescription: "Not Found"
    };
  }

  var match = request.uri.match(DECK_PATH);
  if (!match) {
    return {
      statusCode: 404,
      statusDescription: "Not Found"
    };
  }

  request.uri = "/talks/decks/" + match[1] + ".pdf";
  return request;
}
`;
}

/**
 * Viewer-request function for the blog-hero-image behavior.
 *
 * A post references `https://salih.dev/images/blog/<file>`; the object lives in
 * the content bucket at `images/<file>`. This function rewrites the public path
 * to that key by dropping the `/blog` segment, so the image is served straight
 * from the content bucket through CloudFront with no render Lambda and no build.
 * A path with a traversal segment or an unexpected shape is answered with a 404
 * at the edge, so the behavior can never be walked to another key or prefix
 * even though the bucket policy already scopes CloudFront's read to `images/*`.
 */
export function viewerImageRequestCode(domainName: string): string {
  return `
var IMAGE_PATH = /^\\/images\\/blog\\/([^/][^?#]*)$/;

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : "";

  if (host === "www.${domainName}") {
    return { statusCode: 404, statusDescription: "Not Found" };
  }

  var match = request.uri.match(IMAGE_PATH);
  if (!match || request.uri.indexOf("..") !== -1) {
    return { statusCode: 404, statusDescription: "Not Found" };
  }

  request.uri = "/images/" + match[1];
  return request;
}
`;
}

export function viewerResponseCode(domainName: string): string {
  return `
function representationPaths(uri) {
  if (uri === "/index.html" || uri === "/index.md") {
    return { canonical: "/", markdown: "/index.md" };
  }
  if (uri === "/blog/index.html" || uri === "/blog/index.md") {
    return { canonical: "/blog/", markdown: "/blog/index.md" };
  }
  if (uri === "/talks/index.html" || uri === "/talks/index.md") {
    return { canonical: "/talks/", markdown: "/talks/index.md" };
  }
  if (uri === "/about/index.html" || uri === "/about.md") {
    return { canonical: "/about/", markdown: "/about.md" };
  }
  if (uri === "/contact/index.html" || uri === "/contact.md") {
    return { canonical: "/contact/", markdown: "/contact.md" };
  }

  var html = uri.match(/^\\/(blog|categories|tags)\\/([^/]+)\\/index\\.html$/);
  if (html) {
    return {
      canonical: "/" + html[1] + "/" + html[2] + "/",
      markdown: "/" + html[1] + "/" + html[2] + ".md"
    };
  }

  var markdown = uri.match(/^\\/(blog|categories|tags)\\/([^/]+)\\.md$/);
  if (markdown) {
    return {
      canonical: "/" + markdown[1] + "/" + markdown[2] + "/",
      markdown: uri
    };
  }
  return null;
}

function handler(event) {
  var response = event.response;
  var paths = representationPaths(event.request.uri);

  if (paths && response.statusCode >= 200 && response.statusCode < 400) {
    response.headers.vary = { value: "Accept" };
    response.headers.link = {
      value:
        "<https://${domainName}" + paths.canonical + ">; rel=\\"canonical\\"; type=\\"text/html\\", " +
        "<https://${domainName}" + paths.markdown + ">; rel=\\"alternate\\"; type=\\"text/markdown\\", " +
        "<https://${domainName}/api/catalog.json>; rel=\\"service-desc\\"; type=\\"application/json\\""
    };
  }
  return response;
}
`;
}
