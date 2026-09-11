import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import type {
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";

import {
  CONTENT_KEY,
  isExpectedEditor,
  jsonResponse,
} from "./content-api-shared";

const s3 = new S3Client({});

export const handler: Handler<
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2
> = async (event) => {
  if (!isExpectedEditor(event)) {
    return jsonResponse(403, { error: "forbidden" });
  }

  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.CONTENT_BUCKET_NAME,
        Key: CONTENT_KEY,
      }),
    );
    return {
      body: await result.Body?.transformToString("utf8"),
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        ...(result.ETag ? { etag: result.ETag } : {}),
        ...(result.VersionId ? { "x-content-version": result.VersionId } : {}),
      },
      statusCode: 200,
    };
  } catch (error) {
    if (error instanceof NoSuchKey) {
      return jsonResponse(404, { error: "content_not_initialized" });
    }
    console.error("Content read failed", error);
    return jsonResponse(500, { error: "content_read_failed" });
  }
};
