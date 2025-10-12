const { handleError } = require('@librechat/api');
const { ViolationTypes } = require('librechat-data-provider');
const { simpleModelAccessService } = require('~/server/services/ModelAccess/SimpleModelAccessService');
const { logViolation } = require('~/cache');
/**
 * Validates the model of the request.
 *
 * @async
 * @param {Express.Request} req - The Express request object.
 * @param {Express.Response} res - The Express response object.
 * @param {Function} next - The Express next function.
 */
const validateModel = async (req, res, next) => {
  const { model, endpoint } = req.body;
  const userId = req.user?.id;
  const tokenClaims = req.user?.token_claims || {};
  const { logger } = require('~/config');

  logger.info(`[validateModel] Validating ${userId} for ${endpoint}/${model}`);

  if (!model || !endpoint) {
    return handleError(res, { text: 'Model and endpoint required' });
  }

  if (!userId) {
    return handleError(res, { text: 'Authentication required' });
  }

  try {
    // Use SimpleModelAccessService for validation
    const jwtGroups = tokenClaims?.groups || [];
    const isValid = await simpleModelAccessService.hasAccess(userId, jwtGroups, model, endpoint);

    if (isValid) {
      logger.info(`[validateModel] Access granted for ${userId} - ${endpoint}/${model}`);
      return next();
    }

    // Access denied
    logger.warn(`[validateModel] Access denied for ${userId} - ${endpoint}/${model}`);

    const { ILLEGAL_MODEL_REQ_SCORE: score = 1 } = process.env ?? {};
    const type = ViolationTypes.ILLEGAL_MODEL_REQUEST;
    const errorMessage = { type, model, endpoint };

    await logViolation(req, res, type, errorMessage, score);
    return handleError(res, { text: 'Illegal model request' });

  } catch (error) {
    logger.error(`[validateModel] Validation error for ${userId}:`, error);
    return handleError(res, { text: 'Model validation failed' });
  }
};

module.exports = validateModel;
