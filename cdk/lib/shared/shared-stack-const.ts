export const MONITORING_CONSTANTS = {
    NAMESPACE: 'items-svc-metrics',
    METRICS: {
      DATABASE_QUERY_LATENCY: 'DatabaseQueryLatency',
    },
    DIMENSIONS: {
      SERVICE_NAME: 'ServiceName',
      SERVICE_VALUE: 'items-svc',
      QUERY_TYPE: 'QueryType'
    }
  } as const;
  