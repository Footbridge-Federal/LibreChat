const { createContentAggregator } = require('@librechat/agents');
const {
  EModelEndpoint,
  providerEndpointMap,
  getResponseSender,
} = require('librechat-data-provider');
const { getDefaultHandlers } = require('~/server/controllers/agents/callbacks');
const AgentClient = require('~/server/controllers/agents/client');
const { getModelMaxTokens } = require('~/utils');
const { KeyVault } = require('~/server/services/ModelAccess/KeyVault');
const { SimpleModelAccessService } = require('~/server/services/ModelAccess/SimpleModelAccessService');
const { logger } = require('~/config');

const initializeClient = async ({ req, res, endpointOption }) => {
  if (!endpointOption) {
    throw new Error('Endpoint option not provided');
  }

  const modelName = endpointOption.model_parameters.model;

  // Get credentials from KeyVault using new system
  let credentials;
  let region;

  try {
    const keyVault = new KeyVault();
    const accessService = new SimpleModelAccessService();

    // Extract groups from JWT token claims
    const userGroups = req.user.groups || req.user.token_claims?.groups || [];

    logger.info(`[Bedrock] Authorizing bedrock/${modelName} for user ${req.user.id}, groups:`, userGroups);

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

    logger.info(`[Bedrock] Authorization successful, key_source: ${authResult.key_source}, key_ref: ${authResult.key_ref}`);

    // Get region from model config
    region = authResult.model_config?.region;

    // Get credentials from vault using key_ref
    if (authResult.key_source === 'user') {
      // User-provided key stored in vault
      const apiKey = await keyVault.getUserKey(req.user.id, 'bedrock');

      // For Bedrock, user key should be an object with AWS credentials
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
      // Pre-configured group key
      const apiKey = await keyVault.getPreConfiguredKey(authResult.key_ref, 'bedrock');

      // The apiKey might be a JSON string that needs parsing
      let parsedKey = apiKey;
      if (typeof apiKey === 'string') {
        try {
          parsedKey = JSON.parse(apiKey);
          logger.info('[Bedrock] Parsed JSON string to object');
        } catch (e) {
          logger.warn('[Bedrock] Could not parse as JSON:', e.message);
        }
      }

      // For Bedrock, apiKey is an object with AWS credentials
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

    logger.info(`[Bedrock] Successfully retrieved AWS credentials from KeyVault for bedrock/${modelName}`);
  } catch (error) {
    logger.error(`[Bedrock] KeyVault error:`, error);
    throw new Error(`Bedrock credentials not available. Error: ${error.message}`);
  }

  /** @type {Array<UsageMetadata>} */
  const collectedUsage = [];
  const { contentParts, aggregateContent } = createContentAggregator();
  const eventHandlers = getDefaultHandlers({ res, aggregateContent, collectedUsage });

  /** @type {Agent} */
  const agent = {
    id: EModelEndpoint.bedrock,
    name: endpointOption.name,
    provider: EModelEndpoint.bedrock,
    endpoint: EModelEndpoint.bedrock,
    instructions: endpointOption.promptPrefix,
    model: modelName,
    model_parameters: {
      ...endpointOption.model_parameters,
      model: modelName,
      region: region || 'us-east-1',
      credentials: credentials,
    },
  };

  if (typeof endpointOption.artifactsPrompt === 'string' && endpointOption.artifactsPrompt) {
    agent.instructions = `${agent.instructions ?? ''}\n${endpointOption.artifactsPrompt}`.trim();
  }

  const sender =
    agent.name ??
    getResponseSender({
      ...endpointOption,
      model: modelName,
    });

  const client = new AgentClient({
    req,
    res,
    agent,
    sender,
    // tools,
    contentParts,
    eventHandlers,
    collectedUsage,
    spec: endpointOption.spec,
    iconURL: endpointOption.iconURL,
    endpoint: EModelEndpoint.bedrock,
    resendFiles: endpointOption.resendFiles,
    maxContextTokens:
      endpointOption.maxContextTokens ??
      agent.max_context_tokens ??
      getModelMaxTokens(modelName, providerEndpointMap[agent.provider]) ??
      4000,
    attachments: endpointOption.attachments,
  });
  return { client };
};

module.exports = { initializeClient };
