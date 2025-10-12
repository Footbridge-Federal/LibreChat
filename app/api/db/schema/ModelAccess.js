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
  },

  // ========== CONFIGURATION SOURCE & MERGE STRATEGY ==========
  configSource: {
    type: String,
    enum: ['git', 'runtime', 'hybrid'],
    default: 'git',
    index: true,
    description: 'Source of this configuration: git (baseline), runtime (admin override), hybrid (merged)'
  },

  overrides: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ModelAccess',
    description: 'If this is a git config, points to the runtime override record'
  },

  overriddenBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ModelAccess',
    description: 'If this is a runtime override, points to the git baseline record'
  },

  mutableViaAdmin: {
    type: Boolean,
    default: true,
    description: 'Can this configuration be overridden via Admin UI'
  },

  expiresAt: {
    type: Date,
    description: 'When this runtime override expires (null = permanent)'
  },

  overrideReason: {
    type: String,
    description: 'Reason for creating a runtime override'
  },

  approvedBy: {
    type: [String],
    default: [],
    description: 'User IDs who approved this configuration change'
  },

  lastSyncedAt: {
    type: Date,
    description: 'Last time config was synced from Git/YAML'
  },

  // ========== RAG & FILE UPLOAD PERMISSIONS ==========
  ragEnabled: {
    type: Boolean,
    default: false,
    description: 'Can use RAG/document upload features'
  },

  ragStorageQuotaMB: {
    type: Number,
    default: 100,
    description: 'Total file storage quota in MB for this subject'
  },

  ragMaxFileSizeMB: {
    type: Number,
    default: 10,
    description: 'Maximum single file size in MB'
  },

  ragEmbeddingLimitPerMonth: {
    type: Number,
    default: 1000,
    description: 'Monthly embedding generation limit (number of documents)'
  },

  ragAllowedFileTypes: {
    type: [String],
    default: ['pdf', 'txt', 'docx', 'md'],
    description: 'Allowed file extensions (lowercase, without dot)'
  },

  ragVectorSearchEnabled: {
    type: Boolean,
    default: true,
    description: 'Can search vectorized documents'
  },

  ragRetentionDays: {
    type: Number,
    default: 90,
    description: 'Days before uploaded files are auto-deleted (0 = no auto-delete)'
  },

  ragMaxDocuments: {
    type: Number,
    default: 1000,
    description: 'Maximum number of documents that can be stored'
  }

}, {
  timestamps: true
});

// Prevent duplicate access rules per config source
// (We can have both a git baseline AND a runtime override for same subject+model)
modelAccessSchema.index(
  { type: 1, subject: 1, provider: 1, model: 1, configSource: 1 },
  { unique: true }
);

// Index for finding active runtime overrides
modelAccessSchema.index(
  { configSource: 1, expiresAt: 1, active: 1 }
);

// Index for RAG queries
modelAccessSchema.index(
  { ragEnabled: 1, type: 1, subject: 1 }
);

const ModelAccess = mongoose.model('ModelAccess', modelAccessSchema);

module.exports = { ModelAccess };