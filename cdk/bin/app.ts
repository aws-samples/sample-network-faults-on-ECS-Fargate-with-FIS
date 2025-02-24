#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ApplicationStack } from '../lib/application-stack';
import { FisExperimentStack } from '../lib/fis-experiment-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

const appStack = new ApplicationStack(app, 'NetworkFaultsAppStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },
});

new FisExperimentStack(app, 'NetworkFaultsExperimentStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION 
  },
  applicationStack: appStack
});
//Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
// Create monitoring stack
const monitoringStack = new MonitoringStack(app, 'NetworkFaultsMonitoringStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION 
  },
  applicationStack: appStack,
});

