const { logger } = require('~/config');
const { PolicyEngine } = require('~/server/services/ModelAccess/PolicyEngine');
const { KeyVault } = require('~/server/services/ModelAccess/KeyVault');

const policyEngine = new PolicyEngine();
const keyVault = new KeyVault();

/**
 * Middleware to enforce model access control
 * Must be applied to all model endpoints (chat completions, embeddings, etc.)
 */
async function enforceModelAccess(req, res, next) {
  try {
    const startTime = Date.now();

    // Extract user info from token
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // Extract model and endpoint from request
    const { model, endpoint, ...parameters } = req.body;
    if (!model || !endpoint) {
      return res.status(400).json({
        error: 'Model and endpoint are required',
        code: 'MISSING_MODEL_INFO'
      });
    }

    logger.debug(`[ModelAccess] Authorizing ${user.id} for ${endpoint}/${model}`);

    // Get authorization decision
    const authorization = await policyEngine.authorize(
      user.id,
      user.token_claims || {},
      model,
      endpoint,
      parameters
    );

    if (!authorization.allowed) {
      // Log access denial
      await logAccessAttempt(user.id, model, endpoint, false, {
        reason: authorization.reason,
        rule_id: authorization.rule_id,
        decision_log: authorization.decision_log
      });

      return res.status(403).json({
        error: 'Model access denied',
        reason: authorization.reason,
        code: 'MODEL_ACCESS_DENIED',
        available_models: await getAvailableModels(user.id, user.token_claims)
      });
    }

    // Resolve API key based on credential source
    let apiKey;
    try {
      if (authorization.credential_source === 'pre_configured') {
        apiKey = await keyVault.getPreConfiguredKey(authorization.key_ref);
      } else if (authorization.credential_source === 'user_provided') {
        const provider = endpoint.toLowerCase();
        apiKey = await keyVault.getUserKey(user.id, provider);
      } else {
        throw new Error('Invalid credential source');
      }
    } catch (keyError) {
      logger.error('[ModelAccess] Failed to resolve API key:', keyError);

      await logAccessAttempt(user.id, model, endpoint, false, {
        reason: 'Failed to resolve API key',
        error_type: 'invalid_key',
        credential_source: authorization.credential_source
      });

      return res.status(403).json({
        error: 'API key not available',
        reason: keyError.message,
        code: 'API_KEY_UNAVAILABLE'
      });
    }

    // Apply parameter constraints
    const constrainedParams = applyConstraints(parameters, authorization.model_config);

    // Attach authorization info to request for downstream use
    req.modelAuth = {
      authorized: true,
      model_config: authorization.model_config,
      credential_source: authorization.credential_source,
      api_key: apiKey,
      rate_limits: authorization.rate_limits,
      decision_log: authorization.decision_log,
      original_params: parameters,
      constrained_params: constrainedParams,
      authorization_time: Date.now() - startTime
    };

    logger.info(`[ModelAccess] Authorized ${user.id} for ${endpoint}/${model} in ${req.modelAuth.authorization_time}ms`);

    next();

  } catch (error) {
    logger.error('[ModelAccess] Authorization error:', error);

    // Log the error attempt
    if (req.user && req.body?.model && req.body?.endpoint) {
      await logAccessAttempt(req.user.id, req.body.model, req.body.endpoint, false, {
        reason: 'Internal authorization error',
        error_type: 'other',
        error_message: error.message
      });
    }

    return res.status(500).json({
      error: 'Authorization system error',
      code: 'AUTHORIZATION_ERROR'
    });
  }
}

/**
 * Middleware to log successful model requests
 * Should be applied after successful model API calls
 */
async function logSuccessfulRequest(req, res, next) {
  // Store original json method
  const originalJson = res.json;

  res.json = function(data) {
    // Call original json method
    originalJson.call(this, data);

    // Log successful request asynchronously
    if (req.modelAuth && req.user) {
      setImmediate(async () => {
        try {
          const tokens = extractTokenUsage(data);
          await logAccessAttempt(
            req.user.id,
            req.modelAuth.model_config.model_id,
            req.modelAuth.model_config.endpoint,
            true,
            {
              tokens_in: tokens.input || 0,
              tokens_out: tokens.output || 0,
              cost_usd: calculateCost(req.modelAuth.model_config.model_id, tokens),
              credential_source: req.modelAuth.credential_source,
              response_time: Date.now() - req.requestStartTime,
              parameters: req.modelAuth.constrained_params
            }
          );
        } catch (error) {
          logger.error('[ModelAccess] Error logging successful request:', error);
        }
      });
    }
  };

  next();
}

