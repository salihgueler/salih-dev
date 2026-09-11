#!/usr/bin/env node

import { App, Aspects, Tags } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";

import { SalihDevDeliveryStack } from "../lib/delivery-stack";
import { SalihDevStateStack } from "../lib/state-stack";

const app = new App();
const domainName = app.node.tryGetContext("domainName") as string;
const account =
  (app.node.tryGetContext("selectedAccount") as string | undefined) ??
  process.env.CDK_DEFAULT_ACCOUNT;
const region =
  (app.node.tryGetContext("selectedRegion") as string | undefined) ??
  process.env.CDK_DEFAULT_REGION ??
  "us-east-1";

if (!account) {
  throw new Error("Set selectedAccount in cdk.json before synthesizing salih.dev.");
}
if (region !== "us-east-1") {
  throw new Error(
    "Deploy salih.dev in us-east-1 because CloudFront requires its ACM certificate there.",
  );
}

const env = {
  account,
  region,
};

const state = new SalihDevStateStack(app, "SalihDevState", {
  domainName,
  env,
  terminationProtection: true,
});

const delivery = new SalihDevDeliveryStack(app, "SalihDevDelivery", {
  contentBucket: state.contentBucket,
  domainName,
  env,
  hostedZone: state.hostedZone,
  terminationProtection: true,
});
delivery.addStackDependency(state);

for (const stack of [state, delivery]) {
  Tags.of(stack).add("Application", "salih.dev");
  Tags.of(stack).add("ManagedBy", "AWS CDK");
}

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
