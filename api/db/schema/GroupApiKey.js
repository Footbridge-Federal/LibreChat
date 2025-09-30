const mongoose = require('mongoose');

/**
 * GroupApiKey - Encrypted storage for group/org API keys
 *
 * Replaces hardcoded environment variables with scalable database storage.
 * Keys are encrypted at rest using AES-256-GCM.
 */
const groupApiKeySchema = new mongoose.Schema({
  // Group reference
  groupPath: {
    type: String,  // e.g., '/org-airwall'
    required: true,
    index: true
  },

  keyRef: {
    type: String,  // e.g., 'group_org_airwall'
    required: true,
    index: true
  },

  // Provider and key
  provider: {
    type: String,  // 'openai', 'anthropic', 'bedrock', etc.
    required: true,
    lowercase: true,
    index: true
  },

  // Encrypted key data (AES-256-GCM)
  encryptedKey: {
    iv: {
      type: String,
      required: true
    },
    encrypted: {
      type: String,
      required: true
    },
    authTag: {
      type: String,
      required: true
    }
  },

  // Key metadata
  keyName: {
    type: String,
    default: function() {
      return `${this.groupPath}_${this.provider}_${Date.now()}`;
    }
  },

  keyPrefix: {
    type: String  // First 8 chars for identification (e.g., 'sk-proj-')
  },

  // Status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  // Usage tracking
  lastUsed: {
    type: Date
  },

  usageCount: {
    type: Number,
    default: 0
  },

  // Rotation support
  expiresAt: {
    type: Date,
    index: true
  },

  rotatedFrom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GroupApiKey'
  },

  // Audit trail
  createdBy: {
    type: String  // User ID who created the key
  },

  reason: {
    type: String  // Why this key was created/rotated
  },

  // Source tracking
  source: {
    type: String,
    enum: ['manual', 'import', 'aws_secrets', 'migration', 'git'],
    default: 'manual'
  }
}, {
  timestamps: true
});

// Compound indexes for efficient lookups
groupApiKeySchema.index({ groupPath: 1, provider: 1 });
groupApiKeySchema.index({ keyRef: 1, provider: 1 });
groupApiKeySchema.index({ isActive: 1, expiresAt: 1 });

// Unique constraint: only one active key per keyRef+provider
groupApiKeySchema.index(
  { keyRef: 1, provider: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true }
  }
);

const GroupApiKey = mongoose.model('GroupApiKey', groupApiKeySchema);

module.exports = GroupApiKey;