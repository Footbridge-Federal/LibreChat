const { logger } = require('~/config');
const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

class KeycloakSync {
  constructor() {
    this.kcAdminClient = new KcAdminClient({
      baseUrl: process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080',
      realmName: process.env.KEYCLOAK_REALM || 'AirwallChat',
    });

    this.initialized = false;
    this.syncInterval = null;
  }

  /**
   * Initialize Keycloak admin client
   */
  async initialize() {
    try {
      await this.kcAdminClient.auth({
        username: process.env.KEYCLOAK_ADMIN_USER || 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin123',
        grantType: 'password',
        clientId: 'admin-cli',
      });

      this.initialized = true;
      logger.info('[KeycloakSync] Initialized successfully');

      logger.info('[KeycloakSync] Token-based model access ready');

    } catch (error) {
      logger.error('[KeycloakSync] Failed to initialize:', error);
      // Don't throw - this allows LibreChat to start even if Keycloak is not ready
      logger.warn('[KeycloakSync] LibreChat will start without model access control');
    }
  }

  /**
   * Get groups and their attributes from Keycloak (read-only, no DB sync)
   */
  async getGroups() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug('[KeycloakSync] Fetching groups from Keycloak...');

      // Get all groups from Keycloak
      const groups = await this.kcAdminClient.groups.find();
      logger.debug(`[KeycloakSync] Found ${groups.length} groups in Keycloak`);

      return groups;

    } catch (error) {
      logger.error('[KeycloakSync] Failed to fetch groups:', error);
      throw error;
    }
  }

  /**
   * Configure group attributes for model access
   * @param {string} groupPath - Group path (e.g., '/org/airwall')
   * @param {Object} attributes - Model access attributes
   */
  async setGroupModelAccess(groupPath, attributes) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Find the group
      const groups = await this.kcAdminClient.groups.find({ search: groupPath });
      const group = groups.find(g => g.path === groupPath);

      if (!group) {
        throw new Error(`Group not found: ${groupPath}`);
      }

      // Update group attributes
      const updatedAttributes = {
        ...(group.attributes || {}),
        models_allow: attributes.models_allow ? [attributes.models_allow.join(',')] : undefined,
        models_deny: attributes.models_deny ? [attributes.models_deny.join(',')] : undefined,
        max_tokens_per_request: attributes.max_tokens_per_request ? [attributes.max_tokens_per_request.toString()] : undefined,
        monthly_token_limit: attributes.monthly_token_limit ? [attributes.monthly_token_limit.toString()] : undefined,
        requests_per_minute: attributes.requests_per_minute ? [attributes.requests_per_minute.toString()] : undefined
      };

      // Remove undefined values
      Object.keys(updatedAttributes).forEach(key => {
        if (updatedAttributes[key] === undefined) {
          delete updatedAttributes[key];
        }
      });

      await this.kcAdminClient.groups.update(
        { id: group.id },
        { attributes: updatedAttributes }
      );

      logger.info(`[KeycloakSync] Updated model access for group ${groupPath}`);

      // Attributes updated - permissions will be picked up from next token refresh

      return { success: true };

    } catch (error) {
      logger.error(`[KeycloakSync] Error setting group model access:`, error);
      throw error;
    }
  }

  /**
   * Create organization groups with default model access
   * @param {string} orgName - Organization name (e.g., 'airwall')
   * @param {Object} modelAccess - Default model access configuration
   */
  async createOrgGroup(orgName, modelAccess = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const groupName = `org-${orgName}`;
      const groupPath = `/org/${orgName}`;

      // Check if group already exists
      const existingGroups = await this.kcAdminClient.groups.find({ search: groupName });
      if (existingGroups.some(g => g.path === groupPath)) {
        throw new Error(`Organization group already exists: ${groupPath}`);
      }

      // Create the group
      const group = await this.kcAdminClient.groups.create({
        name: groupName,
        path: groupPath,
        attributes: {
          models_allow: modelAccess.models_allow ? [modelAccess.models_allow.join(',')] : ['openai/gpt-4o-mini'],
          max_tokens_per_request: [modelAccess.max_tokens_per_request?.toString() || '8000'],
          monthly_token_limit: [modelAccess.monthly_token_limit?.toString() || '1000000'],
          requests_per_minute: [modelAccess.requests_per_minute?.toString() || '60']
        }
      });

      logger.info(`[KeycloakSync] Created organization group: ${groupPath}`);

      // Group created - permissions will be available in user tokens after next login

      return {
        success: true,
        group_id: group.id,
        group_path: groupPath
      };

    } catch (error) {
      logger.error(`[KeycloakSync] Error creating org group:`, error);
      throw error;
    }
  }

  /**
   * Add user to organization group
   * @param {string} userId - Keycloak user ID
   * @param {string} orgName - Organization name
   */
  async addUserToOrg(userId, orgName) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const groupPath = `/org/${orgName}`;

      // Find the org group
      const groups = await this.kcAdminClient.groups.find({ search: `org-${orgName}` });
      const group = groups.find(g => g.path === groupPath);

      if (!group) {
        throw new Error(`Organization group not found: ${groupPath}`);
      }

      // Add user to group
      await this.kcAdminClient.users.addToGroup({
        id: userId,
        groupId: group.id
      });

      logger.info(`[KeycloakSync] Added user ${userId} to org ${orgName}`);

      return { success: true };

    } catch (error) {
      logger.error(`[KeycloakSync] Error adding user to org:`, error);
      throw error;
    }
  }

  /**
   * Validate token contains required group attributes for model access
   */
  validateTokenClaims(tokenClaims) {
    if (!tokenClaims.groups || !Array.isArray(tokenClaims.groups)) {
      logger.warn('[KeycloakSync] Token missing groups claim');
      return false;
    }

    if (!tokenClaims.group_attributes) {
      logger.warn('[KeycloakSync] Token missing group_attributes claim');
      return false;
    }

    return true;
  }

  /**
   * Get user groups and attributes from token claims (for testing/admin purposes)
   * @param {Object} tokenClaims - JWT token claims
   */
  getUserGroupAttributes(tokenClaims) {
    if (!this.validateTokenClaims(tokenClaims)) {
      return null;
    }

    return {
      groups: tokenClaims.groups || [],
      group_attributes: tokenClaims.group_attributes || {}
    };
  }
}

// Export singleton instance
const keycloakSync = new KeycloakSync();

module.exports = { KeycloakSync, keycloakSync };