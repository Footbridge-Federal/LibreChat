const { logger } = require('~/config');
const getLogStores = require('~/cache/getLogStores');
const { CacheKeys } = require('librechat-data-provider');
const crypto = require('crypto');

class PolicyEngine {
  constructor() {
    this.cache = getLogStores(CacheKeys.CONFIG_STORE);
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Compute effective policy for a user based on token claims and stored rules
   * @param {string} userId - User ID
   * @param {Object} tokenClaims - JWT token claims from Keycloak
   * @returns {Promise<Object>} Effective policy
   */
  async computeEffectivePolicy(userId, tokenClaims) {
    const cacheKey = this._generateCacheKey(userId, tokenClaims);

    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      logger.debug(`[PolicyEngine] Cache hit for user ${userId}`);
      return cached;
    }

    logger.debug(`[PolicyEngine] Computing policy for user ${userId}`);

    const policyVersion = await this._getCurrentPolicyVersion();
    const rules = await this._gatherApplicableRules(userId, tokenClaims);
    const effectivePolicy = await this._resolvePolicy(rules, tokenClaims);

    // Cache result
    await this.cache.set(cacheKey, effectivePolicy, this.CACHE_TTL);

    logger.debug(`[PolicyEngine] Policy computed for user ${userId}:`, {
      allowedModels: effectivePolicy.allowed_models.length,
      deniedModels: effectivePolicy.denied_models.length,
      rulesSources: effectivePolicy.decision_log.map(d => d.source)
    });

    return effectivePolicy;
  }

