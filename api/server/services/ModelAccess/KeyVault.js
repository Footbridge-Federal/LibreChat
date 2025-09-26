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
   * @param {string} keyRef - Key reference
   * @returns {Promise<string>} The decrypted API key
   */
  async getPreConfiguredKey(keyRef) {
    try {
      const envVar = `VAULT_${keyRef.toUpperCase()}`;
      const storedData = process.env[envVar];

      if (!storedData) {
        logger.warn(`[KeyVault] Pre-configured key not found: ${keyRef}`);
        throw new Error(`API key not found: ${keyRef}`);
      }

      const parsed = JSON.parse(storedData);
      const decrypted = this._decrypt(parsed.encrypted_key);

      logger.debug(`[KeyVault] Retrieved pre-configured key: ${keyRef}`);
      return decrypted;
    } catch (error) {
      logger.error(`[KeyVault] Error retrieving pre-configured key ${keyRef}:`, error);
      throw new Error('Failed to retrieve API key');
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
   * Generate encryption key
   * @private
   */
  _generateKey() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = { KeyVault };