import { Schema } from 'mongoose';
import type { IUserApiKey } from '~/types';

const userApiKeySchema = new Schema<IUserApiKey>(
  {
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: ['openai', 'anthropic', 'google', 'azure', 'bedrock', 'mistral', 'cohere'],
      index: true,
    },
    key_name: {
      type: String,
      required: true,
      maxlength: 100,
    },
    key_hash: {
      type: String,
      required: true,
      select: false, // Never return in queries by default
    },
    encrypted_key: {
      type: String,
      required: true,
      select: false, // Never return in queries by default
    },
    key_prefix: {
      type: String,
      maxlength: 10, // Store first few chars for identification
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
    last_used: {
      type: Date,
      index: true,
    },
    usage_count: {
      type: Number,
      default: 0,
    },
    expires_at: {
      type: Date,
      index: true,
    },
    metadata: {
      model_access: [String], // Which models this key can access
      rate_limits: {
        requests_per_minute: Number,
        tokens_per_day: Number,
      },
      environment: {
        type: String,
        enum: ['development', 'staging', 'production'],
        default: 'production',
      },
    },
  },
  { timestamps: true },
);

// Compound indexes
userApiKeySchema.index({ user_id: 1, provider: 1, is_active: 1 });
userApiKeySchema.index({ user_id: 1, is_active: 1, last_used: -1 });
userApiKeySchema.index({ expires_at: 1 }, {
  expireAfterSeconds: 0,
  partialFilterExpression: { expires_at: { $exists: true } }
});

// Ensure unique key names per user/provider
userApiKeySchema.index(
  { user_id: 1, provider: 1, key_name: 1 },
  { unique: true }
);

export default userApiKeySchema;