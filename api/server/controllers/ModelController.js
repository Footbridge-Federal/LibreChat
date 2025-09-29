const { CacheKeys, EModelEndpoint } = require('librechat-data-provider');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');
const { getLogStores } = require('~/cache');
const { logger } = require('~/config');
const { getAvailableModels } = require('~/server/middleware/modelAccessControl');

/**
 * @param {ServerRequest} req
 * @returns {Promise<TModelsConfig>} The models config.
 */
const getModelsConfig = async (req) => {
  logger.info(`[getModelsConfig] Called for user: ${req?.user?.id || 'unknown'}`);
  const cache = getLogStores(CacheKeys.CONFIG_STORE);

  // Clear cache if model access control is enabled to prevent stale data
  if (process.env.MODEL_ACCESS_ENABLED === 'true') {
    logger.info(`[getModelsConfig] Model access control enabled - clearing cache`);
    await cache.delete(CacheKeys.MODELS_CONFIG);
    await cache.delete(CacheKeys.ENDPOINT_CONFIG);
    await cache.delete(CacheKeys.STARTUP_CONFIG);
  }

  let modelsConfig = await cache.get(CacheKeys.MODELS_CONFIG);
  if (!modelsConfig) {
    logger.info(`[getModelsConfig] Cache miss, calling loadModels`);
    modelsConfig = await loadModels(req);
  } else {
    logger.info(`[getModelsConfig] Cache hit`);
  }

  logger.info(`[getModelsConfig] Returning:`, modelsConfig);
  return modelsConfig;
};

/**
 * Loads the models from the config.
 * @param {ServerRequest} req - The Express request object.
 * @returns {Promise<TModelsConfig>} The models config.
 */
async function loadModels(req) {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const cachedModelsConfig = await cache.get(CacheKeys.MODELS_CONFIG);
  if (cachedModelsConfig) {
    return cachedModelsConfig;
  }
  const defaultModelsConfig = await loadDefaultModels(req);
  const customModelsConfig = await loadConfigModels(req);

  const modelConfig = { ...defaultModelsConfig, ...customModelsConfig };

  await cache.set(CacheKeys.MODELS_CONFIG, modelConfig);
  return modelConfig;
}

async function modelController(req, res) {
  try {
    logger.info(`[ModelController] Called by: ${req.originalUrl || 'unknown'}, user: ${req.user?.id || 'none'}`);

    // Get user's available models using model access control
    const userId = req.user?.id;
    const tokenClaims = req.user?.token_claims || {};

    // CRITICAL DEBUG: Log the raw token claims
    logger.info(`[ModelController] Raw req.user:`, {
      userId,
      userKeys: Object.keys(req.user || {}),
      hasTokenClaims: !!req.user?.token_claims,
      tokenClaimsKeys: Object.keys(tokenClaims),
      rawTokenClaims: tokenClaims
    });

    if (process.env.KEYCLOAK_ENABLED === 'true') {
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Use new model access control system ONLY
      const availableModels = await getAvailableModels(userId, tokenClaims);

      // DEBUG: Log what we're getting
      logger.info(`[ModelController] User ${userId} debug info:`, {
        count: availableModels.length,
        tokenClaimsKeys: Object.keys(tokenClaims),
        groups: tokenClaims.groups,
        hasGroupAttributes: !!tokenClaims.group_attributes,
        groupAttributes: tokenClaims.group_attributes,
        availableModels: availableModels.map(m => `${m.endpoint}/${m.model}`)
      });

      // SECURITY: If no models are authorized, return empty config (don't show defaults!)
      if (availableModels.length === 0) {
        logger.warn(`[SECURITY] User ${userId} has no authorized models - denying all access`);
        return res.json({});
      }

      // Convert to the format expected by LibreChat UI
      // LibreChat expects: { endpoint: [model1, model2, ...] }
      const modelConfig = {};

      // Map endpoint names to LibreChat constants
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

        // LibreChat expects simple model names in arrays
        modelConfig[librechatEndpoint].push(model.model || model.model_id);
      }

      logger.info(`[ModelController] Returning model config:`, modelConfig);

      res.send(modelConfig);
    } else {
      // SECURITY: No fallback when Keycloak is disabled - require explicit configuration
      logger.warn('SECURITY: Model access attempted without Keycloak enabled - denying access');
      res.status(403).json({
        error: 'Model access control required',
        message: 'Keycloak must be enabled for model access'
      });
    }
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).send({ error: error.message });
  }
}

module.exports = { modelController, loadModels, getModelsConfig };
