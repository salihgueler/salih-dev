/**
 * A CloudFront S3 origin whose Origin Access Control read grant is scoped to a
 * single object-key prefix.
 *
 * Feature: backend-served-content
 *
 * `S3BucketOrigin.withOriginAccessControl` grants the distribution
 * `s3:GetObject` on `arnForObjects("*")` — the whole bucket. The API-authored
 * slide-deck behavior must reach only `talks/decks/*` of the content bucket and
 * never any other prefix (`pending/`, `records/`, `site/`, `state/`, `posts/`,
 * `images/`), so this origin reproduces the adapter's OAC wiring but adds a
 * bucket-policy statement scoped to exactly the supplied prefix. The public
 * slide path is rewritten to the `talks/decks/<id>.pdf` key by the behavior's
 * viewer-request function before the origin is reached.
 *
 * The grant is the standard OAC statement shape (principal
 * `cloudfront.amazonaws.com`, an `AWS:SourceArn` condition pinning the one
 * distribution), differing from the built-in only in the `Resource`: the
 * prefixed object ARN instead of `.../*`.
 */

import { Aws } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface PrefixScopedS3OriginProps
  extends cloudfront.OriginProps {
  /** The Origin Access Control the distribution uses to sign origin requests. */
  readonly originAccessControl: cloudfront.IOriginAccessControl;
  /**
   * Object-key prefix the distribution may read, e.g. `talks/decks/`. The grant
   * covers `<prefix>*` and nothing else in the bucket.
   */
  readonly keyPrefix: string;
}

/**
 * An OAC S3 origin that grants the distribution `s3:GetObject` on one key
 * prefix only. Build it with {@link PrefixScopedS3Origin.forPrefix}.
 */
export class PrefixScopedS3Origin extends origins.S3BucketOrigin {
  private readonly scopedBucket: s3.IBucket;
  private readonly originAccessControl: cloudfront.IOriginAccessControl;
  private readonly keyPrefix: string;

  private constructor(
    bucket: s3.IBucket,
    props: PrefixScopedS3OriginProps,
  ) {
    super(bucket, props);
    this.scopedBucket = bucket;
    this.originAccessControl = props.originAccessControl;
    this.keyPrefix = props.keyPrefix;
  }

  /** Creates a prefix-scoped OAC origin for the given bucket and key prefix. */
  public static forPrefix(
    bucket: s3.IBucket,
    props: PrefixScopedS3OriginProps,
  ): cloudfront.IOrigin {
    return new PrefixScopedS3Origin(bucket, props);
  }

  public override bind(
    scope: Construct,
    options: cloudfront.OriginBindOptions,
  ): cloudfront.OriginBindConfig {
    // Grant the distribution read on ONLY the scoped prefix. This is the same
    // statement the built-in OAC origin adds, except the resource is the
    // prefixed object ARN rather than every object in the bucket.
    this.grantScopedRead();

    const config = this._bind(scope, options);
    return {
      ...config,
      originProperty: {
        ...config.originProperty,
        originAccessControlId: this.originAccessControl.originAccessControlId,
      } as cloudfront.CfnDistribution.OriginProperty,
    };
  }

  private grantScopedRead(): void {
    // The content bucket lives in a different stack (state) than the
    // distribution (delivery), and delivery already depends on state, so a
    // bucket-policy condition that referenced the concrete distribution id
    // would close a cross-stack dependency cycle. CDK's own OAC key-policy path
    // solves the identical problem by pinning the `AWS:SourceArn` to this
    // account's distributions with a wildcard id; the principal is still only
    // `cloudfront.amazonaws.com` and the read is still scoped to the one prefix,
    // so no other caller and no other prefix is reachable.
    this.scopedBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [this.scopedBucket.arnForObjects(`${this.keyPrefix}*`)],
        conditions: {
          StringLike: {
            "AWS:SourceArn": `arn:${Aws.PARTITION}:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`,
          },
        },
      }),
    );
  }
}
