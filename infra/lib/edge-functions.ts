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

export function viewerResponseCode(domainName: string): string {
  return `
function representationPaths(uri) {
  if (uri === "/index.html" || uri === "/index.md") {
    return { canonical: "/", markdown: "/index.md" };
  }
  if (uri === "/blog/index.html" || uri === "/blog/index.md") {
    return { canonical: "/blog/", markdown: "/blog/index.md" };
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
