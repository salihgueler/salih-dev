import {
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  CodeBuildClient,
  StartBuildCommand,
} from "@aws-sdk/client-codebuild";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";

import {
  CONTENT_KEY,
  isExpectedEditor,
  jsonResponse,
  MAX_CONTENT_BYTES,
  requestBody,
  requestHeader,
} from "./content-api-shared";

const codebuild = new CodeBuildClient({});
const s3 = new S3Client({});

export const handler: Handler<
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2
> = async (event) => {
  if (!isExpectedEditor(event)) {
    return jsonResponse(403, { error: "forbidden" });
  }

  const body = requestBody(event);
  if (body === null) return jsonResponse(400, { error: "body_required" });
  if (Buffer.byteLength(body, "utf8") > MAX_CONTENT_BYTES) {
    return jsonResponse(413, { error: "content_too_large" });
  }

  let content;
  try {
    const { parseSiteContent } = await import(
      "../../src/config/site-content-schema.js"
    );
    content = parseSiteContent(JSON.parse(body));
  } catch (error) {
    return jsonResponse(400, {
      error: "invalid_content",
      message: error instanceof Error ? error.message : "Invalid JSON",
    });
  }

  const ifMatch = requestHeader(event, "if-match");
  const ifNoneMatch = requestHeader(event, "if-none-match");
  if (Boolean(ifMatch) === Boolean(ifNoneMatch)) {
    return jsonResponse(428, {
      error: "precondition_required",
      message: "Supply exactly one of If-Match or If-None-Match: *",
    });
  }
  if (ifNoneMatch && ifNoneMatch !== "*") {
    return jsonResponse(400, {
      error: "invalid_precondition",
      message: "If-None-Match must be *",
    });
  }

  let stored;
  try {
    stored = await s3.send(
      new PutObjectCommand({
        Body: `${JSON.stringify(content, null, 2)}\n`,
        Bucket: process.env.CONTENT_BUCKET_NAME,
        CacheControl: "no-store",
        ContentType: "application/json; charset=utf-8",
        IfMatch: ifMatch,
        IfNoneMatch: ifNoneMatch,
        Key: CONTENT_KEY,
      }),
    );
  } catch (error) {
    if (
      error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 412
    ) {
      return jsonResponse(412, { error: "content_changed" });
    }
    console.error("Content write failed", error);
    return jsonResponse(500, { error: "content_write_failed" });
  }

  try {
    const publication = await codebuild.send(
      new StartBuildCommand({
        projectName: process.env.PUBLISHER_PROJECT_NAME,
      }),
    );
    console.log(
      JSON.stringify({
        action: "content-updated",
        buildId: publication.build?.id,
        contentVersion: stored.VersionId,
        requestId: event.requestContext.requestId,
      }),
    );
    return jsonResponse(
      202,
      {
        buildId: publication.build?.id,
        contentVersion: stored.VersionId,
        status: "publishing",
      },
      {
        ...(stored.ETag ? { etag: stored.ETag } : {}),
        ...(stored.VersionId
          ? { "x-content-version": stored.VersionId }
          : {}),
      },
    );
  } catch (error) {
    console.error("Content stored but publication failed to start", error);
    return jsonResponse(503, {
      contentVersion: stored.VersionId,
      error: "publication_not_started",
    });
  }
};
