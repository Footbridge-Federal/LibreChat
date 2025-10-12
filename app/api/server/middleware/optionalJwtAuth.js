const passport = require('passport');

// Keycloak JWT optional authentication middleware
const optionalJwtAuth = (req, res, next) => {
  const callback = (err, user) => {
    if (err) {
      return next(err);
    }
    if (user) {
      req.user = user;
    }
    next();
  };
  passport.authenticate('openidJwt', { session: false }, callback)(req, res, next);
};

module.exports = optionalJwtAuth;
