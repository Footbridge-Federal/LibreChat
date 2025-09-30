const { ErrorTypes, EModelEndpoint, mapModelToAzureConfig } = require('librechat-data-provider');
const {
  isEnabled,
  resolveHeaders,
  isUserProvided,
  getOpenAIConfig,
  getAzureCredentials,
  createHandleLLMNewToken,
} = require('@librechat/api');
const { getUserKeyValues, checkUserKeyExpiry } = require('~/server/services/UserService');
const { KeyVault } = require('~/server/services/ModelAccess/KeyVault');
const { SimpleModelAccessService } = require('~/server/services/ModelAccess/SimpleModelAccessService');
const OpenAIClient = require('~/app/clients/OpenAIClient');
const { logger } = require('~/config');

const initializeClient = async ({
  req,
  res,
  endpointOption,
  optionsOnly,
  overrideEndpoint,
  overrideModel,
}) => {
  const {
    PROXY,
    OPENAI_API_KEY,
    AZURE_API_KEY,
    OPENAI_REVERSE_PROXY,
    AZURE_OPENAI_BASEURL,
    OPENAI_SUMMARIZE,
    DEBUG_OPENAI,
  } = process.env;
  const { key: expiresAt } = req.body;
  const modelName = overrideModel ?? req.body.model;
  const endpoint = overrideEndpoint ?? req.body.endpoint;
  const contextStrategy = isEnabled(OPENAI_SUMMARIZE) ? 'summarize' : null;

  const credentials = {
    [EModelEndpoint.openAI]: OPENAI_API_KEY,
    [EModelEndpoint.azureOpenAI]: AZURE_API_KEY,
  };

  const baseURLOptions = {
    [EModelEndpoint.openAI]: OPENAI_REVERSE_PROXY,
    [EModelEndpoint.azureOpenAI]: AZURE_OPENAI_BASEURL,
  };

  const userProvidesKey = isUserProvided(credentials[endpoint]);
  const userProvidesURL = isUserProvided(baseURLOptions[endpoint]);

  let userValues = null;
  if (expiresAt && (userProvidesKey || userProvidesURL)) {
    checkUserKeyExpiry(expiresAt, endpoint);
    userValues = await getUserKeyValues({ userId: req.user.id, name: endpoint });
  }

  // Determine provider name for authorization
  const isAzureEndpoint = endpoint === EModelEndpoint.azureOpenAI;
  const providerForAuth = isAzureEndpoint ? 'azure' : 'openai';

  // Get API key from KeyVault using user's group and model authorization
  let apiKey;
  let baseURL = userProvidesURL ? userValues?.baseURL : baseURLOptions[endpoint];

  // First check if user provides their own key (legacy behavior)
  if (userProvidesKey && userValues?.apiKey) {
    apiKey = userValues.apiKey;
    logger.info(`[initializeClient] Using user-provided API key for ${endpoint}`);
  } else if (!userProvidesKey) {
    // Use KeyVault for group-based API keys
    try {
      const keyVault = new KeyVault();
      const accessService = new SimpleModelAccessService();

      // Extract groups from JWT token claims
      const userGroups = req.user.groups || req.user.token_claims?.groups || [];

      logger.info(`[initializeClient] Authorizing ${providerForAuth}/${modelName} for user ${req.user.id}, groups:`, userGroups);

      // Authorize and get key_ref
      const authResult = await accessService.authorize(
        req.user.id,
        userGroups,
        modelName,
        providerForAuth
      );

      if (!authResult.authorized) {
        throw new Error(authResult.reason || `Access denied to ${providerForAuth}/${modelName}`);
      }

      logger.info(`[initializeClient] Authorization successful, key_source: ${authResult.key_source}, key_ref: ${authResult.key_ref}`);

      // Get API key from vault using key_ref
      if (authResult.key_source === 'user') {
        // User-provided key stored in vault
        apiKey = await keyVault.getUserKey(req.user.id, authResult.model_config.provider);
      } else {
        // Pre-configured group key
        apiKey = await keyVault.getPreConfiguredKey(authResult.key_ref, authResult.model_config.provider);
      }

      logger.info(`[initializeClient] Successfully retrieved API key from KeyVault for ${providerForAuth}/${modelName}`);
    } catch (error) {
      logger.error(`[initializeClient] KeyVault error:`, error);

      // Fallback to legacy env var if KeyVault fails
      apiKey = credentials[endpoint];
      if (!apiKey) {
        throw new Error(`${endpoint} API Key not available. Error: ${error.message}`);
      }
      logger.warn(`[initializeClient] Falling back to environment variable for ${endpoint}`);
    }
  } else {
    // User should provide key but didn't
    apiKey = null;
  }

  let clientOptions = {
    contextStrategy,
    proxy: PROXY ?? null,
    debug: isEnabled(DEBUG_OPENAI),
    reverseProxyUrl: baseURL ? baseURL : null,
    ...endpointOption,
  };

  const isAzureOpenAI = endpoint === EModelEndpoint.azureOpenAI;
  /** @type {false | TAzureConfig} */
  const azureConfig = isAzureOpenAI && req.app.locals[EModelEndpoint.azureOpenAI];
  let serverless = false;
  if (isAzureOpenAI && azureConfig) {
    const { modelGroupMap, groupMap } = azureConfig;
    const {
      azureOptions,
      baseURL,
      headers = {},
      serverless: _serverless,
    } = mapModelToAzureConfig({
      modelName,
      modelGroupMap,
      groupMap,
    });
    serverless = _serverless;

    clientOptions.reverseProxyUrl = baseURL ?? clientOptions.reverseProxyUrl;
    clientOptions.headers = resolveHeaders({
      headers: { ...headers, ...(clientOptions.headers ?? {}) },
      user: req.user,
    });

    clientOptions.titleConvo = azureConfig.titleConvo;
    clientOptions.titleModel = azureConfig.titleModel;

    const azureRate = modelName.includes('gpt-4') ? 30 : 17;
    clientOptions.streamRate = azureConfig.streamRate ?? azureRate;

    clientOptions.titleMethod = azureConfig.titleMethod ?? 'completion';

    const groupName = modelGroupMap[modelName].group;
    clientOptions.addParams = azureConfig.groupMap[groupName].addParams;
    clientOptions.dropParams = azureConfig.groupMap[groupName].dropParams;
    clientOptions.forcePrompt = azureConfig.groupMap[groupName].forcePrompt;

    apiKey = azureOptions.azureOpenAIApiKey;
    clientOptions.azure = !serverless && azureOptions;
    if (serverless === true) {
      clientOptions.defaultQuery = azureOptions.azureOpenAIApiVersion
        ? { 'api-version': azureOptions.azureOpenAIApiVersion }
        : undefined;
      clientOptions.headers['api-key'] = apiKey;
    }
  } else if (isAzureOpenAI) {
    clientOptions.azure = userProvidesKey ? JSON.parse(userValues.apiKey) : getAzureCredentials();
    apiKey = clientOptions.azure.azureOpenAIApiKey;
  }

  /** @type {undefined | TBaseEndpoint} */
  const openAIConfig = req.app.locals[EModelEndpoint.openAI];

  if (!isAzureOpenAI && openAIConfig) {
    clientOptions.streamRate = openAIConfig.streamRate;
    clientOptions.titleModel = openAIConfig.titleModel;
  }

  /** @type {undefined | TBaseEndpoint} */
  const allConfig = req.app.locals.all;
  if (allConfig) {
    clientOptions.streamRate = allConfig.streamRate;
  }

  if (userProvidesKey & !apiKey) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (!apiKey) {
    throw new Error(`${endpoint} API Key not provided.`);
  }

  if (optionsOnly) {
    const modelOptions = endpointOption?.model_parameters ?? {};
    modelOptions.model = modelName;
    clientOptions = Object.assign({ modelOptions }, clientOptions);
    clientOptions.modelOptions.user = req.user.id;
    const options = getOpenAIConfig(apiKey, clientOptions);
    if (options != null && serverless === true) {
      options.useLegacyContent = true;
    }
    const streamRate = clientOptions.streamRate;
    if (!streamRate) {
      return options;
    }
    options.llmConfig.callbacks = [
      {
        handleLLMNewToken: createHandleLLMNewToken(streamRate),
      },
    ];
    return options;
  }

  const client = new OpenAIClient(apiKey, Object.assign({ req, res }, clientOptions));
  return {
    client,
    openAIApiKey: apiKey,
  };
};

module.exports = initializeClient;
