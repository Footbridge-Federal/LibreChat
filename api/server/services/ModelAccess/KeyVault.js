const crypto = require('crypto');
const { logger } = require('~/config');

class KeyVault {
  constructor() {
    // In production, use proper secrets management (HashiCorp Vault, AWS Secrets Manager, etc.)
    this.encryptionKey = process.env.API_KEY_ENCRYPTION_KEY || this._generateKey();
    this.algorithm = 'aes-256-gcm';
  }

  /**
   * Store a pre-configured API key for an organization/group
   * @param {string} keyRef - Reference identifier (e.g., 'group_org_airwall')
   * @param {string} provider - Provider name (openai, anthropic, etc.)
   * @param {string} apiKey - The actual API key
   * @returns {Promise<string>} The key reference
   */
  async storePreConfiguredKey(keyRef, provider, apiKey) {
    try {
      const encrypted = this._encrypt(apiKey);

      // In production, store in proper secrets manager
      // For now, use environment variables or secure database
      process.env[`VAULT_${keyRef.toUpperCase()}`] = JSON.stringify({
        provider,
        encrypted_key: encrypted,
        created_at: new Date().toISOString()
      });

      logger.info(`[KeyVault] Stored pre-configured key for ${keyRef} (${provider})`);
      return keyRef;
    } catch (error) {
      logger.error('[KeyVault] Error storing pre-configured key:', error);
      throw new Error('Failed to store API key securely');
    }
  }

  /**
   * Store a user-provided API key
   * @param {string} userId - User ID
   * @param {string} provider - Provider name
   * @param {string} apiKey - The actual API key
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Stored key info
   */
  async storeUserKey(userId, provider, apiKey, metadata = {}) {
    try {
      const { UserApiKey } = require('~/db/models');

      const keyHash = this._hashKey(apiKey);
      const encryptedKey = this._encrypt(apiKey);
      const keyPrefix = apiKey.substring(0, Math.min(8, apiKey.length));

      const userKey = new UserApiKey({
        user_id: userId,
        provider,
        key_name: metadata.key_name || `${provider}_key_${Date.now()}`,
        key_hash: keyHash,
        encrypted_key: encryptedKey,
        key_prefix: keyPrefix,
        metadata: {
          model_access: metadata.model_access,
          rate_limits: metadata.rate_limits,
          environment: metadata.environment || 'production'
        }
      });

      await userKey.save();

      logger.info(`[KeyVault] Stored user-provided key for user ${userId} (${provider})`);

      return {
        id: userKey._id.toString(),
        key_name: userKey.key_name,
        provider: userKey.provider,
        key_prefix: userKey.key_prefix,
        created_at: userKey.createdAt
      };
    } catch (error) {
      logger.error('[KeyVault] Error storing user key:', error);
      throw new Error('Failed to store user API key securely');
    }
  }

