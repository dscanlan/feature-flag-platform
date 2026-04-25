#!/usr/bin/env node
import "aws-cdk-lib";
import { App } from "aws-cdk-lib";
import { FfpStack } from "./stack.js";

const app = new App();
new FfpStack(app, "FfpStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: "Feature-flag platform (single AZ, single tenant) — PLAN.md §8.2",
});
