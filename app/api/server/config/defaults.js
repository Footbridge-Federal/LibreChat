/**
 * Centralized Default Configuration
 *
 * This file contains all default values for environment variables.
 * When deploying with Terraform or other CI/CD tools, you only need to override
 * the values that differ from these defaults in your .env file.
 */

/**
 * Server Configuration
 */
const serverDefaults = {
  PORT: 3080,
  HOST: 'localhost',
  TRUST_PROXY: 1,
  NODE_ENV: 'production',
  HTTPS: false,
  NODE_TLS_REJECT_UNAUTHORIZED: 1, // 1 for production, 0 for dev with self-signed certs
  DISABLE_COMPRESSION: false,
  APP_TITLE: 'Airwall.Chat',
  HELP_AND_FAQ_URL: 'https://airwall.ai',
};

/**
 * User System Configuration
 */
const userSystemDefaults = {
  BAN_VIOLATIONS: false,
  LIMIT_CONCURRENT_MESSAGES: false,
  ALLOW_SOCIAL_LOGIN: true,
  ALLOW_EMAIL_LOGIN: true,
  ALLOW_REGISTRATION: false,
};

/**
 * Search Configuration
 */
const searchDefaults = {
  SEARCH: false,
};

/**
 * Keycloak / OpenID Configuration
 */
const keycloakDefaults = {
  // Token Settings
  REFRESH_TOKEN_EXPIRY: 8000,

  // OpenID Connect Settings
  OPENID_SCOPE: 'openid',
  OPENID_CALLBACK_URL: '/oauth/openid/callback',
  OPENID_BUTTON_LABEL: 'Continue with Keycloak',
  OPENID_AUTO_REDIRECT: true,

  // Role Integration
  OPENID_REQUIRED_ROLE_PARAMETER_PATH: 'realm_access.roles',
  OPENID_REQUIRED_ROLE_TOKEN_KIND: 'access',

  // Role Synchronization
  KEYCLOAK_ROLE_SYNC_ENABLED: true,
  KEYCLOAK_ROLE_SYNC_INTERVAL_MINUTES: 60,
  KEYCLOAK_ROLE_MAPPING_PREFIX: 'airwall-',

  // Security Settings
  KEYCLOAK_REQUIRE_EMAIL_VERIFIED: false,
  KEYCLOAK_AUTO_CREATE_USERS: true,
  KEYCLOAK_AUTO_SYNC_ROLES: true,

  // Retry Settings (for microservice resilience)
  OPENID_MAX_RETRIES: 300,
  OPENID_RETRY_INTERVAL: 3000,

  // SSO Logout Settings
  OPENID_USE_END_SESSION_ENDPOINT: true,
  OPENID_REUSE_TOKENS: true,

  // Frontend Settings
  KEYCLOAK_ENABLED: true,

  // Keycloak Admin Configuration
  KEYCLOAK_ADMIN_REALM: 'master',
  KEYCLOAK_ADMIN_CLIENT_ID: 'admin-cli',
  KEYCLOAK_ADMIN_USERNAME: 'admin',

  // Keycloak Realm Configuration
  KEYCLOAK_TARGET_REALM: 'AirwallChat',
  REACT_APP_KEYCLOAK_REALM: 'AirwallChat',
};

/**
 * Model Access Control
 */
const modelAccessDefaults = {
  MODEL_ACCESS_ENABLED: true,
};

/**
 * Helper function to get environment variable with default
 * Handles boolean conversion properly
 */