  /**
   * Retrieve a pre-configured API key
   * @param {string} keyRef - Key reference (e.g., 'group_org_airwall')
   * @param {string} provider - Provider hint (openai, anthropic, bedrock)
   * @returns {Promise<string>} The API key
   */
  async getPreConfiguredKey(keyRef, provider = null) {
    try {
      logger.info(`[KeyVault] Looking for pre-configured key: ${keyRef} (provider: ${provider})`);

      // Check database (only source for API keys)
      const dbKey = await this._getDatabaseKey(keyRef, provider);
      if (dbKey) {
        logger.info(`[KeyVault] Retrieved key from database: ${keyRef}/${provider}`);
        return dbKey;
      }

      logger.error(`[KeyVault] No API key configured for ${keyRef} (provider: ${provider})`);
      throw new Error(`API key not configured for group: ${keyRef}. Please sync keys.json using: npm run sync:keys`);
    } catch (error) {
      logger.error(`[KeyVault] Error retrieving pre-configured key ${keyRef}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve a user-provided API key
   * @param {string} userId - User ID
   * @param {string} provider - Provider name
   * @returns {Promise<string>} The decrypted API key
   */
  async getUserKey(userId, provider) {
    try {
      const { UserApiKey } = require('~/db/models');

      const userKey = await UserApiKey.findOne({
        user_id: userId,
        provider,
        is_active: true
      }).select('+encrypted_key');

      if (!userKey) {
        throw new Error(`No active API key found for user ${userId} and provider ${provider}`);
      }

      const decrypted = this._decrypt(userKey.encrypted_key);

      // Update usage tracking
      userKey.last_used = new Date();
      userKey.usage_count += 1;
      await userKey.save();

      logger.debug(`[KeyVault] Retrieved user key for ${userId} (${provider})`);
      return decrypted;
    } catch (error) {
      logger.error(`[KeyVault] Error retrieving user key for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Validate if a user has a valid API key for a provider
   * @param {string} userId - User ID
   * @param {string} provider - Provider name
   * @returns {Promise<boolean>} True if valid key exists
   */
  async hasValidUserKey(userId, provider) {
    try {
      const { UserApiKey } = require('~/db/models');

      const count = await UserApiKey.countDocuments({
        user_id: userId,
        provider,
        is_active: true,
        $or: [
          { expires_at: { $exists: false } },
          { expires_at: { $gt: new Date() } }
        ]
      });

      return count > 0;
    } catch (error) {
      logger.error(`[KeyVault] Error checking user key validity:`, error);
      return false;
    }
  }

  /**
   * List user API keys (without revealing the actual keys)
   * @param {string} userId - User ID
   * @returns {Promise<Array>} List of user keys
   */
  async listUserKeys(userId) {
    try {
      const { UserApiKey } = require('~/db/models');

      const keys = await UserApiKey.find({
        user_id: userId,
        is_active: true
      }).select('-encrypted_key -key_hash').sort({ createdAt: -1 });

      return keys.map(key => ({
        id: key._id.toString(),
        key_name: key.key_name,
        provider: key.provider,
        key_prefix: key.key_prefix,
        last_used: key.last_used,
        usage_count: key.usage_count,
        created_at: key.createdAt,
        expires_at: key.expires_at,
        metadata: key.metadata
      }));
    } catch (error) {
      logger.error(`[KeyVault] Error listing user keys:`, error);
      throw error;
    }
  }

  /**
   * Revoke/deactivate a user API key
   * @param {string} userId - User ID
   * @param {string} keyId - Key ID to revoke
   * @returns {Promise<boolean>} Success status
   */
  async revokeUserKey(userId, keyId) {
    try {
      const { UserApiKey } = require('~/db/models');

      const result = await UserApiKey.updateOne(
        { _id: keyId, user_id: userId },
        { is_active: false }
      );

      if (result.modifiedCount > 0) {
        logger.info(`[KeyVault] Revoked user key ${keyId} for user ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`[KeyVault] Error revoking user key:`, error);
      throw error;
    }
  }

  /**
   * Encrypt data using AES-256-GCM
   * @private
   */
  _encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
    cipher.setAAD(Buffer.from('librechat-api-key', 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      encrypted,
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   * @private
   */
  _decrypt(encryptedData) {
    const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
    decipher.setAAD(Buffer.from('librechat-api-key', 'utf8'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Hash API key for comparison
   * @private
   */
  _hashKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Retrieve key from database
   * @private
   */
  async _getDatabaseKey(keyRef, provider) {
    try {
      const { GroupApiKey } = require('~/db/models');

      const dbKey = await GroupApiKey.findOne({
        keyRef,
        provider,
        isActive: true,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      if (!dbKey) {
        return null;
      }

      // Decrypt key
      const decrypted = this._decrypt(dbKey.encryptedKey);

      // Update usage tracking (don't await to avoid slowing down requests)
      GroupApiKey.updateOne(
        { _id: dbKey._id },
        {
          $set: { lastUsed: new Date() },
          $inc: { usageCount: 1 }
        }
      ).catch(err => {
        logger.warn('[KeyVault] Failed to update key usage:', err);
      });

      return decrypted;
    } catch (error) {
      logger.warn('[KeyVault] Error retrieving key from database:', error);
      return null;
    }
  }

  /**
   * Store a group API key in database
   * @param {string} keyRef - Key reference (e.g., 'group_org_airwall')
   * @param {string} groupPath - Group path (e.g., '/org-airwall')
   * @param {string} provider - Provider name
   * @param {string|Object} apiKey - The actual API key (string for most, object for Bedrock)
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Stored key info
   */
  async storeGroupKey(keyRef, groupPath, provider, apiKey, metadata = {}) {
    try {
      const { GroupApiKey } = require('~/db/models');

      // For Bedrock, apiKey is an object with AWS credentials
      let keyToEncrypt = apiKey;
      let keyPrefix = '';

      if (provider.toLowerCase() === 'bedrock' && typeof apiKey === 'object') {
        // Convert AWS credentials object to string for encryption
        keyToEncrypt = JSON.stringify(apiKey);
        keyPrefix = `aws:${apiKey.region || 'us-east-1'}`;
      } else if (typeof apiKey === 'string') {
        keyPrefix = apiKey.substring(0, Math.min(8, apiKey.length));
      } else {
        // Other JSON-based keys
        keyToEncrypt = JSON.stringify(apiKey);
        keyPrefix = 'json';
      }

      const encryptedKey = this._encrypt(keyToEncrypt);

      const groupKey = new GroupApiKey({
        keyRef,
        groupPath,
        provider: provider.toLowerCase(),
        encryptedKey,
        keyPrefix,
        expiresAt: metadata.expiresAt || null,
        reason: metadata.reason || 'Added programmatically',
        createdBy: metadata.createdBy,
        rotatedFrom: metadata.rotatedFrom,
        source: metadata.source || 'manual'
      });

      await groupKey.save();

      logger.info(`[KeyVault] Stored group key: ${keyRef}/${provider}`);

      return {
        id: groupKey._id.toString(),
        keyRef: groupKey.keyRef,
        groupPath: groupKey.groupPath,
        provider: groupKey.provider,
        keyPrefix: groupKey.keyPrefix,
        createdAt: groupKey.createdAt
      };
    } catch (error) {
      logger.error('[KeyVault] Error storing group key:', error);
      throw error;
    }
  }

  /**
   * Generate encryption key
   * @private
   */
  _generateKey() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = { KeyVault };