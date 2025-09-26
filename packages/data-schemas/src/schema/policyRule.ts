import { Schema } from 'mongoose';
import type { IPolicyRule } from '~/types';

const policyRuleSchema = new Schema<IPolicyRule>(
  {
    subject_type: {
      type: String,
      enum: ['user', 'group', 'role', 'org'],
      required: true,
      index: true,
    },
    subject_id: {
      type: String,
      required: true,
      index: true,
    },
    resource_type: {
      type: String,
      enum: ['model', 'tool', 'endpoint'],
      required: true,
      default: 'model',
      index: true,
    },
    resource_id: {
      type: String,
      required: true,
      index: true,
    },
    effect: {
      type: String,
      enum: ['allow', 'deny'],
      required: true,
      default: 'allow',
      index: true,
    },
    conditions: {
      max_tokens: {
        type: Number,
        min: 1,
        max: 1000000,
      },
      max_output_tokens: {
        type: Number,
        min: 1,
        max: 500000,
      },
      temperature_max: {
        type: Number,
        min: 0,
        max: 2,
      },
      time_window: {
        type: String,
        enum: ['minute', 'hour', 'day', 'week', 'month'],
      },
      environments: {
        type: [String],
        enum: ['development', 'staging', 'production'],
      },
      allowed_params: {
        type: Schema.Types.Mixed,
      },
    },
    key_policy: {
      type: String,
      enum: ['pre_configured', 'user_provided', 'both'],
      required: true,
      default: 'pre_configured',
    },
    key_ref: {
      type: String,
      sparse: true,
    },
    priority: {
      type: Number,
      required: true,
      default: 1000,
      index: true,
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    created_by: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      maxlength: 500,
    },
  },
  { timestamps: true },
);

// Compound indexes for efficient queries
policyRuleSchema.index({ subject_type: 1, subject_id: 1, active: 1 });
policyRuleSchema.index({ resource_type: 1, resource_id: 1, active: 1 });
policyRuleSchema.index({ effect: 1, priority: 1, active: 1 });
policyRuleSchema.index({ created_by: 1, createdAt: -1 });

// Ensure no duplicate rules for same subject/resource combination
policyRuleSchema.index(
  {
    subject_type: 1,
    subject_id: 1,
    resource_type: 1,
    resource_id: 1,
    effect: 1
  },
  { unique: true }
);

export default policyRuleSchema;