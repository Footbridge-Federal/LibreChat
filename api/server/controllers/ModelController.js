const { CacheKeys } = require('librechat-data-provider');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');
const { getLogStores } = require('~/cache');
const { logger } = require('~/config');
const { getAvailableModels } = require('~/server/middleware/modelAccessControl');

/**
 * @param {ServerRequest} req
 * @returns {Promise<TModelsConfig>} The models config.
 */
const getModelsConfig = async (req) => {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  let modelsConfig = await cache.get(CacheKeys.MODELS_CONFIG);
  if (!modelsConfig) {
    modelsConfig = await loadModels(req);
  }

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
    // Clear model cache if model access control is enabled to prevent stale data
    if (process.env.MODEL_ACCESS_ENABLED === 'true') {
      const cache = getLogStores(CacheKeys.CONFIG_STORE);
      await cache.delete(CacheKeys.MODELS_CONFIG);
      await cache.delete(CacheKeys.ENDPOINT_CONFIG);
      await cache.delete(CacheKeys.STARTUP_CONFIG);
    }

    // Get user's available models using model access control
    const userId = req.user?.id;
    const tokenClaims = req.user?.token_claims || {};

    if (process.env.KEYCLOAK_ENABLED === 'true') {
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Use new model access control system ONLY
      const availableModels = await getAvailableModels(userId, tokenClaims);

      // DEBUG: Log what we're getting
      logger.info(`[ModelController] User ${userId} available models:`, {
        count: availableModels.length,
        models: availableModels,
        tokenClaims: Object.keys(tokenClaims)
      });

      // SECURITY: If no models are authorized, return empty config (don't show defaults!)
      if (availableModels.length === 0) {
        logger.warn(`[SECURITY] User ${userId} has no authorized models - denying all access`);
        return res.json({});
      }

      // Convert to the format expected by LibreChat UI
      const modelConfig = {};

      for (const model of availableModels) {
        const endpoint = model.endpoint;
        if (!modelConfig[endpoint]) {
          modelConfig[endpoint] = {
            availableModels: [],
            userProvide: false // Will be set to true if ANY model requires user key
          };
        }

        // If any model in this endpoint requires user key, mark endpoint as userProvide
        if (model.requires_user_key) {
          modelConfig[endpoint].userProvide = true;
        }

        modelConfig[endpoint].availableModels.push({
          name: model.model_id,
          displayName: model.display_name || model.model_id,
          maxTokens: model.max_tokens || 8000,
          description: model.description || '',
          default: model.is_default || false,
          // Add per-model metadata for UI
          requiresUserKey: model.requires_user_key || false
        });
      }

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
