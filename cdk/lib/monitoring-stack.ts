import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { ApplicationStack } from './application-stack';
import { MONITORING_CONSTANTS } from './shared/shared-stack-const';

interface MonitoringStackProps extends cdk.StackProps {
  applicationStack: ApplicationStack;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, {
      ...props,
      description: '(Network Faults Demo)Monitoring stack for ECS Fargate with FIS'
    });

    const dashboard = new cloudwatch.Dashboard(this, 'FISExperimentDashboard', {
      dashboardName: 'FIS-Network-Experiments-Dashboard'
    });
    const artilleryNameSpace = 'artillery-ecs-farget-network-actions-load'
    const artilleryService = 'items-svc'

    const apiLatencyWidget = new cloudwatch.GraphWidget({
      title: 'API Gateway Latency',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'IntegrationLatency',
          dimensionsMap: {
            ApiName: props.applicationStack.api.restApiName
          },
          statistic: 'Average',
          period: cdk.Duration.seconds(60)
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Latency',
          dimensionsMap: {
            ApiName: props.applicationStack.api.restApiName
          },
          statistic: 'Average',
          period: cdk.Duration.seconds(60)
        })
      ],
      width: 12
    });

    const apiErrorsWidget = new cloudwatch.GraphWidget({
      title: 'API Gateway Errors',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '5XXError',
          dimensionsMap: {
            ApiName: props.applicationStack.api.restApiName
          },
          statistic: 'Sum',
          period: cdk.Duration.seconds(60)
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '4XXError',
          dimensionsMap: {
            ApiName: props.applicationStack.api.restApiName
          },
          statistic: 'Sum',
          period: cdk.Duration.seconds(60)
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'IntegrationError',
          dimensionsMap: {
            ApiName: props.applicationStack.api.restApiName
          },
          statistic: 'Sum',
          period: cdk.Duration.seconds(60)
        })
      ],
      width: 12
    });

    //Artillery metrics
    const artilleryHttpResponseMinMetric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'http.response_time.min',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpResponseMaxMetric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'http.response_time.max',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpResponseP99Metric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'http.response_time.p99',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpResponseMedianMetric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'http.response_time.median',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpResponseWidget =  new cloudwatch.GraphWidget({
      title: `Artillery Recorded Latency`,
      left: [artilleryHttpResponseMinMetric, artilleryHttpResponseMaxMetric, artilleryHttpResponseP99Metric, artilleryHttpResponseMedianMetric],
      width: 12
  });
    
    dashboard.addWidgets(
      apiLatencyWidget,
      artilleryHttpResponseWidget
    );

    //Errors metrics
    const artilleryHttpErrors400Metric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'http.codes.400',
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpErrors500Metric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'http.codes.500',
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpErrors502Metric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'http.codes.502',
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpErrorsETIMEDOUTMetric = new cloudwatch.Metric({
      namespace: artilleryNameSpace,
      metricName: 'errors.ETIMEDOUT',
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
      dimensionsMap: {Name: 'loadtest', Service: artilleryService}
  });
  const artilleryHttpErrorsWidget = new cloudwatch.GraphWidget({
      title: `Artillery Recorded Errors`,
      left: [artilleryHttpErrors400Metric, artilleryHttpErrors500Metric, artilleryHttpErrors502Metric, artilleryHttpErrorsETIMEDOUTMetric],
      width: 12
  });

  dashboard.addWidgets(
    apiErrorsWidget,
    artilleryHttpErrorsWidget
  );

  // Create widget for database query latency
  const dbLatencyWidget = new cloudwatch.GraphWidget({
    title: 'Database Query Latency',
    left: [
      new cloudwatch.Metric({
        namespace: MONITORING_CONSTANTS.NAMESPACE,
        metricName: MONITORING_CONSTANTS.METRICS.DATABASE_QUERY_LATENCY,
        dimensionsMap: {
          [MONITORING_CONSTANTS.DIMENSIONS.SERVICE_NAME]: 
            MONITORING_CONSTANTS.DIMENSIONS.SERVICE_VALUE,
          [MONITORING_CONSTANTS.DIMENSIONS.QUERY_TYPE]: 'INSERT'
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1)
      }),
      // Add p90 statistic
      new cloudwatch.Metric({
        namespace: MONITORING_CONSTANTS.NAMESPACE,
        metricName: MONITORING_CONSTANTS.METRICS.DATABASE_QUERY_LATENCY,
        dimensionsMap: {
          [MONITORING_CONSTANTS.DIMENSIONS.SERVICE_NAME]: 
            MONITORING_CONSTANTS.DIMENSIONS.SERVICE_VALUE,
          [MONITORING_CONSTANTS.DIMENSIONS.QUERY_TYPE]: 'INSERT'
        },
        statistic: 'p90',
        period: cdk.Duration.minutes(1)
      })
    ],
    width: 12,
    height: 8
  });

  // Add widgets to dashboard
  dashboard.addWidgets(
    dbLatencyWidget
  );

    new cdk.CfnOutput(this, 'DashboardURL', {
        description: 'URL for the CloudWatch Dashboard',
        value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`
      });

  }
}
