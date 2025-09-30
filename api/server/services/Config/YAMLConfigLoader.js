const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { logger } = require('~/config');
const { ModelAccess } = require('~/db/models');

/**
 * YAMLConfigLoader - Hierarchical YAML Format
 *
 * Loads and syncs YAML configuration files to database:
 * - model-access.yaml (hierarchical V2 format) -> MongoDB ModelAccess collection
 * - groups.yaml -> Keycloak (via KeycloakSync service)
 *
 * Hierarchical format groups models under providers:
 *
 * organizations:
 *   /org-airwall:
 *     providers:
 *       openai:
 *         models:
 *           - gpt-4o-mini
 */
class YAMLConfigLoader {
  constructor(configDir = null) {
    this.configDir = configDir || process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
    this.groupsPath = path.join(this.configDir, 'groups.yaml');
  }

  /**
   * Load groups.yaml (hierarchical format) and convert to flat format for MongoDB
   * @returns {Object} Parsed configuration with flat access_rules array
   */
  loadModelAccessConfig() {
    try {
      logger.info(`[YAMLConfigLoader] Loading config from ${this.groupsPath}`);

      if (!fs.existsSync(this.groupsPath)) {
        logger.warn(`[YAMLConfigLoader] Config not found at ${this.groupsPath}`);
        return { access_rules: [] };
      }

      const content = fs.readFileSync(this.groupsPath, 'utf8');
      const config = yaml.load(content);

      if (!config.groups) {
        throw new Error('groups.yaml must have "groups" key');
      }

      // Convert hierarchical format to flat access_rules array
      const flatRules = this._convertToFlatRules(config);

      logger.info(`[YAMLConfigLoader] Loaded ${flatRules.length} rules from groups.yaml`);

      return {
        version: config.version,
        description: config.description,
        access_rules: flatRules
      };

    } catch (error) {
      logger.error('[YAMLConfigLoader] Error loading groups.yaml:', error);
      throw error;
    }
  }

  /**
   * Convert hierarchical format to flat rules for MongoDB
   * @private
   */
  _convertToFlatRules(config) {
    const rules = [];

    for (const [groupName, groupConfig] of Object.entries(config.groups)) {
      // Group-level settings
      const groupDefaults = {
        type: 'group',
        subject: `/${groupName}`,  // Automatically add slash prefix
        description: groupConfig.description,
        requestsPerMinute: groupConfig.requestsPerMinute,
        monthlyTokenLimit: groupConfig.monthlyTokenLimit,
        configSource: 'git',
        active: true
      };

      // Extract RAG config (per-group, not per-model)
      const ragConfig = this._extractRAGConfig(groupConfig.rag);

      // Iterate through providers
      for (const [providerName, providerConfig] of Object.entries(groupConfig.providers || {})) {
        const keySource = providerConfig.keySource || 'preconfigured';
        const keyRef = providerConfig.keyRef;
        const region = providerConfig.region; // For Bedrock

        // Iterate through models
        for (const modelConfig of providerConfig.models || []) {
          const modelName = typeof modelConfig === 'string' ? modelConfig : modelConfig.name;

          const rule = {
            ...groupDefaults,
            provider: providerName.toLowerCase(),
            model: modelName,
            displayName: typeof modelConfig === 'object' ? (modelConfig.displayName || modelName) : modelName,

            // API key config
            keySource,
            ...(keyRef && { keyRef }),
            ...(region && { region }),

            // RAG config (same for all models in group)
            ...ragConfig
          };

          rules.push(rule);
        }
      }
    }

    return rules;
  }

  /**
   * Extract RAG configuration from org config
   * @private
   */
  _extractRAGConfig(ragConfig) {
    if (!ragConfig) {
      return { ragEnabled: false };
    }

    return {
      ragEnabled: ragConfig.enabled !== undefined ? ragConfig.enabled : false,
      ragStorageQuotaMB: ragConfig.storageQuotaMB || 100,
      ragMaxFileSizeMB: ragConfig.maxFileSizeMB || 10,
      ragEmbeddingLimitPerMonth: ragConfig.embeddingLimitPerMonth || 1000,
      ragAllowedFileTypes: ragConfig.allowedFileTypes || ['pdf', 'txt'],
      ragVectorSearchEnabled: ragConfig.vectorSearchEnabled !== undefined ? ragConfig.vectorSearchEnabled : true,
      ragRetentionDays: ragConfig.retentionDays || 90,
      ragMaxDocuments: ragConfig.maxDocuments || 1000
    };
  }

  /**
   * Load and validate groups configuration from YAML
   * @returns {Object} Parsed configuration
   */
  loadGroupsConfig() {
    try {
      logger.info(`[YAMLConfigLoader] Loading groups config from ${this.groupsPath}`);

      if (!fs.existsSync(this.groupsPath)) {
        logger.warn(`[YAMLConfigLoader] Groups config not found at ${this.groupsPath}`);
        return null;
      }

      const fileContents = fs.readFileSync(this.groupsPath, 'utf8');
      const config = yaml.load(fileContents);

      if (!config || !config.groups || !Array.isArray(config.groups)) {
        throw new Error('Invalid groups.yaml format: missing or invalid groups array');
      }

      logger.info(`[YAMLConfigLoader] Loaded ${config.groups.length} groups from config`);

      // Validate each group
      for (let i = 0; i < config.groups.length; i++) {
        const group = config.groups[i];
        this._validateGroup(group, i);
      }

      return config;

    } catch (error) {
      logger.error('[YAMLConfigLoader] Error loading groups config:', error);
      throw error;
    }
  }

