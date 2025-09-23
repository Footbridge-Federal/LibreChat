const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { createRole, getRoleByName, updateRoleByName } = require('~/models/Role');
const { RoleManager } = require('librechat-data-provider');

/**
 * Keycloak integration service for LibreChat
 * Handles authentication token processing and role synchronization only
 * Admin management should be done directly in Keycloak (separate container)
 */
class KeycloakService {
  constructor() {
    this.adminUrl = process.env.KEYCLOAK_ADMIN_URL;
    this.adminRealm = process.env.KEYCLOAK_ADMIN_REALM || 'master';
    this.adminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'admin-cli';
    this.adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME;
    this.adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
    this.targetRealm = process.env.KEYCLOAK_TARGET_REALM;
    this.roleMappingPrefix = process.env.KEYCLOAK_ROLE_MAPPING_PREFIX || 'librechat-';

    this.adminToken = null;
    this.tokenExpiry = null;

    // Validate required configuration
    this.validateConfiguration();
  }

  /**
   * Validate that required Keycloak configuration is present
   */
  validateConfiguration() {
    const required = [
      'KEYCLOAK_ADMIN_URL',
      'KEYCLOAK_ADMIN_USERNAME',
      'KEYCLOAK_ADMIN_PASSWORD',
      'KEYCLOAK_TARGET_REALM'
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      logger.warn(`Keycloak integration disabled. Missing env vars: ${missing.join(', ')}`);
      this.enabled = false;
      return;
    }

    this.enabled = true;
    logger.info('Keycloak integration enabled');
  }

