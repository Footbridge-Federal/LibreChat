const { getRoleByName } = require('~/models/Role');
const { logger } = require('@librechat/data-schemas');

/**
 * Filter available models based on user's roles
 * @param {Object} req - Express request object with authenticated user
 * @param {string[]} allModels - Array of all available model IDs
 * @returns {Promise<string[]>} Array of models the user can access
 */
async function filterModelsByRole(req, allModels) {
  try {
    if (!req.user) {
      return []; // No user, no models
    }

    const userRoles = req.user.roles || [req.user.role];
    let allowedModels = new Set();
    let hasUnrestrictedRole = false;

    // Check each role for model restrictions
    for (const roleName of userRoles) {
      try {
        const role = await getRoleByName(roleName);

        if (!role) {
          continue; // Skip invalid roles
        }

        // If role has no model restrictions, allow all models
        if (!role.allowedModels || role.allowedModels.length === 0) {
          hasUnrestrictedRole = true;
          break;
        }

        // Add this role's allowed models
        role.allowedModels.forEach(model => allowedModels.add(model));
      } catch (error) {
        logger.warn(`Failed to get role ${roleName}: ${error.message}`);
      }
    }

    // If any role has unrestricted access, return all models
    if (hasUnrestrictedRole) {
      return allModels;
    }

    // Return intersection of allowed models and available models
    const userModels = allModels.filter(model => allowedModels.has(model));

    logger.debug(`User ${req.user.email} with roles ${userRoles.join(', ')} can access models: ${userModels.join(', ')}`);

    return userModels;
  } catch (error) {
    logger.error(`Error filtering models by role: ${error.message}`);
    return allModels; // Fail open - return all models if there's an error
  }
}

/**
 * Filter available endpoints based on user's roles
 * @param {Object} req - Express request object with authenticated user
 * @param {string[]} allEndpoints - Array of all available endpoint names
 * @returns {Promise<string[]>} Array of endpoints the user can access
 */
async function filterEndpointsByRole(req, allEndpoints) {
  try {
    if (!req.user) {
      return []; // No user, no endpoints
    }

    const userRoles = req.user.roles || [req.user.role];
    let allowedEndpoints = new Set();
    let hasUnrestrictedRole = false;

    // Check each role for endpoint restrictions
    for (const roleName of userRoles) {
      try {
        const role = await getRoleByName(roleName);

        if (!role) {
          continue; // Skip invalid roles
        }

        // If role has no endpoint restrictions, allow all endpoints
        if (!role.allowedEndpoints || role.allowedEndpoints.length === 0) {
          hasUnrestrictedRole = true;
          break;
        }

        // Add this role's allowed endpoints
        role.allowedEndpoints.forEach(endpoint => allowedEndpoints.add(endpoint));
      } catch (error) {
        logger.warn(`Failed to get role ${roleName}: ${error.message}`);
      }
    }

    // If any role has unrestricted access, return all endpoints
    if (hasUnrestrictedRole) {
      return allEndpoints;
    }

    // Return intersection of allowed endpoints and available endpoints
    const userEndpoints = allEndpoints.filter(endpoint => allowedEndpoints.has(endpoint));

    logger.debug(`User ${req.user.email} with roles ${userRoles.join(', ')} can access endpoints: ${userEndpoints.join(', ')}`);

    return userEndpoints;
  } catch (error) {
    logger.error(`Error filtering endpoints by role: ${error.message}`);
    return allEndpoints; // Fail open - return all endpoints if there's an error
  }
}

/**
 * Middleware to check if user can access a specific model
 * @param {string} modelId - The model ID to check access for
 * @returns {Function} Express middleware function
 */
function requireModelAccess(modelId) {
  return async function(req, res, next) {
    try {
      const allModels = [modelId];
      const allowedModels = await filterModelsByRole(req, allModels);

      if (allowedModels.includes(modelId)) {
        next();
      } else {
        res.status(403).json({
          message: `Access denied to model: ${modelId}`,
        });
      }
    } catch (error) {
      logger.error(`Model access check failed: ${error.message}`);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
}

module.exports = {
  filterModelsByRole,
  filterEndpointsByRole,
  requireModelAccess,
};