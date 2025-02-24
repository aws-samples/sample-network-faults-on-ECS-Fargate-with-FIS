import * as cdk from 'aws-cdk-lib';
import * as fis from 'aws-cdk-lib/aws-fis';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ApplicationStack } from './application-stack';
import { Stack } from 'aws-cdk-lib';

interface FisExperimentStackProps extends cdk.StackProps {
  applicationStack: ApplicationStack;
}

export class FisExperimentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FisExperimentStackProps) {
    super(scope, id, {
      ...props,
      description: '(Network Faults Demo)Experiment stack for ECS Fargate with FIS'
    });
    // Create IAM role for FIS
    const fisRole = new iam.Role(this, 'FisRole', {
      assumedBy: new iam.ServicePrincipal('fis.amazonaws.com')
    });

    // Add required permissions
    fisRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorECSAccess'));
    fisRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorRDSAccess'));
    fisRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorNetworkAccess'));
    fisRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSFaultInjectionSimulatorSSMAccess'));

    // Create experiment template for network latency
    const networkLatencyExperiment = new fis.CfnExperimentTemplate(this, 'NetworkLatencyExperiment', {
      description: 'Experiment to inject network latency in ECS Fargate tasks',
      roleArn: fisRole.roleArn,
      stopConditions: [{
        source: 'none'
      }],
      targets: {
        'Tasks': {
          resourceType: 'aws:ecs:task',
          parameters: {
            cluster: props.applicationStack.cluster.clusterName,
            service: props.applicationStack.service.serviceName 
          },
          selectionMode: 'ALL'
        }
      },
      actions: {
        'NetworkLatency': {
          actionId: 'aws:ecs:task-network-latency',
          parameters: {
            duration: 'PT5M',
            delayMilliseconds: '200',
            jitterMilliseconds: "10",
            useEcsFaultInjectionEndpoints: "true",
            sources: props.applicationStack.database.instanceEndpoint.hostname,
          },
          targets: {
            Tasks: 'Tasks'
          }
        }
      },
      tags: {
        Name: 'NetworkLatencyExperiment'
      }
    });

    // Create experiment template for network packet loss
    const networkPacketLossExperiment = new fis.CfnExperimentTemplate(this, 'NetworkPacketLossExperiment', {
      description: 'Experiment to inject packet loss in ECS Fargate tasks',
      roleArn: fisRole.roleArn,
      stopConditions: [{
        source: 'none'
      }],
      targets: {
        'Tasks': {
          resourceType: 'aws:ecs:task',
          parameters: {
            cluster: props.applicationStack.cluster.clusterName,
            service: props.applicationStack.service.serviceName 
          },
          selectionMode: 'ALL'
        }
      },
      actions: {
        'PacketLoss': {
          actionId: 'aws:ecs:task-network-packet-loss',
          parameters: {
            duration: 'PT5M',
            lossPercent: '10',
            useEcsFaultInjectionEndpoints: "true",
            sources: props.applicationStack.database.instanceEndpoint.hostname,
          },
          targets: {
            Tasks: 'Tasks'
          }
        }
      },
      tags: {
        Name: 'NetworkPacketLossExperiment'
      }
    });

    // Create experiment template for network blackhole
    const networkBlackholeExperiment = new fis.CfnExperimentTemplate(this, 'NetworkBlackholeExperiment', {
      description: 'Experiment to inject network blackhole in ECS Fargate tasks',
      roleArn: fisRole.roleArn,
      stopConditions: [{
        source: 'none'
      }],
      targets: {
        'Tasks': {
          resourceType: 'aws:ecs:task',
          parameters: {
            cluster: props.applicationStack.cluster.clusterName,
            service: props.applicationStack.service.serviceName 
          },
          selectionMode: 'ALL'
        }
      },
      actions: {
        'Blackhole': {
          actionId: 'aws:ecs:task-network-blackhole-port',
          parameters: {
            duration: 'PT5M',
            useEcsFaultInjectionEndpoints: "true",
            port: props.applicationStack.database.instanceEndpoint.port.toString(),
            protocol: "tcp",
            trafficType: "egress"
          },
          targets: {
            Tasks: 'Tasks'
          }
        }
      },
      tags: {
        Name: 'NetworkBlackholeExperiment'
      }
    });

    // Add outputs
    new cdk.CfnOutput(this, 'NetworkLatencyExperimentArn', {
      value: networkLatencyExperiment.ref,  // Changed from attrExperimentTemplateId to ref
      description: 'Network Latency Experiment Template ARN'
    });

    new cdk.CfnOutput(this, 'NetworkPacketLossExperimentArn', {
      value: networkPacketLossExperiment.ref,  // Changed from attrExperimentTemplateId to ref
      description: 'Network Packet Loss Experiment Template ARN'
    });

    new cdk.CfnOutput(this, 'NetworkBlackholeExperimentArn', {
      value: networkBlackholeExperiment.ref,
      description: 'Network Blackhole Experiment Template ARN'
    });
  }
}
