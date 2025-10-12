import { Schema } from 'mongoose';
import type { IAccessLog } from '~/types';

const accessLogSchema = new Schema<IAccessLog>(
  {
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    session_id: {
      type: String,
      index: true,
    },
    model: {
      type: String,
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      index: true,
    },
    request_type: {
      type: String,
      enum: ['chat', 'completion', 'embedding', 'tool_call', 'image_generation'],
      required: true,
      index: true,
    },
    tokens_in: {
      type: Number,
      default: 0,
      min: 0,
    },
    tokens_out: {
      type: Number,
      default: 0,
      min: 0,
    },
    cost_usd: {
      type: Number,
      default: 0,
      min: 0,
    },
    policy_rule_id: {
      type: String,
      index: true,
    },
    policy_decision: {
      effect: {
        type: String,
        enum: ['allow', 'deny'],
        required: true,
      },
      source: {
        type: String,
        enum: ['keycloak_role', 'keycloak_group', 'app_policy', 'default_deny'],
        required: true,
      },
      rule_priority: Number,
    },
    credential_source: {
      type: String,
      enum: ['pre_configured', 'user_provided'],
      required: true,
      index: true,
    },
    credential_id: {
      type: String, // Reference to key_ref or user key ID
    },
    response_time_ms: {
      type: Number,
      min: 0,
    },
    success: {
      type: Boolean,
      required: true,
      index: true,
    },
    error_type: {
      type: String,
      enum: ['auth_failed', 'rate_limit', 'quota_exceeded', 'invalid_key', 'model_unavailable', 'other'],
    },
    error_message: {
      type: String,
      maxlength: 1000,
    },
    request_metadata: {
      user_agent: String,
      ip_address: String,
      temperature: Number,
      max_tokens: Number,
      stream: Boolean,
      tools_used: [String],
    },
    billing_period: {
      type: String,
      format: 'YYYY-MM', // For monthly aggregation
      index: true,
    },
  },
  {
    timestamps: true,
    // Auto-expire logs after 1 year
    expireAfterSeconds: 365 * 24 * 60 * 60,
  },
);

// Indexes for common queries
accessLogSchema.index({ user_id: 1, createdAt: -1 });
accessLogSchema.index({ model: 1, createdAt: -1 });
accessLogSchema.index({ success: 1, createdAt: -1 });
accessLogSchema.index({ billing_period: 1, user_id: 1 });
accessLogSchema.index({ credential_source: 1, createdAt: -1 });

// For cost analysis and billing
accessLogSchema.index({ user_id: 1, billing_period: 1, success: 1 });
accessLogSchema.index({ endpoint: 1, model: 1, createdAt: -1 });

export default accessLogSchema;