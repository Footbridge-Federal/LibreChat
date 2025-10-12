/**
 * Bedrock options for multi-agent tool use
 * This is only used when bedrock is a sub-agent in multi-agent scenarios
 * For primary bedrock endpoint, see initialize.js
 */
const { KeyVault } = require('~/server/services/ModelAccess/KeyVault');
const { SimpleModelAccessService } = require('~/server/services/ModelAccess/SimpleModelAccessService');
const { logger } = require('~/config');

const getOptions = async ({ req, overrideModel, endpointOption }) => {
  const modelName = overrideModel || endpointOption?.model_parameters?.model;

  logger.info(`[Bedrock/Options] Getting options for multi-agent tool use: ${modelName}`);

  // Get credentials from KeyVault using new system
  let credentials;
  let region;

  try {
    const keyVault = new KeyVault();
    const accessService = new SimpleModelAccessService();

    // Extract groups from JWT token claims
    const userGroups = req.user.groups || req.user.token_claims?.groups || [];

    logger.info(`[Bedrock/Options] Authorizing bedrock/${modelName} for user ${req.user.id}`);

    // Authorize and get key_ref
    const authResult = await accessService.authorize(
      req.user.id,
      userGroups,
      modelName,
      'bedrock'
    );

    if (!authResult.authorized) {
      throw new Error(authResult.reason || `Access denied to bedrock/${modelName}`);
    }

    // Get region from model config
    region = authResult.model_config?.region;

    // Get credentials from vault using key_ref
    if (authResult.key_source === 'user') {
      const apiKey = await keyVault.getUserKey(req.user.id, 'bedrock');
      if (typeof apiKey === 'object' && apiKey.accessKeyId && apiKey.secretAccessKey) {
        credentials = {
          accessKeyId: apiKey.accessKeyId,
          secretAccessKey: apiKey.secretAccessKey,
          ...(apiKey.sessionToken && { sessionToken: apiKey.sessionToken }),
        };
      } else {
        throw new Error('Invalid Bedrock credentials format for user key');
      }
    } else {
      const apiKey = await keyVault.getPreConfiguredKey(authResult.key_ref, 'bedrock');
      logger.info('[Bedrock/Options] Retrieved apiKey type:', typeof apiKey);
      logger.info('[Bedrock/Options] apiKey is string?', typeof apiKey === 'string');

      // The apiKey might be a JSON string that needs parsing
      let parsedKey = apiKey;
      if (typeof apiKey === 'string') {
        try {
          parsedKey = JSON.parse(apiKey);
          logger.info('[Bedrock/Options] Parsed JSON string to object');
        } catch (e) {
          logger.warn('[Bedrock/Options] Could not parse as JSON:', e.message);
        }
      }

      logger.info('[Bedrock/Options] parsedKey type:', typeof parsedKey);
      logger.info('[Bedrock/Options] parsedKey keys:', parsedKey ? Object.keys(parsedKey) : 'null');

      if (typeof parsedKey === 'object' && parsedKey.accessKeyId && parsedKey.secretAccessKey) {
        credentials = {
          accessKeyId: parsedKey.accessKeyId,
          secretAccessKey: parsedKey.secretAccessKey,
          ...(parsedKey.sessionToken && { sessionToken: parsedKey.sessionToken }),
        };
      } else {
        throw new Error('Invalid Bedrock credentials format in KeyVault');
      }
    }

    logger.info(`[Bedrock/Options] Successfully retrieved AWS credentials from KeyVault`);
  } catch (error) {
    logger.error(`[Bedrock/Options] KeyVault error:`, error);
    throw new Error(`Bedrock credentials not available. Error: ${error.message}`);
  }

  return {
    llmConfig: {
      model: modelName,
      region: region || 'us-east-1',
      credentials: credentials,
    },
    configOptions: {},
  };
};

module.exports = getOptions;
