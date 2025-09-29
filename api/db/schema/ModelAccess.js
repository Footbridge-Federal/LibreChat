const mongoose = require('mongoose');

/**
 * Simple, single table for all model access control
 * Replaces PolicyEngine, complex environment variable mapping, etc.
 */
const modelAccessSchema = new mongoose.Schema({
  // Who gets access
  type: {
    type: String,
    enum: ['user', 'group'],
    required: true,
    index: true
  },

  subject: {
    type: String,  // User ID or group path like '/org-airwall'
    required: true,
    index: true
  },

  // What model they get
  provider: {
    type: String,  // 'openai', 'anthropic', etc. (always lowercase)
    required: true,
    index: true
  },

  model: {
    type: String,  // 'gpt-4o-mini', 'claude-3.5', etc.
    required: true,
    index: true
  },

  // Model configuration
  maxTokens: {
    type: Number,
    default: 8000
  },

  maxOutputTokens: {
    type: Number,
    default: 4000
  },

  temperatureMax: {
    type: Number,
    default: 1.0
  },

  // Rate limiting
  requestsPerMinute: {
    type: Number,
    default: 60
  },

  tokensPerDay: {
    type: Number,
    default: 33333
  },

  monthlyTokenLimit: {
    type: Number,
    default: 1000000
  },

  // API key management
  keySource: {
    type: String,
    enum: ['preconfigured', 'user'],
    default: 'preconfigured'
  },

  keyRef: {
    type: String  // Reference to key in KeyVault
  },

  // Admin fields
  active: {
    type: Boolean,
    default: true,
    index: true
  },

  createdBy: {
    type: String,  // User ID who created this access rule
    default: 'system'
  },

  description: {
    type: String  // Human readable description
  }

}, {
  timestamps: true
});

// Prevent duplicate access rules
modelAccessSchema.index(
  { type: 1, subject: 1, provider: 1, model: 1 },
  { unique: true }
);

const ModelAccess = mongoose.model('ModelAccess', modelAccessSchema);

module.exports = { ModelAccess };