/**
 * Get available models for a user (for discovery endpoint)
 */
async function getAvailableModels(userId, tokenClaims = {}) {
  try {
    const effectivePolicy = await policyEngine.computeEffectivePolicy(userId, tokenClaims);

    return effectivePolicy.allowed_models.map(model => ({
      id: `${model.endpoint}/${model.model_id}`,
      model: model.model_id,
      endpoint: model.endpoint,
      max_tokens: model.max_tokens,
      temperature_max: model.temperature_max,
      requires_user_key: model.credential_source === 'user_provided',
      has_user_key: false // Will be populated by separate call if needed
    }));
  } catch (error) {
    logger.error('[ModelAccess] Error getting available models:', error);
    return [];
  }
}

/**
 * Apply parameter constraints based on model policy
 * @private
 */
function applyConstraints(parameters, modelConfig) {
  const constrained = { ...parameters };

  if (parameters.max_tokens && parameters.max_tokens > modelConfig.max_tokens) {
    constrained.max_tokens = modelConfig.max_tokens;
    logger.debug(`[ModelAccess] Capped max_tokens to ${modelConfig.max_tokens}`);
  }

  if (parameters.temperature && parameters.temperature > modelConfig.temperature_max) {
    constrained.temperature = modelConfig.temperature_max;
    logger.debug(`[ModelAccess] Capped temperature to ${modelConfig.temperature_max}`);
  }

  return constrained;
}

/**
 * Extract token usage from API response
 * @private
 */
function extractTokenUsage(responseData) {
  if (responseData.usage) {
    return {
      input: responseData.usage.prompt_tokens,
      output: responseData.usage.completion_tokens
    };
  }

  // Try to extract from other response formats
  if (responseData.token_count) {
    return {
      input: responseData.token_count.input_tokens,
      output: responseData.token_count.output_tokens
    };
  }

  return { input: 0, output: 0 };
}

/**
 * Calculate cost based on model and token usage
 * @private
 */
function calculateCost(modelId, tokens) {
  // Simple cost calculation - in production, use actual pricing
  const costs = {
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'claude-3.5': { input: 0.003, output: 0.015 },
    'claude-3': { input: 0.0008, output: 0.004 }
  };

  const pricing = costs[modelId] || { input: 0.001, output: 0.002 };
  return ((tokens.input * pricing.input) + (tokens.output * pricing.output)) / 1000;
}

/**
 * Log access attempt to database
 * @private
 */
async function logAccessAttempt(userId, model, endpoint, success, details = {}) {
  try {
    const { AccessLog } = require('~/db/models');

    const logEntry = new AccessLog({
      user_id: userId,
      model,
      endpoint,
      request_type: details.request_type || 'chat',
      tokens_in: details.tokens_in || 0,
      tokens_out: details.tokens_out || 0,
      cost_usd: details.cost_usd || 0,
      policy_rule_id: details.rule_id,
      policy_decision: {
        effect: success ? 'allow' : 'deny',
        source: details.decision_log?.[0]?.source || 'app_policy'
      },
      credential_source: details.credential_source || 'pre_configured',
      response_time_ms: details.response_time,
      success,
      error_type: details.error_type,
      error_message: details.error_message || details.reason,
      request_metadata: {
        temperature: details.parameters?.temperature,
        max_tokens: details.parameters?.max_tokens,
        stream: details.parameters?.stream
      },
      billing_period: new Date().toISOString().slice(0, 7) // YYYY-MM format
    });

    await logEntry.save();

  } catch (error) {
    logger.error('[ModelAccess] Error logging access attempt:', error);
    // Don't throw - logging failures shouldn't break the request flow
  }
}

module.exports = {
  enforceModelAccess,
  logSuccessfulRequest,
  getAvailableModels
};