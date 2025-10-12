const { logger } = require('~/config');
const { ModelAccess } = require('~/db/models');
const { EModelEndpoint } = require('librechat-data-provider');
const { configMerger } = require('~/server/services/ModelAccess/ConfigMerger');

/**
 * Dramatically simplified model access service
 * Replaces the entire PolicyEngine + ModelAccessService complexity
 *
 * Single responsibility: JWT groups -> model access permissions
 * Single data source: ModelAccess table
 * Single data format: consistent throughout
 */
class SimpleModelAccessService {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get all models available to a user based on their JWT groups
   * @param {string} userId - User ID
   * @param {string[]} jwtGroups - JWT group paths like ['/org-airwall']
   * @returns {Promise<Array>} Available models
   */
  async getAvailableModels(userId, jwtGroups = []) {
    if (!userId) {
      logger.warn('[SimpleModelAccess] No userId provided');
      return [];
    }

    const cacheKey = this._generateCacheKey(userId, jwtGroups);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      logger.debug(`[SimpleModelAccess] Cache hit for user ${userId}`);
      return cached.models;
    }

    try {
      logger.info(`[SimpleModelAccess] Fetching models for user ${userId}, groups:`, jwtGroups);

      // Get effective configurations (merged git baseline + runtime overrides)
      let accessRules = [];

      try {
        // Get configs for each group the user is in
        for (const group of jwtGroups) {
          const groupConfigs = await configMerger.getAllEffectiveConfigs(group, 'group');
          accessRules.push(...groupConfigs);
        }

        // Also check for user-specific rules
        const userConfigs = await configMerger.getAllEffectiveConfigs(userId, 'user');
        accessRules.push(...userConfigs);

        logger.info(`[SimpleModelAccess] Found ${accessRules.length} effective access rules (git + runtime merged)`);
      } catch (error) {
        logger.warn(`[SimpleModelAccess] ConfigMerger query failed: ${error.message}. Falling back to direct database query.`);

        // Fallback to direct database query
        try {
          accessRules = await ModelAccess.find({
            $or: [
              { type: 'user', subject: userId },
              { type: 'group', subject: { $in: jwtGroups } }
            ],
            active: true,
            configSource: { $in: ['git', 'runtime'] }
          });
          logger.info(`[SimpleModelAccess] Fallback found ${accessRules.length} access rules from database`);
        } catch (dbError) {
          logger.error(`[SimpleModelAccess] Database fallback also failed: ${dbError.message}`);
          accessRules = [];
        }
      }

      // TEMPORARY: If no rules found, fall back to environment variable configuration
      if (accessRules.length === 0) {
        logger.info(`[SimpleModelAccess] No rules found, using environment fallback for groups:`, jwtGroups);
        accessRules = this._createFallbackRules(jwtGroups);
      }

      // Transform to consistent format
      const models = accessRules.map(rule => ({
        id: `${rule.provider}/${rule.model}`,
        model: rule.model,
        endpoint: rule.provider,
        provider: rule.provider,
        max_tokens: rule.maxTokens,
        max_output_tokens: rule.maxOutputTokens,
        temperature_max: rule.temperatureMax,
        requires_user_key: rule.keySource === 'user',
        display_name: rule.model,
        rate_limits: {
          requests_per_minute: rule.requestsPerMinute,
          tokens_per_day: rule.tokensPerDay,
          monthly_token_limit: rule.monthlyTokenLimit
        },
        key_source: rule.keySource,
        key_ref: rule.keyRef
      }));

      // Handle duplicate models from multiple groups (take highest limits)
      const mergedModels = this._mergeModelLimits(models);

      // Cache result
      this.cache.set(cacheKey, {
        models: mergedModels,
        timestamp: Date.now()
      });

      logger.info(`[SimpleModelAccess] Returning ${mergedModels.length} models for user ${userId}`);
      return mergedModels;

    } catch (error) {
      logger.error(`[SimpleModelAccess] Error getting models for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get models in LibreChat UI format {endpoint: [model1, model2, ...]}
   * AND endpoint configuration {endpoint: {userProvide, order, etc}}
   * @param {string} userId - User ID
   * @param {string[]} jwtGroups - JWT groups
   * @returns {Promise<Object>} Combined config
   */
  async getModelsConfig(userId, jwtGroups = []) {
    const availableModels = await this.getAvailableModels(userId, jwtGroups);

    if (availableModels.length === 0) {
      return {};
    }

    const endpointMap = {
      'openai': EModelEndpoint.openAI,
      'anthropic': EModelEndpoint.anthropic,
      'google': EModelEndpoint.google,
      'bedrock': EModelEndpoint.bedrock,
      'azure': EModelEndpoint.azureOpenAI
    };

    // Group models by endpoint and track metadata
    const endpointData = {};
    let orderCounter = 0;

    for (const model of availableModels) {
      const endpoint = endpointMap[model.provider] || model.provider;

      if (!endpointData[endpoint]) {
        endpointData[endpoint] = {
          models: [],
          requiresUserKey: false,
          order: orderCounter++
        };
      }

      endpointData[endpoint].models.push(model.model);

      // If ANY model in this endpoint requires user key, flag it
      if (model.requires_user_key) {
        endpointData[endpoint].requiresUserKey = true;
      }
    }

    // Build response with BOTH models array AND endpoint config properties
    // LibreChat frontend expects this merged format
    const result = {};

    for (const [endpoint, data] of Object.entries(endpointData)) {
      // Return array directly (modelsConfig format) with endpoint properties attached
      const modelsArray = data.models;
      // Attach endpoint config as properties on the array object
      modelsArray.order = data.order;
      modelsArray.userProvide = data.requiresUserKey;
      modelsArray.availableTools = [];

      result[endpoint] = modelsArray;
    }

    logger.info(`[SimpleModelAccess] Models config for user ${userId}:`, JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Simple validation - does user have access to this specific model?
   * @param {string} userId - User ID
   * @param {string[]} jwtGroups - JWT groups
   * @param {string} model - Model name
   * @param {string} provider - Provider name
   * @returns {Promise<boolean>} Has access
   */
  async hasAccess(userId, jwtGroups, model, provider) {
    const models = await this.getAvailableModels(userId, jwtGroups);

    // Case-insensitive provider matching
    const hasAccess = models.some(m =>
      m.model === model && m.provider.toLowerCase() === provider.toLowerCase()
    );

    logger.info(`[SimpleModelAccess] Access check: ${provider}/${model} = ${hasAccess}`);
    return hasAccess;
  }

  /**
   * Authorize a specific model request with full details
   * @param {string} userId - User ID
   * @param {string[]} jwtGroups - JWT groups
   * @param {string} model - Model name
   * @param {string} provider - Provider name
   * @param {Object} parameters - Request parameters
   * @returns {Promise<Object>} Authorization result
   */
  async authorize(userId, jwtGroups, model, provider, parameters = {}) {
    logger.info(`[SimpleModelAccess] Authorizing ${provider}/${model} for user ${userId}`);

    const models = await this.getAvailableModels(userId, jwtGroups);
    const modelConfig = models.find(m =>
      m.model === model && m.provider.toLowerCase() === provider.toLowerCase()
    );

    if (!modelConfig) {
      return {
        authorized: false,
        reason: 'Model not available in your access permissions',
        code: 'MODEL_NOT_ALLOWED'
      };
    }

    // Validate parameters against limits
    const constrainedParams = this._constrainParameters(parameters, modelConfig);

    return {
      authorized: true,
      model_config: modelConfig,
      key_source: modelConfig.key_source,
      key_ref: modelConfig.key_ref,
      rate_limits: modelConfig.rate_limits,
      constrained_params: constrainedParams
    };
  }

  /**
   * Clear cache for user or all users
   * @param {string} [userId] - Optional user ID
   */
  clearCache(userId = null) {
    if (userId) {
      for (const [key] of this.cache) {
        if (key.startsWith(`${userId}:`)) {
          this.cache.delete(key);
        }
      }
      logger.debug(`[SimpleModelAccess] Cleared cache for user: ${userId}`);
    } else {
      this.cache.clear();
      logger.debug(`[SimpleModelAccess] Cleared all cache`);
    }
  }

  // Private helper methods

  _generateCacheKey(userId, jwtGroups) {
    const groupsStr = Array.isArray(jwtGroups) ? jwtGroups.sort().join(',') : '';
    return `${userId}:${groupsStr}`;
  }

  _mergeModelLimits(models) {
    const modelMap = new Map();

    for (const model of models) {
      const key = `${model.provider}/${model.model}`;

      if (modelMap.has(key)) {
        const existing = modelMap.get(key);
        // Take highest limits when merging
        modelMap.set(key, {
          ...existing,
          max_tokens: Math.max(existing.max_tokens, model.max_tokens),
          max_output_tokens: Math.max(existing.max_output_tokens, model.max_output_tokens),
          temperature_max: Math.max(existing.temperature_max, model.temperature_max),
          rate_limits: {
            requests_per_minute: Math.max(
              existing.rate_limits.requests_per_minute,
              model.rate_limits.requests_per_minute
            ),
            tokens_per_day: Math.max(
              existing.rate_limits.tokens_per_day,
              model.rate_limits.tokens_per_day
            ),
            monthly_token_limit: Math.max(
              existing.rate_limits.monthly_token_limit,
              model.rate_limits.monthly_token_limit
            )
          }
        });
      } else {
        modelMap.set(key, model);
      }
    }

    return Array.from(modelMap.values());
  }

  _constrainParameters(parameters, modelConfig) {
    const constrained = { ...parameters };

    if (parameters.max_tokens && parameters.max_tokens > modelConfig.max_tokens) {
      constrained.max_tokens = modelConfig.max_tokens;
    }

    if (parameters.temperature && parameters.temperature > modelConfig.temperature_max) {
      constrained.temperature = modelConfig.temperature_max;
    }

    return constrained;
  }

  /**
   * TEMPORARY: Create fallback rules from environment variables
   * This will be removed once database migration is complete
   * @private
   */
  _createFallbackRules(jwtGroups) {
    const fallbackRules = [];

    // Process each JWT group
    for (const groupPath of jwtGroups) {
      logger.info(`[SimpleModelAccess] Processing fallback for group: ${groupPath}`);

      // Map group to environment configuration (simplified version of PolicyEngine logic)
      if (groupPath === '/org-airwall') {
        // Add the models that /org-airwall should have access to
        fallbackRules.push({
          provider: 'openai',
          model: 'gpt-4o-mini',
          maxTokens: 8000,
          maxOutputTokens: 4000,
          temperatureMax: 1.0,
          requestsPerMinute: 60,
          tokensPerDay: 33333,
          monthlyTokenLimit: 1000000,
          keySource: 'preconfigured',
          keyRef: 'airwall_openai'
        });

        fallbackRules.push({
          provider: 'anthropic',
          model: 'claude-3.5',
          maxTokens: 8000,
          maxOutputTokens: 4000,
          temperatureMax: 1.0,
          requestsPerMinute: 60,
          tokensPerDay: 33333,
          monthlyTokenLimit: 1000000,
          keySource: 'preconfigured',
          keyRef: 'airwall_anthropic'
        });
      }
    }

    logger.info(`[SimpleModelAccess] Created ${fallbackRules.length} fallback rules`);
    return fallbackRules;
  }
}

// Export singleton
const simpleModelAccessService = new SimpleModelAccessService();

module.exports = { SimpleModelAccessService, simpleModelAccessService };