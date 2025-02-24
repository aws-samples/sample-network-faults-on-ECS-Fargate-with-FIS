import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Types of fault injection actions that can be performed
 */
export enum FaultInjectionActionType {
  /**
   * CPU stress test
   */
  CPU_STRESS = 'cpu-stress',
  
  /**
   * IO stress test
   */
  IO_STRESS = 'io-stress',
  
  /**
   * Process termination
   */
  KILL_PROCESS = 'kill-process',
  
  /**
   * Network black hole
   */
  NETWORK_BLACKHOLE = 'network-blackhole-port',
  
  /**
   * Network latency
   */
  NETWORK_LATENCY = 'network-latency',
  
  /**
   * Network packet loss
   */
  NETWORK_PACKET_LOSS = 'network-packet-loss'
}

/**
 * Configuration for adding fault injection capability to a Fargate task definition
 */
export interface FargateTaskDefinitionFaultInjectionProps {
  /**
   * The task definition to enable fault injection on
   */
  readonly taskDefinition: ecs.FargateTaskDefinition;

  /**
   * The types of fault injection actions that will be used
   * This helps configure the task definition appropriately
   * @default - All fault injection types enabled
   */
  readonly faultInjectionTypes?: FaultInjectionActionType[];

  /**
   * Optional custom log group for the SSM agent container
   * @default - A new log group will be created
   */
  readonly logGroup?: logs.ILogGroup;
}

/**
 * Adds fault injection capability to a Fargate task definition.
 * This enables the ability to run fault injection experiments using AWS Fault Injection Simulator (FIS).
 */
export class FargateTaskDefinitionFaultInjection extends Construct {
  /**
   * The SSM role used by the fault injection agent
   */
  public readonly ssmRole: iam.Role;

  /**
   * The log group used by the SSM agent container
   */
  public readonly logGroup: logs.ILogGroup;