  /**
   * Get admin access token for Keycloak Admin API
   */
  async getAdminToken() {
    if (!this.enabled) {
      throw new Error('Keycloak integration not configured');
    }

    // Return cached token if still valid
    if (this.adminToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.adminToken;
    }

    try {
      const response = await axios.post(
        `${this.adminUrl}/realms/${this.adminRealm}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: this.adminClientId,
          username: this.adminUsername,
          password: this.adminPassword,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );

      this.adminToken = response.data.access_token;
      // Set expiry with 30 second buffer
      this.tokenExpiry = Date.now() + (response.data.expires_in - 30) * 1000;

      logger.debug('Keycloak admin token refreshed');
      return this.adminToken;
    } catch (error) {
      logger.error(`Failed to get Keycloak admin token: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all roles from Keycloak realm
   */
  async getKeycloakRoles() {
    if (!this.enabled) return [];

    try {
      const token = await this.getAdminToken();

      const response = await axios.get(
        `${this.adminUrl}/admin/realms/${this.targetRealm}/roles`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
        }
      );

      return response.data.filter(role =>
        role.name.startsWith(this.roleMappingPrefix) && !role.composite
      );
    } catch (error) {
      logger.error(`Failed to fetch Keycloak roles: ${error.message}`);
      return [];
    }
  }


  /**
   * Synchronize roles from Keycloak to LibreChat
   */
  async syncRoles() {
    if (!this.enabled) {
      logger.debug('Keycloak role sync skipped - not enabled');
      return { synced: 0, errors: 0 };
    }

    logger.info('Starting Keycloak role synchronization...');
    let synced = 0;
    let errors = 0;

    try {
      const keycloakRoles = await this.getKeycloakRoles();

      for (const kcRole of keycloakRoles) {
        try {
          const librechatRoleName = kcRole.name.replace(this.roleMappingPrefix, '');

          // Check if role already exists in LibreChat
          let existingRole = await getRoleByName(librechatRoleName);

          const roleData = {
            name: librechatRoleName,
            displayName: kcRole.description || librechatRoleName,
            description: `Synced from Keycloak: ${kcRole.description || 'No description'}`,
            source: 'keycloak',
            externalId: kcRole.id,
            isActive: true,
            // Default permissions - can be customized per role
            permissions: this.getDefaultPermissionsForRole(librechatRoleName),
            allowedModels: this.getDefaultModelsForRole(librechatRoleName),
            allowedEndpoints: this.getDefaultEndpointsForRole(librechatRoleName),
          };

          if (existingRole) {
            // Update existing role
            await updateRoleByName(librechatRoleName, {
              displayName: roleData.displayName,
              description: roleData.description,
              externalId: roleData.externalId,
              updatedAt: new Date(),
            });
            logger.debug(`Updated role: ${librechatRoleName}`);
          } else {
            // Create new role
            await createRole(roleData);
            logger.debug(`Created role: ${librechatRoleName}`);
          }

          // Register with RoleManager
          RoleManager.registerRole(librechatRoleName);
          synced++;
        } catch (error) {
          logger.error(`Failed to sync role ${kcRole.name}: ${error.message}`);
          errors++;
        }
      }

      logger.info(`Keycloak role sync completed: ${synced} synced, ${errors} errors`);
      return { synced, errors };
    } catch (error) {
      logger.error(`Keycloak role sync failed: ${error.message}`);
      return { synced, errors: errors + 1 };
    }
  }

  /**
   * Get default permissions for a role based on naming convention
   */
  getDefaultPermissionsForRole(roleName) {
    const roleUpper = roleName.toUpperCase();

    // Role-based permission mapping
    if (roleUpper.includes('ADMIN')) {
      return {
        WEB_SEARCH: { USE: true },
        RUN_CODE: { USE: true },
        AGENTS: { USE: true, CREATE: true, SHARED_GLOBAL: true },
        PROMPTS: { USE: true, CREATE: true, SHARED_GLOBAL: true },
        MEMORIES: { USE: true, CREATE: true, UPDATE: true, READ: true },
        BOOKMARKS: { USE: true },
        MULTI_CONVO: { USE: true },
        TEMPORARY_CHAT: { USE: true },
        PEOPLE_PICKER: { VIEW_USERS: true, VIEW_GROUPS: true, VIEW_ROLES: true },
        MARKETPLACE: { USE: true },
        FILE_SEARCH: { USE: true },
        FILE_CITATIONS: { USE: true },
      };
    }

    if (roleUpper.includes('PREMIUM')) {
      return {
        WEB_SEARCH: { USE: true },
        RUN_CODE: { USE: true },
        AGENTS: { USE: true, CREATE: true },
        PROMPTS: { USE: true, CREATE: true },
        MEMORIES: { USE: true, CREATE: true },
        BOOKMARKS: { USE: true },
        MULTI_CONVO: { USE: true },
        TEMPORARY_CHAT: { USE: true },
        FILE_SEARCH: { USE: true },
      };
    }

    if (roleUpper.includes('DEVELOPER')) {
      return {
        WEB_SEARCH: { USE: true },
        RUN_CODE: { USE: true },
        AGENTS: { USE: true, CREATE: true },
        PROMPTS: { USE: true, CREATE: true },
        MEMORIES: { USE: true },
        FILE_SEARCH: { USE: true },
      };
    }

    // Default basic permissions
    return {
      BOOKMARKS: { USE: true },
      MULTI_CONVO: { USE: true },
      TEMPORARY_CHAT: { USE: true },
    };
  }

  /**
   * Get default allowed models for a role
   */
  getDefaultModelsForRole(roleName) {
    const roleUpper = roleName.toUpperCase();

    if (roleUpper.includes('ADMIN')) {
      return []; // Empty array means all models allowed
    }

    if (roleUpper.includes('PREMIUM')) {
      return [
        'gpt-5',
        'gpt-5-mini',
        'us.anthropic.claude-opus-4-1-20250805-v1:0',
        'llama3.2:latest',
        'llama3.1:8b',
        'qwen2.5:latest'
      ];
    }

    if (roleUpper.includes('DEVELOPER')) {
      return [
        'gpt-5',
        'us.anthropic.claude-opus-4-1-20250805-v1:0',
        'codellama:latest',
        'llama3.2:latest'
      ];
    }

    // Basic users get limited models
    return [
      'gpt-5-nano',
      'llama3.2:latest'
    ];
  }

  /**
   * Get default allowed endpoints for a role
   */
  getDefaultEndpointsForRole(roleName) {
    const roleUpper = roleName.toUpperCase();

    if (roleUpper.includes('ADMIN')) {
      return []; // Empty array means all endpoints allowed
    }

    if (roleUpper.includes('PREMIUM')) {
      return ['openAI', 'bedrock', 'Ollama'];
    }

    if (roleUpper.includes('DEVELOPER')) {
      return ['openAI', 'bedrock', 'Ollama'];
    }

    // Basic users get only local models
    return ['Ollama'];
  }

  /**
   * Extract and map roles from Keycloak token
   */
  mapKeycloakRoles(tokenRoles) {
    if (!Array.isArray(tokenRoles)) {
      return ['USER']; // Default fallback
    }

    const mappedRoles = tokenRoles
      .filter(role => role.startsWith(this.roleMappingPrefix))
      .map(role => role.replace(this.roleMappingPrefix, ''));

    // Always include USER role if no other roles found
    if (mappedRoles.length === 0) {
      mappedRoles.push('USER');
    }

    // Add ADMIN role if user has admin-like Keycloak role
    const hasAdminRole = tokenRoles.some(role =>
      role.includes('admin') || role.includes('administrator')
    );

    if (hasAdminRole && !mappedRoles.includes('ADMIN')) {
      mappedRoles.push('ADMIN');
    }

    return mappedRoles;
  }

}

// Export singleton instance
module.exports = new KeycloakService();