  /**
   * Sync model access rules from YAML to MongoDB
   * Uses upsert to update existing rules or create new ones
   *
   * @param {boolean} dryRun - If true, only log changes without applying
   * @returns {Promise<Object>} Sync results
   */
  async syncModelAccessToDatabase(dryRun = false) {
    try {
      const config = this.loadModelAccessConfig();

      if (!config || config.access_rules.length === 0) {
        logger.warn('[YAMLConfigLoader] No model access rules to sync');
        return { synced: 0, errors: 0 };
      }

      return this._syncRulesToDatabase(config.access_rules, dryRun);

    } catch (error) {
      logger.error('[YAMLConfigLoader] Error syncing model access to database:', error);
      throw error;
    }
  }

  /**
   * Sync rules to database (internal method)
   * @private
   */
  async _syncRulesToDatabase(rules, dryRun = false) {
    let synced = 0;
    let errors = 0;
    const results = [];

    for (const rule of rules) {
      try {
        const filter = {
          type: rule.type,
          subject: rule.subject,
          provider: rule.provider,
          model: rule.model,
          configSource: rule.configSource || 'git'
        };

        const update = {
          $set: {
            ...rule,
            configSource: rule.configSource || 'git',
            lastSyncedAt: new Date()
          }
        };

        if (dryRun) {
          logger.info(`[YAMLConfigLoader] [DRY RUN] Would upsert: ${rule.subject}/${rule.provider}/${rule.model}`);
          results.push({
            action: 'upsert',
            rule: filter,
            dryRun: true
          });
          synced++;
        } else {
          const result = await ModelAccess.updateOne(
            filter,
            update,
            { upsert: true }
          );

          const action = result.upsertedCount > 0 ? 'created' : 'updated';
          logger.info(`[YAMLConfigLoader] ${action}: ${rule.subject}/${rule.provider}/${rule.model}`);

          results.push({
            action,
            rule: filter,
            result
          });
          synced++;
        }

      } catch (error) {
        logger.error(`[YAMLConfigLoader] Error syncing rule ${rule.subject}/${rule.provider}/${rule.model}:`, error);
        errors++;
        results.push({
          action: 'error',
          rule,
          error: error.message
        });
      }
    }

    logger.info(`[YAMLConfigLoader] Model access sync complete: ${synced} synced, ${errors} errors`);

    return {
      synced,
      errors,
      results,
      dryRun
    };
  }

  /**
   * Clean up old git-sourced rules that are no longer in config
   * (Removes rules from DB that were deleted from YAML)
   *
   * @param {boolean} dryRun - If true, only log changes without applying
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupStaleGitRules(dryRun = false) {
    try {
      const config = this.loadModelAccessConfig();

      if (!config || config.access_rules.length === 0) {
        return { removed: 0 };
      }

      // Build set of current rules from YAML
      const currentRules = new Set();
      for (const rule of config.access_rules) {
        const key = `${rule.type}:${rule.subject}:${rule.provider}:${rule.model}`;
        currentRules.add(key);
      }

      // Find git-sourced rules in DB
      const dbRules = await ModelAccess.find({ configSource: 'git' });

      let removed = 0;
      const removedRules = [];

      for (const dbRule of dbRules) {
        const key = `${dbRule.type}:${dbRule.subject}:${dbRule.provider}:${dbRule.model}`;

        if (!currentRules.has(key)) {
          if (dryRun) {
            logger.info(`[YAMLConfigLoader] [DRY RUN] Would remove stale rule: ${key}`);
            removedRules.push(key);
            removed++;
          } else {
            await ModelAccess.deleteOne({ _id: dbRule._id });
            logger.info(`[YAMLConfigLoader] Removed stale rule: ${key}`);
            removedRules.push(key);
            removed++;
          }
        }
      }

      logger.info(`[YAMLConfigLoader] Cleanup complete: ${removed} stale rules removed`);

      return {
        removed,
        removedRules,
        dryRun
      };

    } catch (error) {
      logger.error('[YAMLConfigLoader] Error cleaning up stale rules:', error);
      throw error;
    }
  }

  /**
   * Validate a group
   * @private
   */
  _validateGroup(group, index) {
    const required = ['name', 'path'];

    for (const field of required) {
      if (!group[field]) {
        throw new Error(`Group ${index}: Missing required field '${field}'`);
      }
    }

    if (!group.path.startsWith('/')) {
      throw new Error(`Group ${index}: Path must start with '/' (got: ${group.path})`);
    }
  }

  /**
   * Get configuration file paths
   * @returns {Object} File paths
   */
  getConfigPaths() {
    return {
      configDir: this.configDir,
      groups: this.groupsPath
    };
  }

  /**
   * Check if configuration files exist
   * @returns {Object} Existence status
   */
  checkConfigExists() {
    return {
      groups: fs.existsSync(this.groupsPath)
    };
  }
}

// Export singleton
const yamlConfigLoader = new YAMLConfigLoader();

module.exports = { YAMLConfigLoader, yamlConfigLoader };