function getEnv(key, defaultValue) {
  const value = process.env[key];

  if (value === undefined || value === '') {
    return defaultValue;
  }

  // Handle boolean defaults
  if (typeof defaultValue === 'boolean') {
    return value === 'true' || value === '1';
  }

  // Handle number defaults
  if (typeof defaultValue === 'number') {
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  // Return string as-is
  return value;
}

/**
 * Get all configuration with environment overrides
 */
function getConfig() {
  // Get APP_FQDN first as other values depend on it
  const APP_FQDN = process.env.APP_FQDN;

  const config = {
    // Server Configuration
    PORT: getEnv('PORT', serverDefaults.PORT),
    HOST: getEnv('HOST', serverDefaults.HOST),
    TRUST_PROXY: getEnv('TRUST_PROXY', serverDefaults.TRUST_PROXY),
    NODE_ENV: getEnv('NODE_ENV', serverDefaults.NODE_ENV),
    HTTPS: getEnv('HTTPS', serverDefaults.HTTPS),
    NODE_TLS_REJECT_UNAUTHORIZED: getEnv('NODE_TLS_REJECT_UNAUTHORIZED', serverDefaults.NODE_TLS_REJECT_UNAUTHORIZED),
    DISABLE_COMPRESSION: getEnv('DISABLE_COMPRESSION', serverDefaults.DISABLE_COMPRESSION),
    APP_TITLE: getEnv('APP_TITLE', serverDefaults.APP_TITLE),
    HELP_AND_FAQ_URL: getEnv('HELP_AND_FAQ_URL', serverDefaults.HELP_AND_FAQ_URL),

    // Domain Configuration (derived from APP_FQDN if not explicitly set)
    APP_FQDN: APP_FQDN,
    DOMAIN_CLIENT: process.env.DOMAIN_CLIENT || APP_FQDN,
    DOMAIN_SERVER: process.env.DOMAIN_SERVER || APP_FQDN,

    // User System
    BAN_VIOLATIONS: getEnv('BAN_VIOLATIONS', userSystemDefaults.BAN_VIOLATIONS),
    LIMIT_CONCURRENT_MESSAGES: getEnv('LIMIT_CONCURRENT_MESSAGES', userSystemDefaults.LIMIT_CONCURRENT_MESSAGES),
    ALLOW_SOCIAL_LOGIN: getEnv('ALLOW_SOCIAL_LOGIN', userSystemDefaults.ALLOW_SOCIAL_LOGIN),
    ALLOW_EMAIL_LOGIN: getEnv('ALLOW_EMAIL_LOGIN', userSystemDefaults.ALLOW_EMAIL_LOGIN),
    ALLOW_REGISTRATION: getEnv('ALLOW_REGISTRATION', userSystemDefaults.ALLOW_REGISTRATION),

    // Search
    SEARCH: getEnv('SEARCH', searchDefaults.SEARCH),

    // Keycloak / OpenID (URLs derived from APP_FQDN if not explicitly set)
    KEYCLOAK_SERVER_URL: process.env.KEYCLOAK_SERVER_URL || (APP_FQDN ? `${APP_FQDN}/keycloak` : undefined),
    REACT_APP_KEYCLOAK_URL: process.env.REACT_APP_KEYCLOAK_URL || (APP_FQDN ? `${APP_FQDN}/keycloak` : undefined),
    KEYCLOAK_ADMIN_URL: process.env.KEYCLOAK_ADMIN_URL || (APP_FQDN ? `${APP_FQDN}/keycloak` : undefined),
    OPENID_ISSUER: process.env.OPENID_ISSUER || (APP_FQDN ? `${APP_FQDN}/keycloak/realms/${getEnv('KEYCLOAK_TARGET_REALM', keycloakDefaults.KEYCLOAK_TARGET_REALM)}` : undefined),
    REFRESH_TOKEN_EXPIRY: getEnv('REFRESH_TOKEN_EXPIRY', keycloakDefaults.REFRESH_TOKEN_EXPIRY),
    OPENID_SCOPE: getEnv('OPENID_SCOPE', keycloakDefaults.OPENID_SCOPE),
    OPENID_CALLBACK_URL: getEnv('OPENID_CALLBACK_URL', keycloakDefaults.OPENID_CALLBACK_URL),
    OPENID_BUTTON_LABEL: getEnv('OPENID_BUTTON_LABEL', keycloakDefaults.OPENID_BUTTON_LABEL),
    OPENID_AUTO_REDIRECT: getEnv('OPENID_AUTO_REDIRECT', keycloakDefaults.OPENID_AUTO_REDIRECT),
    OPENID_REQUIRED_ROLE_PARAMETER_PATH: getEnv('OPENID_REQUIRED_ROLE_PARAMETER_PATH', keycloakDefaults.OPENID_REQUIRED_ROLE_PARAMETER_PATH),
    OPENID_REQUIRED_ROLE_TOKEN_KIND: getEnv('OPENID_REQUIRED_ROLE_TOKEN_KIND', keycloakDefaults.OPENID_REQUIRED_ROLE_TOKEN_KIND),
    KEYCLOAK_ROLE_SYNC_ENABLED: getEnv('KEYCLOAK_ROLE_SYNC_ENABLED', keycloakDefaults.KEYCLOAK_ROLE_SYNC_ENABLED),
    KEYCLOAK_ROLE_SYNC_INTERVAL_MINUTES: getEnv('KEYCLOAK_ROLE_SYNC_INTERVAL_MINUTES', keycloakDefaults.KEYCLOAK_ROLE_SYNC_INTERVAL_MINUTES),
    KEYCLOAK_ROLE_MAPPING_PREFIX: getEnv('KEYCLOAK_ROLE_MAPPING_PREFIX', keycloakDefaults.KEYCLOAK_ROLE_MAPPING_PREFIX),
    KEYCLOAK_REQUIRE_EMAIL_VERIFIED: getEnv('KEYCLOAK_REQUIRE_EMAIL_VERIFIED', keycloakDefaults.KEYCLOAK_REQUIRE_EMAIL_VERIFIED),
    KEYCLOAK_AUTO_CREATE_USERS: getEnv('KEYCLOAK_AUTO_CREATE_USERS', keycloakDefaults.KEYCLOAK_AUTO_CREATE_USERS),
    KEYCLOAK_AUTO_SYNC_ROLES: getEnv('KEYCLOAK_AUTO_SYNC_ROLES', keycloakDefaults.KEYCLOAK_AUTO_SYNC_ROLES),
    OPENID_MAX_RETRIES: getEnv('OPENID_MAX_RETRIES', keycloakDefaults.OPENID_MAX_RETRIES),
    OPENID_RETRY_INTERVAL: getEnv('OPENID_RETRY_INTERVAL', keycloakDefaults.OPENID_RETRY_INTERVAL),
    OPENID_USE_END_SESSION_ENDPOINT: getEnv('OPENID_USE_END_SESSION_ENDPOINT', keycloakDefaults.OPENID_USE_END_SESSION_ENDPOINT),
    OPENID_REUSE_TOKENS: getEnv('OPENID_REUSE_TOKENS', keycloakDefaults.OPENID_REUSE_TOKENS),
    KEYCLOAK_ENABLED: getEnv('KEYCLOAK_ENABLED', keycloakDefaults.KEYCLOAK_ENABLED),
    KEYCLOAK_ADMIN_REALM: getEnv('KEYCLOAK_ADMIN_REALM', keycloakDefaults.KEYCLOAK_ADMIN_REALM),
    KEYCLOAK_ADMIN_CLIENT_ID: getEnv('KEYCLOAK_ADMIN_CLIENT_ID', keycloakDefaults.KEYCLOAK_ADMIN_CLIENT_ID),
    KEYCLOAK_ADMIN_USERNAME: getEnv('KEYCLOAK_ADMIN_USERNAME', keycloakDefaults.KEYCLOAK_ADMIN_USERNAME),
    KEYCLOAK_TARGET_REALM: getEnv('KEYCLOAK_TARGET_REALM', keycloakDefaults.KEYCLOAK_TARGET_REALM),
    REACT_APP_KEYCLOAK_REALM: getEnv('REACT_APP_KEYCLOAK_REALM', keycloakDefaults.REACT_APP_KEYCLOAK_REALM),

    // Model Access Control
    MODEL_ACCESS_ENABLED: getEnv('MODEL_ACCESS_ENABLED', modelAccessDefaults.MODEL_ACCESS_ENABLED),
  };

  return config;
}

module.exports = {
  serverDefaults,
  userSystemDefaults,
  searchDefaults,
  keycloakDefaults,
  modelAccessDefaults,
  getEnv,
  getConfig,
};
