const { CacheKeys, EModelEndpoint } = require('librechat-data-provider');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');
const { getLogStores } = require('~/cache');
const { logger } = require('~/config');
const { modelAccessService } = require('~/server/services/ModelAccess/ModelAccessService');

/**
 * @param {ServerRequest} req
 * @returns {Promise<TModelsConfig>} The models config.
 */
const getModelsConfig = async (req) => {
  const userId = req?.user?.id;
  const tokenClaims = req?.user?.token_claims || {};

  if (process.env.KEYCLOAK_ENABLED === 'true' && process.env.MODEL_ACCESS_ENABLED === 'true') {
    if (!userId) {
      logger.debug(`[getModelsConfig] No authenticated user - returning empty config`);
      return {};
    }

    // Use ModelAccessService for dynamic, JWT-based model configuration
    const modelsConfig = await modelAccessService.getModelsConfig(userId, tokenClaims);
    logger.debug(`[getModelsConfig] Dynamic config for user ${userId}: ${Object.keys(modelsConfig).length} endpoints`);
    return modelsConfig;
  } else {
    // Fallback to static configuration loading for non-Keycloak setups
    logger.debug(`[getModelsConfig] Using static model configuration`);
    const modelsConfig = await loadModels(req);
    return modelsConfig;
  }
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

    // Use getModelsConfig which now handles all the logic via ModelAccessService
    const modelsConfig = await getModelsConfig(req);

    if (!modelsConfig || Object.keys(modelsConfig).length === 0) {
      logger.info(`[ModelController] No models available for user ${req.user?.id || 'unknown'}`);
      return res.json({});
    }

    logger.info(`[ModelController] Returning models config:`, modelsConfig);
    res.send(modelsConfig);

  } catch (error) {
    logger.error('[ModelController] Error fetching models:', error);
    res.status(500).send({ error: error.message });
  }
}

module.exports = { modelController, loadModels, getModelsConfig };
