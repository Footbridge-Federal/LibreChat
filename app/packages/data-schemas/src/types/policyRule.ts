import type { Document } from 'mongoose';

export interface IPolicyRuleConditions {
  max_tokens?: number;
  max_output_tokens?: number;
  temperature_max?: number;
  time_window?: 'minute' | 'hour' | 'day' | 'week' | 'month';
  environments?: ('development' | 'staging' | 'production')[];
  allowed_params?: Record<string, any>;
}

export interface IPolicyRule extends Document {
  subject_type: 'user' | 'group' | 'role' | 'org';
  subject_id: string;
  resource_type: 'model' | 'tool' | 'endpoint';
  resource_id: string;
  effect: 'allow' | 'deny';
  conditions?: IPolicyRuleConditions;
  key_policy: 'pre_configured' | 'user_provided' | 'both';
  key_ref?: string;
  priority: number;
  active: boolean;
  created_by: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPolicyVersion extends Document {
  version: number;
  source: 'admin_update' | 'keycloak_sync' | 'scheduled_sync';
  changes_summary?: string;
  updated_by?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserApiKeyMetadata {
  model_access?: string[];
  rate_limits?: {
    requests_per_minute?: number;
    tokens_per_day?: number;
  };
  environment?: 'development' | 'staging' | 'production';
}

export interface IUserApiKey extends Document {
  user_id: string;
  provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'mistral' | 'cohere';
  key_name: string;
  key_hash: string;
  encrypted_key: string;
  key_prefix?: string;
  is_active: boolean;
  last_used?: Date;
  usage_count: number;
  expires_at?: Date;
  metadata?: IUserApiKeyMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPolicyDecision {
  effect: 'allow' | 'deny';
  source: 'keycloak_role' | 'keycloak_group' | 'app_policy' | 'default_deny';
  rule_priority?: number;
}

export interface IRequestMetadata {
  user_agent?: string;
  ip_address?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools_used?: string[];
}

export interface IAccessLog extends Document {
  user_id: string;
  session_id?: string;
  model: string;
  endpoint: string;
  request_type: 'chat' | 'completion' | 'embedding' | 'tool_call' | 'image_generation';
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  policy_rule_id?: string;
  policy_decision: IPolicyDecision;
  credential_source: 'pre_configured' | 'user_provided';
  credential_id?: string;
  response_time_ms?: number;
  success: boolean;
  error_type?: 'auth_failed' | 'rate_limit' | 'quota_exceeded' | 'invalid_key' | 'model_unavailable' | 'other';
  error_message?: string;
  request_metadata?: IRequestMetadata;
  billing_period?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Effective policy computed from all rules
export interface IEffectiveModelPolicy {
  model_id: string;
  endpoint: string;
  max_tokens: number;
  max_output_tokens: number;
  temperature_max: number;
  credential_source: 'pre_configured' | 'user_provided' | 'both';
  key_ref?: string;
  rate_limits?: {
    requests_per_minute?: number;
    tokens_per_day?: number;
  };
}

export interface IEffectivePolicy {
  allowed_models: IEffectiveModelPolicy[];
  denied_models: string[];
  default_limits: {
    max_tokens: number;
    monthly_limit: number;
    rate_limit: number;
  };
  decision_log: Array<{
    rule_id?: string;
    source: 'keycloak_group' | 'keycloak_role' | 'app_policy' | 'default_deny';
    effect: 'allow' | 'deny';
    reason: string;
    priority?: number;
  }>;
}

// Authorization result for a specific request
export interface IAuthorizationResult {
  allowed: boolean;
  model_config?: IEffectiveModelPolicy;
  reason: string;
  rule_id?: string;
  credential_source?: 'pre_configured' | 'user_provided';
  key_ref?: string;
  rate_limits?: {
    current_usage: number;
    limit: number;
    window: string;
  };
}