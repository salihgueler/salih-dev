import * as lambda from "aws-cdk-lib/aws-lambda";
import { NagSuppressions } from "cdk-nag";

export function suppressBasicLambdaLoggingPolicy(
  fn: lambda.IFunction,
  purpose: string,
): void {
  NagSuppressions.addResourceSuppressions(
    fn,
    [
      {
        id: "AwsSolutions-IAM4",
        reason: `AWSLambdaBasicExecutionRole is used only for ${purpose}.`,
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Lambda logging requires generated stream suffixes inside its dedicated log group.",
      },
    ],
    true,
  );
}
