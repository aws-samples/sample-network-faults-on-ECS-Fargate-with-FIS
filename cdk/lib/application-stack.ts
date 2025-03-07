import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { FargateTaskDefinitionFaultInjection, FaultInjectionActionType } from 'cdk-ecs-fargate-task-fis';

export class ApplicationStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly database: rds.DatabaseInstance;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      description: '(Network Faults Demo)Main application stack that deploys a containerized application with ECS Fargate, RDS, API Gateway and network infrastructure. Includes fault injection capabilities for resilience testing.'
    });

    // Create VPC
    this.vpc = new ec2.Vpc(this, 'NetworkFaultsDemoVPC', {
      maxAzs: 2
    });

    // Create ECS Cluster
    this.cluster = new ecs.Cluster(this, 'NetworkFaultsDemoCluster', {
      vpc: this.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED 
    });

    // Create database credentials in Secrets Manager
    const databaseCredentials = new secretsmanager.Secret(this, 'NetworkFaultsDBCredentials', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'admin',
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });

    // Create security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'NetworkFaultsDBSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS MySQL',
      allowAllOutbound: true,
    });

    // Create RDS instance
    this.database = new rds.DatabaseInstance(this, 'NetworkFaultsDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(databaseCredentials),
      databaseName: 'NetworkFaultsdemo',
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
      deletionProtection: false 
    });

    // Create Fargate Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'NetworkFaultsAppTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,  
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
      }
    });

    //Add ability to publish  metrics
    taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );
    
    // Add container to task definition
    const container = taskDefinition.addContainer('NetworkFaultsAppContainer', {
      image: ecs.ContainerImage.fromAsset('../app', {
        platform: Platform.LINUX_AMD64,
        buildArgs: {
          SHARED_DIR: path.join(__dirname, '../../shared')
        }
      }),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'NetworkFaultsDemoContainer' }),
      environment: {
        DATABASE_HOST: this.database.instanceEndpoint.hostname,
        DATABASE_PORT: this.database.instanceEndpoint.port.toString(),
        DATABASE_NAME: 'NetworkFaultsdemo'
      },
      secrets: {
        DATABASE_USER: ecs.Secret.fromSecretsManager(databaseCredentials, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseCredentials, 'password'),
      }
    });

    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP
    });

    // Add fault injection capability
    new FargateTaskDefinitionFaultInjection(this, 'FaultInjection', {
      taskDefinition: taskDefinition,
      faultInjectionTypes: [
        FaultInjectionActionType.NETWORK_BLACKHOLE,
        FaultInjectionActionType.NETWORK_LATENCY,
        FaultInjectionActionType.NETWORK_PACKET_LOSS
      ]
    });

    // Add security group for the Fargate service
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'NetworkFaultsServiceSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Fargate service'
    });

    // Allow inbound traffic on container port
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      'Allow inbound traffic to container'
    );
    // Create Fargate Service
    this.service = new ecs.FargateService(this, 'NetworkFaultsDemoService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 2,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [serviceSecurityGroup]
    });

    // Allow ECS tasks to access RDS
    this.database.connections.allowDefaultPortFrom(this.service.connections);

    // Create NLB for the Fargate service
    const nlb = new elbv2.NetworkLoadBalancer(this, 'NetworkFaultsServiceNLB', {
      vpc: this.vpc,
      internetFacing: false
    });

    const listener = nlb.addListener('NetworkFaultsListener', {
      port: 3000,
      protocol: elbv2.Protocol.TCP
    });
    
    // Add Fargate service as target
    listener.addTargets('NetworkFaultsFargateService', {
      port: 3000,
      targets: [this.service],
      healthCheck: {
        enabled: true,
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5)
      },
      deregistrationDelay: cdk.Duration.seconds(30)
    });
    // Create the CloudWatch Logs role
    const cloudWatchRole = new iam.Role(this, 'NetworkFaultsApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonAPIGatewayPushToCloudWatchLogs'
        )
      ]
    });

    new apigateway.CfnAccount(this, 'NetworkFaultsApiGatewayAccount', {
      cloudWatchRoleArn: cloudWatchRole.roleArn
    });

    // Create API Gateway
    this.api = new apigateway.RestApi(this, 'NetworkFaultsDemoApi', {
      restApiName: 'Network Faults Demo API',
      deploy: true,
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO
      },
      endpointTypes: [apigateway.EndpointType.REGIONAL]
    });

    // Create VPC Link
    const vpcLink = new apigateway.VpcLink(this, 'NetworkFaultsVpcLink', {
      targets: [nlb]
    });

    // Add API Gateway integration
    const integration = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: 'ANY',
      uri: `http://${nlb.loadBalancerDnsName}:3000/api/items`,
      options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: vpcLink
      }
    });

    // Add proxy resource with ANY method
    const proxyResource = this.api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', integration, {
      requestParameters: {  
        'method.request.path.proxy': true
      },
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add root path method
    this.api.root.addMethod('ANY', integration, {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }]
    });

    // Add CORS
    proxyResource.addCorsPreflight({
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['*']
    });

    // Add CloudFormation outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.instanceEndpoint.hostname
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: 'NetworkFaultsdemo'
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: databaseCredentials.secretArn
    });
  }
}
