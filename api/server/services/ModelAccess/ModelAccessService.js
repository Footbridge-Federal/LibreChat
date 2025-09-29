const { logger } = require('~/config');
const { PolicyEngine } = require('./PolicyEngine');
const { KeyVault } = require('./KeyVault');
const { EModelEndpoint } = require('librechat-data-provider');

/**
 * Unified Model Access Service
 * Single source of truth for all model access control decisions
 */
class ModelAccessService {
  constructor() {
    // Lazy initialization to avoid dependency issues
    this._policyEngine = null;
    this._keyVault = null;
    this.userCacheMap = new Map(); // Per-user caching
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  get policyEngine() {
    if (!this._policyEngine) {
      this._policyEngine = new PolicyEngine();
    }
    return this._policyEngine;
  }

  get keyVault() {
    if (!this._keyVault) {
      this._keyVault = new KeyVault();
    }
    return this._keyVault;
  }

  /**
   * Get all models available to a specific user
   * @param {string} userId - User ID
   * @param {Object} tokenClaims - JWT token claims from Keycloak
   * @returns {Promise<Array>} Array of available models with metadata
   */
  async getAvailableModels(userId, tokenClaims = {}) {
    if (!userId) {
      logger.warn('[ModelAccessService] No userId provided for getAvailableModels');
      return [];
    }

    logger.info(`[ModelAccessService] Getting available models for user: ${userId}`);

    try {
      // Check cache first
      const cacheKey = this._generateUserCacheKey(userId, tokenClaims);
      const cached = this.userCacheMap.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        logger.debug(`[ModelAccessService] Cache hit for user ${userId}`);
        return cached.models;
      }

      // Get effective policy from PolicyEngine
      logger.info(`[ModelAccessService] Computing policy for user ${userId} with claims:`, {
        groups: tokenClaims.groups,
        realm_access: tokenClaims.realm_access,
        hasGroupAttributes: !!tokenClaims.group_attributes
      });

      const effectivePolicy = await this.policyEngine.computeEffectivePolicy(userId, tokenClaims);

      logger.info(`[ModelAccessService] Policy result: ${effectivePolicy.allowed_models?.length || effectivePolicy.allowed_models?.size || 0} models available`);
      logger.info(`[ModelAccessService] Raw policy result:`, effectivePolicy);

      if (!effectivePolicy.allowed_models ||
          (Array.isArray(effectivePolicy.allowed_models) && effectivePolicy.allowed_models.length === 0) ||
          (effectivePolicy.allowed_models instanceof Map && effectivePolicy.allowed_models.size === 0)) {
        logger.info(`[ModelAccessService] No models available for user ${userId}`);
        this.userCacheMap.set(cacheKey, { models: [], timestamp: Date.now() });
        return [];
      }

      // Transform to consistent format (handle both Array and Map)
      let modelsToTransform;
      if (effectivePolicy.allowed_models instanceof Map) {
        modelsToTransform = Array.from(effectivePolicy.allowed_models.values());
      } else {
        modelsToTransform = effectivePolicy.allowed_models;
      }

      const availableModels = modelsToTransform.map(model => {
        logger.info(`[ModelAccessService] Processing: ${model.endpoint}/${model.model_id}`);
        logger.debug(`[ModelAccessService] Transforming model:`, model);
        return {
          id: `${model.endpoint}/${model.model_id}`,
          model: model.model_id,
          endpoint: model.endpoint,
          max_tokens: model.max_tokens,
          temperature_max: model.temperature_max,
          requires_user_key: model.credential_source === 'user_provided',
          display_name: model.display_name || model.model_id,
          rate_limits: model.rate_limits,
          group_path: model.group_path,
          credential_source: model.credential_source,
          key_ref: model.key_ref
        };
      });

      // Cache result
      this.userCacheMap.set(cacheKey, {
        models: availableModels,
        timestamp: Date.now()
      });

      logger.info(`[ModelAccessService] Returning ${availableModels.length} models for user ${userId}`);
      return availableModels;

    } catch (error) {
      logger.error(`[ModelAccessService] Error getting available models for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get models in LibreChat UI format (grouped by endpoint)
   * @param {string} userId - User ID
   * @param {Object} tokenClaims - JWT token claims
   * @returns {Promise<Object>} Models config in LibreChat format
   */
  async getModelsConfig(userId, tokenClaims = {}) {
    logger.info(`[ModelAccessService] Getting models config for user: ${userId}`);

    const availableModels = await this.getAvailableModels(userId, tokenClaims);

    if (availableModels.length === 0) {
      return {};
    }

    // Transform to LibreChat UI format: { endpoint: [model1, model2, ...] }
    const modelConfig = {};
    const endpointMap = {
      'openai': EModelEndpoint.openAI,
      'anthropic': EModelEndpoint.anthropic,
      'google': EModelEndpoint.google,
      'bedrock': EModelEndpoint.bedrock,
      'azure': EModelEndpoint.azureOpenAI
    };

    for (const model of availableModels) {
      const endpoint = model.endpoint;
      const librechatEndpoint = endpointMap[endpoint] || endpoint;

      if (!modelConfig[librechatEndpoint]) {
        modelConfig[librechatEndpoint] = [];
      }

      modelConfig[librechatEndpoint].push(model.model);
    }

    logger.info(`[ModelAccessService] Models config for user ${userId}:`, modelConfig);
    return modelConfig;
  }

  /**
   * Authorize a specific model request
   * @param {string} userId - User ID
   * @param {Object} tokenClaims - JWT token claims
   * @param {string} model - Model ID (e.g., 'gpt-4o-mini')
   * @param {string} endpoint - Endpoint (e.g., 'openai')
   * @param {Object} parameters - Request parameters
   * @returns {Promise<Object>} Authorization result
   */
  async authorizeModelRequest(userId, tokenClaims, model, endpoint, parameters = {}) {
    logger.info(`[ModelAccessService] Authorizing ${userId} for ${endpoint}/${model}`);

    if (!userId || !model || !endpoint) {
      return {
        authorized: false,
        reason: 'Missing required parameters (userId, model, endpoint)',
        code: 'MISSING_PARAMS'
      };
    }

    try {
      // Use PolicyEngine for authorization
      const authorization = await this.policyEngine.authorize(
        userId,
        tokenClaims,
        model,
        endpoint,
        parameters
      );

      if (!authorization.allowed) {
        logger.info(`[ModelAccessService] Access denied for ${userId}: ${authorization.reason}`);
        return {
          authorized: false,
          reason: authorization.reason,
          code: 'ACCESS_DENIED',
          rule_id: authorization.rule_id
        };
      }

      // Resolve API key
      let apiKey;
      try {
        if (authorization.credential_source === 'pre_configured') {
          apiKey = await this.keyVault.getPreConfiguredKey(authorization.key_ref, endpoint.toLowerCase());
        } else if (authorization.credential_source === 'user_provided') {
          apiKey = await this.keyVault.getUserKey(userId, endpoint.toLowerCase());
        }
      } catch (keyError) {
        logger.error(`[ModelAccessService] API key resolution failed:`, keyError);
        return {
          authorized: false,
          reason: 'API key not available',
          code: 'API_KEY_UNAVAILABLE'
        };
      }

      logger.info(`[ModelAccessService] Access authorized for ${userId} - ${endpoint}/${model}`);
      return {
        authorized: true,
        model_config: authorization.model_config,
        credential_source: authorization.credential_source,
        api_key: apiKey,
        rate_limits: authorization.rate_limits,
        constrained_params: this._applyParameterConstraints(parameters, authorization.model_config)
      };

    } catch (error) {
      logger.error(`[ModelAccessService] Authorization error for ${userId}:`, error);
      return {
        authorized: false,
        reason: 'Authorization system error',
        code: 'AUTHORIZATION_ERROR'
      };
    }
  }

  /**
   * Simple validation check - does user have access to this model?
   * @param {string} userId - User ID
   * @param {Object} tokenClaims - JWT token claims
   * @param {string} model - Model ID
   * @param {string} endpoint - Endpoint
   * @returns {Promise<boolean>} True if user has access
   */
  async validateAccess(userId, tokenClaims, model, endpoint) {
    const availableModels = await this.getAvailableModels(userId, tokenClaims);

    logger.info(`[ModelAccessService] validateAccess - Looking for ${endpoint}/${model}`);
    logger.info(`[ModelAccessService] validateAccess - Available models:`, availableModels.map(m => `${m.endpoint}/${m.model}`));

    // Case-insensitive endpoint matching to handle openAI vs openai differences
    const hasAccess = availableModels.some(m =>
      m.model === model && m.endpoint.toLowerCase() === endpoint.toLowerCase()
    );
    logger.info(`[ModelAccessService] validateAccess - Access granted: ${hasAccess}`);

    return hasAccess;
  }

  /**
   * Clear cache for a specific user or all users
   * @param {string} [userId] - Optional user ID, if not provided clears all
   */
  clearCache(userId = null) {
    if (userId) {
      // Clear cache entries for specific user
      for (const [key] of this.userCacheMap) {
        if (key.startsWith(`${userId}:`)) {
          this.userCacheMap.delete(key);
        }
      }
      logger.debug(`[ModelAccessService] Cleared cache for user: ${userId}`);
    } else {
      // Clear all cache
      this.userCacheMap.clear();
      logger.debug(`[ModelAccessService] Cleared all user cache`);
    }
  }

  /**
   * Generate cache key for user-specific caching
   * @private
   */
  _generateUserCacheKey(userId, tokenClaims) {
    const tokenSignature = JSON.stringify({
      iat: tokenClaims.iat,
      groups: tokenClaims.groups,
      realm_access: tokenClaims.realm_access
    });
    return `${userId}:${tokenSignature}`;
  }

  /**
   * Apply parameter constraints based on model config
   * @private
   */
  _applyParameterConstraints(parameters, modelConfig) {
    const constrained = { ...parameters };

    if (parameters.max_tokens && parameters.max_tokens > modelConfig.max_tokens) {
      constrained.max_tokens = modelConfig.max_tokens;
    }

    if (parameters.temperature && parameters.temperature > modelConfig.temperature_max) {
      constrained.temperature = modelConfig.temperature_max;
    }

    return constrained;
  }
}

// Export singleton instance
const modelAccessService = new ModelAccessService();

module.exports = { ModelAccessService, modelAccessService };