  /**
   * Authorize a specific model request
   * @param {string} userId - User ID
   * @param {Object} tokenClaims - JWT token claims
   * @param {string} model - Model ID (e.g., 'gpt-4o', 'claude-3.5')
   * @param {string} endpoint - Endpoint (e.g., 'openai', 'anthropic')
   * @param {Object} parameters - Request parameters
   * @returns {Promise<Object>} Authorization result
   */
  async authorize(userId, tokenClaims, model, endpoint, parameters = {}) {
    const effectivePolicy = await this.computeEffectivePolicy(userId, tokenClaims);
    const resourceId = `${endpoint}/${model}`;

    // Check if explicitly denied
    if (effectivePolicy.denied_models.includes(resourceId)) {
      return {
        allowed: false,
        reason: 'Model access explicitly denied',
        rule_id: 'deny_rule',
        decision_log: effectivePolicy.decision_log.filter(d => d.effect === 'deny')
      };
    }

    // Check if explicitly allowed
    const allowedModel = effectivePolicy.allowed_models.find(m =>
      m.model_id === model && m.endpoint === endpoint
    );

    if (!allowedModel) {
      return {
        allowed: false,
        reason: 'Model not in allowed list (default deny)',
        rule_id: 'default_deny',
        decision_log: effectivePolicy.decision_log
      };
    }

    // Validate parameters against conditions
    const paramValidation = this._validateParameters(allowedModel, parameters);
    if (!paramValidation.valid) {
      return {
        allowed: false,
        reason: `Parameter validation failed: ${paramValidation.reason}`,
        rule_id: allowedModel.rule_id,
        decision_log: effectivePolicy.decision_log
      };
    }

    // Check rate limits
    const rateLimitCheck = await this._checkRateLimits(userId, model, allowedModel);
    if (!rateLimitCheck.allowed) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        rate_limits: rateLimitCheck,
        rule_id: allowedModel.rule_id
      };
    }

    return {
      allowed: true,
      model_config: allowedModel,
      credential_source: allowedModel.credential_source,
      key_ref: allowedModel.key_ref,
      rate_limits: rateLimitCheck,
      decision_log: effectivePolicy.decision_log
    };
  }

  /**
   * Gather all rules applicable to a user (only admin override rules)
   * @private
   */
  async _gatherApplicableRules(userId, tokenClaims) {
    const { PolicyRule } = require('~/db/models');

    const subjects = this._extractSubjects(userId, tokenClaims);
    logger.debug(`[PolicyEngine] Subjects for user ${userId}:`, subjects);

    // Only fetch admin override rules, not auto-generated group rules
    const rules = await PolicyRule.find({
      subject_type: { $in: subjects.map(s => s.type) },
      subject_id: { $in: subjects.map(s => s.id) },
      active: true,
      created_by: { $ne: 'keycloak_sync' } // Exclude auto-generated rules
    }).sort({ priority: 1, createdAt: 1 });

    logger.debug(`[PolicyEngine] Found ${rules.length} admin override rules for user ${userId}`);
    return rules;
  }

  /**
   * Extract subjects (user, groups, roles) from token claims
   * @private
   */
  _extractSubjects(userId, tokenClaims) {
    const subjects = [
      { type: 'user', id: userId }
    ];

    // Add Keycloak groups
    if (tokenClaims.groups && Array.isArray(tokenClaims.groups)) {
      tokenClaims.groups.forEach(group => {
        subjects.push({ type: 'group', id: group });

        // Extract org from group path (e.g., /org/airwall -> airwall)
        const orgMatch = group.match(/^\/org\/(.+)$/);
        if (orgMatch) {
          subjects.push({ type: 'org', id: orgMatch[1] });
        }
      });
    }

    // Add Keycloak roles
    if (tokenClaims.realm_access?.roles) {
      tokenClaims.realm_access.roles.forEach(role => {
        subjects.push({ type: 'role', id: role });
      });
    }

    return subjects;
  }

  /**
   * Resolve final policy from all applicable rules
   * @private
   */
  async _resolvePolicy(rules, tokenClaims) {
    const allowedModels = new Map();
    const deniedModels = new Set();
    const decisionLog = [];

    // First pass: Process DENY rules (highest precedence)
    const denyRules = rules.filter(r => r.effect === 'deny');
    for (const rule of denyRules) {
      if (rule.resource_type === 'model') {
        deniedModels.add(rule.resource_id);
        decisionLog.push({
          rule_id: rule._id.toString(),
          source: 'app_policy',
          effect: 'deny',
          reason: `Explicit deny rule: ${rule.description || 'No description'}`,
          priority: rule.priority
        });
      }
    }

    // Second pass: Process ALLOW rules
    const allowRules = rules.filter(r => r.effect === 'allow');
    for (const rule of allowRules) {
      if (rule.resource_type === 'model') {
        const [endpoint, model] = rule.resource_id.split('/');

        if (!deniedModels.has(rule.resource_id)) {
          const modelConfig = {
            model_id: model,
            endpoint: endpoint,
            max_tokens: rule.conditions?.max_tokens || 8000,
            max_output_tokens: rule.conditions?.max_output_tokens || 4000,
            temperature_max: rule.conditions?.temperature_max || 1.0,
            credential_source: rule.key_policy,
            key_ref: rule.key_ref,
            rule_id: rule._id.toString(),
            rate_limits: rule.conditions?.rate_limits
          };

          allowedModels.set(rule.resource_id, modelConfig);
          decisionLog.push({
            rule_id: rule._id.toString(),
            source: 'app_policy',
            effect: 'allow',
            reason: `Explicit allow rule: ${rule.description || 'No description'}`,
            priority: rule.priority
          });
        }
      }
    }

    // Third pass: Process Keycloak group attributes with highest limit wins merge strategy
    // If group_attributes not in token, fetch from Keycloak API
    let groupAttributes = tokenClaims.group_attributes;

    if (!groupAttributes && tokenClaims.groups && tokenClaims.groups.length > 0) {
      // Fetch group attributes from Keycloak
      const { keycloakSync } = require('./KeycloakSync');
      try {
        const groups = await keycloakSync.getGroups();
        groupAttributes = {};

        for (const groupPath of tokenClaims.groups) {
          const group = groups.find(g => g.path === groupPath);
          if (group && group.attributes) {
            groupAttributes[groupPath] = group.attributes;
          }
        }
      } catch (error) {
        logger.error('[PolicyEngine] Failed to fetch group attributes from Keycloak:', error);
        groupAttributes = {};
      }
    }

    if (groupAttributes) {
      const groupMergeMap = new Map(); // Track highest limits for each model

      for (const [groupPath, attributes] of Object.entries(groupAttributes)) {
        if (attributes.models_allow) {
          attributes.models_allow.forEach(modelId => {
            if (!deniedModels.has(modelId)) {
              const [endpoint, model] = modelId.split('/');

              const modelConfig = {
                model_id: model,
                endpoint: endpoint,
                max_tokens: parseInt(attributes.max_tokens_per_request) || 8000,
                max_output_tokens: parseInt(attributes.max_output_tokens) || 4000,
                temperature_max: parseFloat(attributes.temperature_max) || 1.0,
                credential_source: 'pre_configured',
                key_ref: `group_${groupPath.replace(/\//g, '_')}`,
                rule_id: `keycloak_${groupPath}`,
                rate_limits: {
                  requests_per_minute: parseInt(attributes.requests_per_minute) || 60,
                  tokens_per_day: parseInt(attributes.tokens_per_day) || 100000,
                  monthly_token_limit: parseInt(attributes.monthly_token_limit) || 1000000
                },
                group_path: groupPath
              };

              // Implement highest limit wins merge strategy
              if (allowedModels.has(modelId)) {
                const existing = allowedModels.get(modelId);
                const merged = {
                  ...existing,
                  max_tokens: Math.max(existing.max_tokens, modelConfig.max_tokens),
                  max_output_tokens: Math.max(existing.max_output_tokens, modelConfig.max_output_tokens),
                  temperature_max: Math.max(existing.temperature_max, modelConfig.temperature_max),
                  rate_limits: {
                    requests_per_minute: Math.max(
                      existing.rate_limits?.requests_per_minute || 0,
                      modelConfig.rate_limits.requests_per_minute
                    ),
                    tokens_per_day: Math.max(
                      existing.rate_limits?.tokens_per_day || 0,
                      modelConfig.rate_limits.tokens_per_day
                    ),
                    monthly_token_limit: Math.max(
                      existing.rate_limits?.monthly_token_limit || 0,
                      modelConfig.rate_limits.monthly_token_limit
                    )
                  },
                  // Keep track of contributing groups
                  contributing_groups: [...(existing.contributing_groups || [existing.group_path]), groupPath].filter(Boolean)
                };
                allowedModels.set(modelId, merged);
              } else {
                modelConfig.contributing_groups = [groupPath];
                allowedModels.set(modelId, modelConfig);
              }

              decisionLog.push({
                source: 'keycloak_group',
                effect: 'allow',
                reason: `Keycloak group permission: ${groupPath}`,
                priority: 500
              });
            }
          });
        }

        if (attributes.models_deny) {
          attributes.models_deny.forEach(modelId => {
            deniedModels.add(modelId);
            decisionLog.push({
              source: 'keycloak_group',
              effect: 'deny',
              reason: `Keycloak group denial: ${groupPath}`,
              priority: 100
            });
          });
        }
      }
    }

    return {
      allowed_models: Array.from(allowedModels.values()),
      denied_models: Array.from(deniedModels),
      default_limits: {
        max_tokens: 8000,
        monthly_limit: 1000000,
        rate_limit: 60
      },
      decision_log: decisionLog.sort((a, b) => (a.priority || 1000) - (b.priority || 1000))
    };
  }

  /**
   * Validate request parameters against policy conditions
   * @private
   */
  _validateParameters(modelConfig, parameters) {
    if (parameters.max_tokens && parameters.max_tokens > modelConfig.max_tokens) {
      return {
        valid: false,
        reason: `max_tokens ${parameters.max_tokens} exceeds limit ${modelConfig.max_tokens}`
      };
    }

    if (parameters.temperature && parameters.temperature > modelConfig.temperature_max) {
      return {
        valid: false,
        reason: `temperature ${parameters.temperature} exceeds limit ${modelConfig.temperature_max}`
      };
    }

    return { valid: true };
  }

  /**
   * Check rate limits for user/model combination
   * @private
   */
  async _checkRateLimits(userId, model, modelConfig) {
    // Implementation would check current usage against limits
    // For now, return allowed with current usage info
    return {
      allowed: true,
      current_usage: 0,
      limit: modelConfig.rate_limits?.requests_per_minute || 60,
      window: 'minute'
    };
  }

  /**
   * Generate cache key for user policy
   * @private
   */
  _generateCacheKey(userId, tokenClaims) {
    const tokenHash = crypto
      .createHash('md5')
      .update(JSON.stringify({
        iat: tokenClaims.iat,
        groups: tokenClaims.groups,
        realm_access: tokenClaims.realm_access
      }))
      .digest('hex');

    return `policy:${userId}:${tokenHash}`;
  }

  /**
   * Get current policy version for cache invalidation
   * @private
   */
  async _getCurrentPolicyVersion() {
    const { PolicyVersion } = require('~/db/models');
    const latest = await PolicyVersion.findOne().sort({ version: -1 });
    return latest ? latest.version : 1;
  }
}

module.exports = { PolicyEngine };