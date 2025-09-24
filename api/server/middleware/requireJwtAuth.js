const passport = require('passport');

/**
 * Keycloak JWT authentication middleware
 */
const requireJwtAuth = (req, res, next) => {
  return passport.authenticate('openidJwt', { session: false })(req, res, next);
};

module.exports = requireJwtAuth;
