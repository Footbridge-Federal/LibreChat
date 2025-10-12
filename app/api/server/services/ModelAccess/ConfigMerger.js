const { logger } = require('~/config');
const { ModelAccess } = require('~/db/models');

/**
 * ConfigMerger - Merges Git baseline configs with runtime overrides
 *
 * Priority: Runtime > Git
 *
 * Usage:
 *   const effective = await configMerger.getEffectiveConfig(subject, provider, model);
 */
class ConfigMerger {
  /**
   * Get the effective configuration for a subject+model
   * Merges git baseline with runtime overrides
   *
   * @param {string} subject - User ID or group path
   * @param {string} provider - Provider name (openai, anthropic, etc.)
   * @param {string} model - Model name
   * @returns {Promise<Object|null>} Merged configuration or null
   */
  async getEffectiveConfig(subject, provider, model) {
    try {
      // Look for runtime override first (highest priority)
      const runtimeOverride = await ModelAccess.findOne({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'runtime',
        active: true,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      // If we have a valid runtime override, return it
      if (runtimeOverride) {
        logger.debug(`[ConfigMerger] Using runtime override for ${subject}/${provider}/${model}`);
        return this._toPlainObject(runtimeOverride);
      }

      // Fall back to git baseline
      const gitBaseline = await ModelAccess.findOne({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'git',
        active: true
      });

      if (gitBaseline) {
        logger.debug(`[ConfigMerger] Using git baseline for ${subject}/${provider}/${model}`);
        return this._toPlainObject(gitBaseline);
      }

      logger.debug(`[ConfigMerger] No config found for ${subject}/${provider}/${model}`);
      return null;

    } catch (error) {
      logger.error('[ConfigMerger] Error getting effective config:', error);
      throw error;
    }
  }

  /**
   * Get all effective configurations for a subject (user or group)
   * Returns merged configs for all models the subject has access to
   *
   * @param {string} subject - User ID or group path
   * @param {string} type - 'user' or 'group'
   * @returns {Promise<Array>} Array of effective configurations
   */
  async getAllEffectiveConfigs(subject, type = 'group') {
    try {
      // Get all git baselines for this subject
      const gitConfigs = await ModelAccess.find({
        type,
        subject,
        configSource: 'git',
        active: true
      });

      // Get all runtime overrides for this subject
      const runtimeOverrides = await ModelAccess.find({
        type,
        subject,
        configSource: 'runtime',
        active: true,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      // Build map of runtime overrides by provider+model
      const overrideMap = new Map();
      for (const override of runtimeOverrides) {
        const key = `${override.provider}:${override.model}`;
        overrideMap.set(key, override);
      }

      // Merge: use override if exists, otherwise use git baseline
      const effectiveConfigs = [];

      for (const gitConfig of gitConfigs) {
        const key = `${gitConfig.provider}:${gitConfig.model}`;
        const override = overrideMap.get(key);

        if (override) {
          effectiveConfigs.push(this._toPlainObject(override));
          overrideMap.delete(key); // Mark as processed
        } else {
          effectiveConfigs.push(this._toPlainObject(gitConfig));
        }
      }

      // Add any runtime overrides that don't have a git baseline
      // (These are runtime-only grants, not in Git)
      for (const override of overrideMap.values()) {
        effectiveConfigs.push(this._toPlainObject(override));
      }

      logger.debug(`[ConfigMerger] Found ${effectiveConfigs.length} effective configs for ${subject}`);
      return effectiveConfigs;

    } catch (error) {
      logger.error('[ConfigMerger] Error getting all effective configs:', error);
      throw error;
    }
  }

  /**
   * Create a runtime override for an existing git baseline
   *
   * @param {string} subject - User ID or group path
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {Object} overrides - Fields to override
   * @param {Object} metadata - Override metadata (reason, expiresAt, approvedBy)
   * @returns {Promise<Object>} Created runtime override
   */
  async createRuntimeOverride(subject, provider, model, overrides, metadata = {}) {
    try {
      // Find the git baseline
      const gitBaseline = await ModelAccess.findOne({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'git',
        active: true
      });

      if (!gitBaseline) {
        throw new Error(`No git baseline found for ${subject}/${provider}/${model}`);
      }

      if (!gitBaseline.mutableViaAdmin) {
        throw new Error(`Configuration for ${subject}/${provider}/${model} is marked immutable`);
      }

      // Check if runtime override already exists
      const existingOverride = await ModelAccess.findOne({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'runtime'
      });

      if (existingOverride) {
        throw new Error(`Runtime override already exists for ${subject}/${provider}/${model}. Update it instead.`);
      }

      // Create runtime override by merging git baseline with overrides
      const runtimeConfig = {
        ...gitBaseline.toObject(),
        _id: undefined, // New document
        configSource: 'runtime',
        overriddenBy: gitBaseline._id,
        expiresAt: metadata.expiresAt || null,
        overrideReason: metadata.reason || 'Admin override',
        approvedBy: metadata.approvedBy || [],
        createdBy: metadata.createdBy || 'admin',
        lastSyncedAt: new Date(),
        ...overrides // Apply overrides
      };

      const runtimeOverride = await ModelAccess.create(runtimeConfig);

      // Link git baseline to runtime override
      gitBaseline.overrides = runtimeOverride._id;
      await gitBaseline.save();

      logger.info(`[ConfigMerger] Created runtime override for ${subject}/${provider}/${model}`);

      return this._toPlainObject(runtimeOverride);

    } catch (error) {
      logger.error('[ConfigMerger] Error creating runtime override:', error);
      throw error;
    }
  }

  /**
   * Update an existing runtime override
   *
   * @param {string} subject - User ID or group path
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {Object} updates - Fields to update
   * @param {Object} metadata - Update metadata
   * @returns {Promise<Object>} Updated runtime override
   */
  async updateRuntimeOverride(subject, provider, model, updates, metadata = {}) {
    try {
      const runtimeOverride = await ModelAccess.findOne({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'runtime'
      });

      if (!runtimeOverride) {
        throw new Error(`No runtime override found for ${subject}/${provider}/${model}`);
      }

      // Update fields
      Object.assign(runtimeOverride, updates);

      // Update metadata
      if (metadata.reason) {
        runtimeOverride.overrideReason = metadata.reason;
      }
      if (metadata.approvedBy) {
        runtimeOverride.approvedBy = [
          ...new Set([...runtimeOverride.approvedBy, ...metadata.approvedBy])
        ];
      }
      if (metadata.expiresAt !== undefined) {
        runtimeOverride.expiresAt = metadata.expiresAt;
      }

      runtimeOverride.lastSyncedAt = new Date();
      await runtimeOverride.save();

      logger.info(`[ConfigMerger] Updated runtime override for ${subject}/${provider}/${model}`);

      return this._toPlainObject(runtimeOverride);

    } catch (error) {
      logger.error('[ConfigMerger] Error updating runtime override:', error);
      throw error;
    }
  }

  /**
   * Delete a runtime override (reverts to git baseline)
   *
   * @param {string} subject - User ID or group path
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @returns {Promise<boolean>} Success status
   */
  async deleteRuntimeOverride(subject, provider, model) {
    try {
      const runtimeOverride = await ModelAccess.findOne({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'runtime'
      });

      if (!runtimeOverride) {
        logger.warn(`[ConfigMerger] No runtime override to delete for ${subject}/${provider}/${model}`);
        return false;
      }

      // Unlink from git baseline
      if (runtimeOverride.overriddenBy) {
        await ModelAccess.updateOne(
          { _id: runtimeOverride.overriddenBy },
          { $unset: { overrides: 1 } }
        );
      }

      await ModelAccess.deleteOne({ _id: runtimeOverride._id });

      logger.info(`[ConfigMerger] Deleted runtime override for ${subject}/${provider}/${model}`);

      return true;

    } catch (error) {
      logger.error('[ConfigMerger] Error deleting runtime override:', error);
      throw error;
    }
  }

  /**
   * Expire old runtime overrides
   * Should be run as a cron job
   *
   * @returns {Promise<number>} Number of expired overrides
   */
  async expireOverrides() {
    try {
      const now = new Date();

      const expiredOverrides = await ModelAccess.find({
        configSource: 'runtime',
        expiresAt: { $ne: null, $lte: now },
        active: true
      });

      for (const override of expiredOverrides) {
        logger.info(`[ConfigMerger] Expiring override for ${override.subject}/${override.provider}/${override.model}`);

        // Mark as inactive instead of deleting (for audit trail)
        override.active = false;
        await override.save();

        // Unlink from git baseline
        if (override.overriddenBy) {
          await ModelAccess.updateOne(
            { _id: override.overriddenBy },
            { $unset: { overrides: 1 } }
          );
        }
      }

      logger.info(`[ConfigMerger] Expired ${expiredOverrides.length} runtime overrides`);

      return expiredOverrides.length;

    } catch (error) {
      logger.error('[ConfigMerger] Error expiring overrides:', error);
      throw error;
    }
  }

  /**
   * Get audit trail for a configuration
   *
   * @param {string} subject - User ID or group path
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @returns {Promise<Object>} Audit information
   */
  async getAuditTrail(subject, provider, model) {
    try {
      const gitBaseline = await ModelAccess.findOne({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'git'
      }).populate('overrides');

      const allRuntimeOverrides = await ModelAccess.find({
        type: 'group',
        subject,
        provider,
        model,
        configSource: 'runtime'
      }).sort({ createdAt: -1 });

      return {
        git_baseline: gitBaseline ? this._toPlainObject(gitBaseline) : null,
        current_override: gitBaseline?.overrides ? this._toPlainObject(gitBaseline.overrides) : null,
        all_overrides: allRuntimeOverrides.map(o => this._toPlainObject(o)),
        effective_config: await this.getEffectiveConfig(subject, provider, model)
      };

    } catch (error) {
      logger.error('[ConfigMerger] Error getting audit trail:', error);
      throw error;
    }
  }

  /**
   * Convert Mongoose document to plain object
   * @private
   */
  _toPlainObject(doc) {
    if (!doc) return null;
    const obj = doc.toObject ? doc.toObject() : doc;
    return {
      ...obj,
      id: obj._id?.toString(),
      _id: obj._id?.toString()
    };
  }
}

// Export singleton
const configMerger = new ConfigMerger();

module.exports = { ConfigMerger, configMerger };