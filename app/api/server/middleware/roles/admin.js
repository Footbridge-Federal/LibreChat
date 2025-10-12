const { SystemRoles, RoleManager } = require('librechat-data-provider');

function checkAdmin(req, res, next) {
  try {
    // Check if user has admin role in either role or roles array
    const userRole = req.user.role;
    const userRoles = req.user.roles || [userRole];

    if (!userRoles.includes(SystemRoles.ADMIN)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
}

/**
 * Check if user has any of the required roles
 * @param {string|string[]} requiredRoles - Single role or array of roles
 * @returns {Function} Express middleware function
 */
function checkRoles(requiredRoles) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

  return function(req, res, next) {
    try {
      const userRole = req.user.role;
      const userRoles = req.user.roles || [userRole];

      // Check if user has any of the required roles
      const hasRequiredRole = roles.some(role => userRoles.includes(role));

      if (!hasRequiredRole) {
        return res.status(403).json({
          message: `Access denied. Required roles: ${roles.join(', ')}`
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };
}

/**
 * Validate that all provided roles exist
 * @param {string[]} roles - Array of role names to validate
 * @returns {boolean} True if all roles are valid
 */
function validateRoles(roles) {
  return roles.every(role => RoleManager.isValidRole(role));
}

module.exports = {
  checkAdmin,
  checkRoles,
  validateRoles
};
