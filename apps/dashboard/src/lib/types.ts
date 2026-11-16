export type EnvironmentType = 'PRODUCTION' | 'SANDBOX';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type DeliveryStatus =
  | 'PENDING'
  | 'IN_FLIGHT'
  | 'DELIVERED'
  | 'RETRYING'
  | 'DEAD_LETTER';

export type DemoSinkMode = 'HEALTHY' | 'DOWN' | 'SLOW';

export interface EndpointEnvironment {
  endpoint_id: string;
  environment: EnvironmentType;
}

export interface EndpointTopicSubscription {
  endpoint_id: string;
  topic_id: string;
  created_at: string;
  event_topics?: EventTopic;
}

export interface WebhookEndpoint {
  id: string;
  tenant_id: string;
  url: string;
  description: string | null;
  signing_secret?: string;
  is_active: boolean;
  circuit_status: CircuitState;
  consecutive_failures: number;
  failure_threshold: number;
  circuit_opened_at: string | null;
  created_at: string;
  updated_at: string;
  endpoint_environments?: EndpointEnvironment[];
  endpoint_topic_subscriptions?: EndpointTopicSubscription[];
}

export interface EventTopic {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  payload_schema: Record<string, any>;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttempt {
  id: string;
  delivery_id: string;
  endpoint_id: string;
  attempt_number: number;
  is_success: boolean;
  http_status: number | null;
  latency_ms: number;
  request_headers: Record<string, any>;
  response_body: string | null;
  error_code: string | null;
  created_at: string;
}

export interface Delivery {
  id: string;
  event_id: string;
  endpoint_id: string;
  status: DeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  events?: {
    id: string;
    correlation_id: string;
    idempotency_key: string;
    created_at: string;
    environment: EnvironmentType;
    topic_id: string;
    payload?: Record<string, any>;
    event_topics?: {
      name: string;
    };
  };
  webhook_endpoints?: {
    id: string;
    url: string;
    circuit_status: CircuitState;
    description: string | null;
  };
  delivery_attempts?: DeliveryAttempt[];
}

export interface ApiKeyItem {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  environment: EnvironmentType;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at?: string | null;
  created_at: string;
}

export interface DemoSinkLogEntry {
  id: string;
  receivedAt: string;
  headers: Record<string, any>;
  body: any;
  signatureValid: boolean | null;
  modeAtReceipt: DemoSinkMode;
  simulatedDelayMs?: number;
}
