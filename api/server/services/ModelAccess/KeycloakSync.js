const { logger } = require('~/config');
const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

class KeycloakSync {
  constructor() {
    this.kcAdminClient = new KcAdminClient({
      baseUrl: process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080',
      realmName: process.env.KEYCLOAK_ADMIN_REALM || 'master', // Admin API uses master realm
    });

    this.initialized = false;
    this.syncInterval = null;
  }

  /**
   * Initialize Keycloak admin client
   */
  async initialize() {
    try {
      logger.info(`[KeycloakSync] Attempting connection to: ${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}`);
      logger.info(`[KeycloakSync] Admin realm: ${process.env.KEYCLOAK_ADMIN_REALM || 'master'}`);
      logger.info(`[KeycloakSync] Target realm: ${process.env.KEYCLOAK_TARGET_REALM || 'AirwallChat'}`);
      logger.info(`[KeycloakSync] Admin user: ${process.env.KEYCLOAK_ADMIN_USERNAME || process.env.KEYCLOAK_ADMIN_USER || 'admin'}`);

      await this.kcAdminClient.auth({
        username: process.env.KEYCLOAK_ADMIN_USERNAME || process.env.KEYCLOAK_ADMIN_USER || 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin123',
        grantType: 'password',
        clientId: 'admin-cli',
      });

      this.initialized = true;
      logger.info('[KeycloakSync] Initialized successfully');

      // Initialize the simplified ModelAccess table
      logger.info('[KeycloakSync] About to initialize ModelAccess table...');
      await this.initializeModelAccess();
      logger.info('[KeycloakSync] ModelAccess initialization completed');

      logger.info('[KeycloakSync] Token-based model access ready');

    } catch (error) {
      logger.error('[KeycloakSync] Failed to initialize:', error);

      // SECURITY: If Keycloak is enabled, model access control is MANDATORY
      if (process.env.KEYCLOAK_ENABLED === 'true' || process.env.MODEL_ACCESS_ENABLED === 'true') {
        logger.error('[SECURITY] Keycloak model access control is required but initialization failed');
        logger.error('[SECURITY] Server startup ABORTED to prevent unauthorized model access');
        throw new Error('SECURITY: Keycloak model access control initialization failed - server startup aborted');
      }

      // Only allow soft failure if Keycloak is explicitly disabled
      logger.warn('[KeycloakSync] LibreChat starting without model access control (Keycloak disabled)');
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
      logger.info('[KeycloakSync] Fetching groups from Keycloak...');

      // Set the target realm for group operations
      this.kcAdminClient.setConfig({
        realmName: process.env.KEYCLOAK_TARGET_REALM || 'AirwallChat',
      });

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
      // Find the group (get all groups and filter by path)
      const groups = await this.kcAdminClient.groups.find();
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
        {
          name: group.name,
          attributes: updatedAttributes
        }
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

  /**
   * Initialize the ModelAccess table from YAML configuration
   * Uses YAMLConfigLoader to sync config/model-access.yaml to MongoDB
   */
  async initializeModelAccess() {
    try {
      const { ModelAccess } = require('~/db/models');
      const { yamlConfigLoader } = require('~/server/services/Config/YAMLConfigLoader');

      // Check if config file exists
      const exists = yamlConfigLoader.checkConfigExists();

      if (!exists.groups) {
        logger.warn('[KeycloakSync] groups.yaml not found, using legacy hardcoded rules');
        return this._initializeLegacyModelAccess();
      }

      // Sync from YAML config (groups.yaml now contains model access)
      logger.info('[KeycloakSync] Syncing ModelAccess from config/groups.yaml');

      const result = await yamlConfigLoader.syncModelAccessToDatabase(false);

      logger.info(`[KeycloakSync] ModelAccess already initialized with ${result.synced} rules`);

      if (result.errors > 0) {
        logger.warn('[KeycloakSync] Some model access rules failed to sync. Check logs for details.');
      }

    } catch (error) {
      logger.error('[KeycloakSync] Failed to initialize ModelAccess table:', error);
      logger.warn('[KeycloakSync] Falling back to legacy initialization');
      return this._initializeLegacyModelAccess();
    }
  }

  /**
   * Legacy initialization method (fallback)
   * @private
   */
  async _initializeLegacyModelAccess() {
    try {
      const { ModelAccess } = require('~/db/models');

      // Check if already initialized
      const existingRules = await ModelAccess.countDocuments({});
      if (existingRules > 0) {
        logger.info(`[KeycloakSync] ModelAccess already initialized with ${existingRules} rules`);
        return;
      }

      logger.info('[KeycloakSync] Initializing ModelAccess table with legacy hardcoded configuration');

      // Create access rules for /org-airwall group
      const rules = [
        {
          type: 'group',
          subject: '/org-airwall',
          provider: 'openai',
          model: 'gpt-4o-mini',
          maxTokens: 8000,
          maxOutputTokens: 4000,
          temperatureMax: 1.0,
          requestsPerMinute: 60,
          tokensPerDay: 33333,
          monthlyTokenLimit: 1000000,
          keySource: 'preconfigured',
          keyRef: 'group_org_airwall',
          active: true,
          configSource: 'git',
          createdBy: 'keycloak_sync',
          description: 'OpenAI GPT-4o-mini for Airwall organization',
          ragEnabled: true,
          ragStorageQuotaMB: 500,
          ragMaxFileSizeMB: 25,
          ragEmbeddingLimitPerMonth: 5000,
          ragAllowedFileTypes: ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx'],
          ragVectorSearchEnabled: true,
          ragRetentionDays: 180,
          ragMaxDocuments: 10000
        },
        {
          type: 'group',
          subject: '/org-airwall',
          provider: 'anthropic',
          model: 'claude-3.5',
          maxTokens: 8000,
          maxOutputTokens: 4000,
          temperatureMax: 1.0,
          requestsPerMinute: 60,
          tokensPerDay: 33333,
          monthlyTokenLimit: 1000000,
          keySource: 'preconfigured',
          keyRef: 'group_org_airwall',
          active: true,
          configSource: 'git',
          createdBy: 'keycloak_sync',
          description: 'Anthropic Claude 3.5 for Airwall organization',
          ragEnabled: true,
          ragStorageQuotaMB: 500,
          ragMaxFileSizeMB: 25,
          ragEmbeddingLimitPerMonth: 5000,
          ragAllowedFileTypes: ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx'],
          ragVectorSearchEnabled: true,
          ragRetentionDays: 180,
          ragMaxDocuments: 10000
        }
      ];

      await ModelAccess.insertMany(rules);
      logger.info(`[KeycloakSync] Initialized ModelAccess table with ${rules.length} legacy access rules`);

      // Log what was created
      for (const rule of rules) {
        logger.info(`[KeycloakSync]   ${rule.subject} -> ${rule.provider}/${rule.model}`);
      }

    } catch (error) {
      logger.error('[KeycloakSync] Failed to initialize legacy ModelAccess:', error);
      // Don't throw - this is not critical for startup
    }
  }
}

// Export singleton instance
const keycloakSync = new KeycloakSync();

module.exports = { KeycloakSync, keycloakSync };