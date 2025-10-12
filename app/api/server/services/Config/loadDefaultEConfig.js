const { EModelEndpoint, getEnabledEndpoints } = require('librechat-data-provider');
const loadAsyncEndpoints = require('./loadAsyncEndpoints');
const { config } = require('./EndpointService');

/**
 * Load async endpoints and return a configuration object
 * @param {Express.Request} req - The request object
 * @returns {Promise<Object.<string, EndpointWithOrder>>} An object whose keys are endpoint names and values are objects that contain the endpoint configuration and an order.
 */
async function loadDefaultEndpointsConfig(req) {
  // SECURITY: If model access control is enabled, don't load default endpoints from env
  if (process.env.MODEL_ACCESS_ENABLED === 'true') {
    console.log('[loadDefaultEndpointsConfig] MODEL_ACCESS_ENABLED=true → Skipping env-based endpoint loading');
    return {}; // Return empty config - all endpoints disabled when using model access control
  }

  const { google, gptPlugins } = await loadAsyncEndpoints(req);
  const { assistants, azureAssistants, azureOpenAI, chatGPTBrowser } = config;

  const enabledEndpoints = getEnabledEndpoints();

  const endpointConfig = {
    [EModelEndpoint.openAI]: config[EModelEndpoint.openAI],
    [EModelEndpoint.agents]: config[EModelEndpoint.agents],
    [EModelEndpoint.assistants]: assistants,
    [EModelEndpoint.azureAssistants]: azureAssistants,
    [EModelEndpoint.azureOpenAI]: azureOpenAI,
    [EModelEndpoint.google]: google,
    [EModelEndpoint.chatGPTBrowser]: chatGPTBrowser,
    [EModelEndpoint.gptPlugins]: gptPlugins,
    [EModelEndpoint.anthropic]: config[EModelEndpoint.anthropic],
    [EModelEndpoint.bedrock]: config[EModelEndpoint.bedrock],
  };

  const orderedAndFilteredEndpoints = enabledEndpoints.reduce((config, key, index) => {
    if (endpointConfig[key]) {
      config[key] = { ...(endpointConfig[key] ?? {}), order: index };
    }
    return config;
  }, {});

  return orderedAndFilteredEndpoints;
}

module.exports = loadDefaultEndpointsConfig;