  constructor(scope: Construct, id: string, props: FargateTaskDefinitionFaultInjectionProps) {
    super(scope, id);

    const faultTypes = props.faultInjectionTypes || Object.values(FaultInjectionActionType);
    
    // Validate and configure task definition settings
    this.validateAndConfigureTaskDefinition(props.taskDefinition, faultTypes);

    // Create or use provided log group
    this.logGroup = props.logGroup ?? new logs.LogGroup(this, 'SSMAgentLogs', {
      logGroupName: `/aws/ecs/fis/${cdk.Stack.of(this).stackName}/${id}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK
    });

    // Enable fault injection on the task definition
    (props.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride(
      'EnableFaultInjection', true
    );

    // Create SSM role and configure permissions
    this.ssmRole = this.createSSMRole();
    this.configurePermissions(props.taskDefinition);
    this.addSSMAgentContainer(props.taskDefinition);
  }

  private validateAndConfigureTaskDefinition(taskDefinition: ecs.FargateTaskDefinition, faultTypes: FaultInjectionActionType[]) {
    const cfnTaskDef = taskDefinition.node.defaultChild as ecs.CfnTaskDefinition;
    
    // Check if we need PID mode configuration
    const needsPidMode = faultTypes.some(type => [
      FaultInjectionActionType.KILL_PROCESS,
      FaultInjectionActionType.NETWORK_BLACKHOLE,
      FaultInjectionActionType.NETWORK_LATENCY,
      FaultInjectionActionType.NETWORK_PACKET_LOSS
    ].includes(type));

    // Check if we need network mode configuration
    const needsNetworkMode = faultTypes.some(type => [
      FaultInjectionActionType.NETWORK_BLACKHOLE,
      FaultInjectionActionType.NETWORK_LATENCY,
      FaultInjectionActionType.NETWORK_PACKET_LOSS
    ].includes(type));

    // Configure PID mode if needed
    if (needsPidMode) {
      if (cfnTaskDef.pidMode !== ecs.PidMode.TASK) {
        cfnTaskDef.addPropertyOverride('PidMode', 'task');
      }
    }

    // Validate network mode if needed
    if (needsNetworkMode) {
      const networkMode = cfnTaskDef.networkMode;
      if (networkMode === ecs.NetworkMode.BRIDGE) {
        throw new Error(
          'Network-related fault injection actions cannot be used with bridge network mode. ' +
          'Please use awsvpc, host, or none network mode.'
        );
      }
    }
  }

  private createSSMRole(): iam.Role {
    const role = new iam.Role(this, 'SSMRole', {
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
      ],
      description: 'Role used by SSM agent for ECS Fault Injection'
    });

    // Add required SSM permissions
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ssm:DeleteActivation"],
      resources: ["*"],
    }));

    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ssm:DeregisterManagedInstance"],
      resources: [`arn:aws:ssm:${cdk.Stack.of(this).region}:*:managed-instance/*`],
    }));

    return role;
  }

  private configurePermissions(taskDefinition: ecs.FargateTaskDefinition) {
    // Add SSM permissions to task role
    taskDefinition.taskRole?.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ssm:CreateActivation",
        "ssm:AddTagsToResource",
      ],
      resources: ["*"],
    }));

    // Allow task role to pass SSM role
    taskDefinition.taskRole?.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "iam:GetRole",
        "iam:PassRole"
      ],
      resources: [this.ssmRole.roleArn]
    }));

    // Allow writing logs
    this.ssmRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      resources: [this.logGroup.logGroupArn]
    }));
  }

  private addSSMAgentContainer(taskDefinition: ecs.FargateTaskDefinition) {
    const logging = new ecs.AwsLogDriver({
      streamPrefix: "ssm-agent",
      logGroup: this.logGroup
    });
  
    taskDefinition.addContainer('amazon-ssm-agent', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazon-ssm-agent/amazon-ssm-agent:latest'),
      essential: false,
      cpu: 0,
      logging,
      environment: {
        MANAGED_INSTANCE_ROLE_NAME: this.ssmRole.roleName
      },
      command: [
        "/bin/bash",
        "-c",
        `set -e; dnf upgrade -y; dnf install jq procps awscli -y; term_handler() { 
          echo "Deleting SSM activation $ACTIVATION_ID"; 
          if ! aws ssm delete-activation --activation-id $ACTIVATION_ID --region $ECS_TASK_REGION; then 
            echo "SSM activation $ACTIVATION_ID failed to be deleted" 1>&2; 
          fi; 
          MANAGED_INSTANCE_ID=$(jq -e -r .ManagedInstanceID /var/lib/amazon/ssm/registration); 
          echo "Deregistering SSM Managed Instance $MANAGED_INSTANCE_ID"; 
          if ! aws ssm deregister-managed-instance --instance-id $MANAGED_INSTANCE_ID --region $ECS_TASK_REGION; then 
            echo "SSM Managed Instance $MANAGED_INSTANCE_ID failed to be deregistered" 1>&2; 
          fi; 
          kill -SIGTERM $SSM_AGENT_PID; 
        }; 
        trap term_handler SIGTERM SIGINT; 
        if [[ -z $MANAGED_INSTANCE_ROLE_NAME ]]; then 
          echo "Environment variable MANAGED_INSTANCE_ROLE_NAME not set, exiting" 1>&2; 
          exit 1; 
        fi; 
        if ! ps ax | grep amazon-ssm-agent | grep -v grep > /dev/null; then 
          if [[ -n "$ECS_CONTAINER_METADATA_URI_V4" ]] ; then 
            echo "Found ECS Container Metadata, running activation with metadata"; 
            TASK_METADATA=$(curl "$ECS_CONTAINER_METADATA_URI_V4/task"); 
            ECS_TASK_AVAILABILITY_ZONE=$(echo $TASK_METADATA | jq -e -r '.AvailabilityZone'); 
            ECS_TASK_ARN=$(echo $TASK_METADATA | jq -e -r '.TaskARN'); 
            ECS_TASK_REGION=$(echo $ECS_TASK_AVAILABILITY_ZONE | sed 's/.$//')
            echo "Region: $ECS_TASK_REGION"
            echo "Found ECS Task ARN: $ECS_TASK_ARN, Availability Zone: $ECS_TASK_AVAILABILITY_ZONE, Region: $ECS_TASK_REGION";
            CREATE_ACTIVATION_OUTPUT=$(aws ssm create-activation --iam-role $MANAGED_INSTANCE_ROLE_NAME --tags Key=ECS_TASK_AVAILABILITY_ZONE,Value=$ECS_TASK_AVAILABILITY_ZONE Key=ECS_TASK_ARN,Value=$ECS_TASK_ARN Key=FAULT_INJECTION_SIDECAR,Value=true --region $ECS_TASK_REGION); 
            ACTIVATION_CODE=$(echo $CREATE_ACTIVATION_OUTPUT | jq -e -r .ActivationCode); 
            ACTIVATION_ID=$(echo $CREATE_ACTIVATION_OUTPUT | jq -e -r .ActivationId); 
            if ! amazon-ssm-agent -register -code $ACTIVATION_CODE -id $ACTIVATION_ID -region $ECS_TASK_REGION; then
              echo "Failed to register with AWS Systems Manager (SSM), exiting" 1>&2;
              exit 1;
            fi;
            amazon-ssm-agent & SSM_AGENT_PID=$!; 
            wait $SSM_AGENT_PID; 
          else 
            echo "ECS Container Metadata not found, exiting" 1>&2; 
            exit 1; 
          fi; 
        else 
          echo "SSM agent is already running, exiting" 1>&2; 
          exit 1; 
        fi`
      ],
    });
  }
}

