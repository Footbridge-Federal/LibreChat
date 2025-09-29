const { getEndpointsConfig } = require('~/server/services/Config');
const { modelController } = require('./ModelController');
const { logger } = require('~/config');

async function endpointController(req, res) {
  // If Keycloak is enabled and user is authenticated, use model access control
  if (process.env.KEYCLOAK_ENABLED === 'true' && req.user) {
    logger.debug('[EndpointController] Using model access control for authenticated user');
    return modelController(req, res);
  }

  // Fallback to static endpoint config
  const endpointsConfig = await getEndpointsConfig(req);
  res.send(JSON.stringify(endpointsConfig));
}

module.exports = endpointController;
