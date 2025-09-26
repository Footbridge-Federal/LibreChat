const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { checkRoles } = require('~/server/middleware/roles/admin');
const { PolicyEngine } = require('~/server/services/ModelAccess/PolicyEngine');
const { KeyVault } = require('~/server/services/ModelAccess/KeyVault');
const { getAvailableModels } = require('~/server/middleware/modelAccessControl');
const { logger } = require('~/config');

const router = express.Router();
const policyEngine = new PolicyEngine();
const keyVault = new KeyVault();

// ==================
// USER ENDPOINTS
// ==================

/**
 * GET /api/model-access/available
 * Get available models for the current user
 */
router.get('/available', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const tokenClaims = req.user.token_claims || {};

    const models = await getAvailableModels(userId, tokenClaims);

    // Check which models require user keys and if user has them
    for (const model of models) {
      if (model.requires_user_key) {
        const provider = model.endpoint.toLowerCase();
        model.has_user_key = await keyVault.hasValidUserKey(userId, provider);
      }
    }

    res.json({
      success: true,
      models,
      total: models.length
    });

  } catch (error) {
    logger.error('[ModelAccess] Error getting available models:', error);
    res.status(500).json({
      error: 'Failed to get available models',
      message: error.message
    });
  }
});

/**
 * GET /api/model-access/explain
 * Explain why user has/doesn't have access to a specific model
 */
router.get('/explain', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const tokenClaims = req.user.token_claims || {};
    const { model, endpoint } = req.query;

    if (!model || !endpoint) {
      return res.status(400).json({
        error: 'Model and endpoint parameters are required'
      });
    }

    const authorization = await policyEngine.authorize(userId, tokenClaims, model, endpoint);

    res.json({
      success: true,
      model: `${endpoint}/${model}`,
      allowed: authorization.allowed,
      reason: authorization.reason,
      decision_log: authorization.decision_log || [],
      model_config: authorization.model_config,
      credential_source: authorization.credential_source
    });

  } catch (error) {
    logger.error('[ModelAccess] Error explaining access:', error);
    res.status(500).json({
      error: 'Failed to explain model access',
      message: error.message
    });
  }
});

/**
 * GET /api/model-access/keys
 * Get user's API keys (without revealing actual keys)
 */
router.get('/keys', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const keys = await keyVault.listUserKeys(userId);

    res.json({
      success: true,
      keys
    });

  } catch (error) {
    logger.error('[ModelAccess] Error listing user keys:', error);
    res.status(500).json({
      error: 'Failed to list API keys',
      message: error.message
    });
  }
});

/**
 * POST /api/model-access/keys
 * Store a new user API key
 */
router.post('/keys', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { provider, api_key, key_name, model_access } = req.body;

    if (!provider || !api_key) {
      return res.status(400).json({
        error: 'Provider and api_key are required'
      });
    }

    // Validate API key format (basic checks)
    if (api_key.length < 20) {
      return res.status(400).json({
        error: 'API key appears invalid (too short)'
      });
    }

    const keyInfo = await keyVault.storeUserKey(userId, provider, api_key, {
      key_name,
      model_access,
      environment: 'production'
    });

    res.json({
      success: true,
      message: 'API key stored successfully',
      key: keyInfo
    });

  } catch (error) {
    logger.error('[ModelAccess] Error storing user key:', error);
    res.status(500).json({
      error: 'Failed to store API key',
      message: error.message
    });
  }
});

/**
 * DELETE /api/model-access/keys/:keyId
 * Revoke a user API key
 */
router.delete('/keys/:keyId', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { keyId } = req.params;

    const success = await keyVault.revokeUserKey(userId, keyId);

    if (success) {
      res.json({
        success: true,
        message: 'API key revoked successfully'
      });
    } else {
      res.status(404).json({
        error: 'API key not found or already revoked'
      });
    }

  } catch (error) {
    logger.error('[ModelAccess] Error revoking user key:', error);
    res.status(500).json({
      error: 'Failed to revoke API key',
      message: error.message
    });
  }
});

// ==================
// ADMIN ENDPOINTS
// ==================

/**
 * GET /api/model-access/admin/policies
 * List all policy rules (admin only)
 */
router.get('/admin/policies', requireJwtAuth, checkRoles(['airwall-admin']), async (req, res) => {
  try {
    const { PolicyRule } = require('~/db/models');

    const {
      page = 1,
      limit = 50,
      subject_type,
      resource_type,
      effect,
      active = 'true'
    } = req.query;

    const filter = {};
    if (subject_type) filter.subject_type = subject_type;
    if (resource_type) filter.resource_type = resource_type;
    if (effect) filter.effect = effect;
    if (active !== 'all') filter.active = active === 'true';

    const skip = (page - 1) * limit;
    const policies = await PolicyRule.find(filter)
      .sort({ priority: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PolicyRule.countDocuments(filter);

    res.json({
      success: true,
      policies,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('[ModelAccess] Error listing policies:', error);
    res.status(500).json({
      error: 'Failed to list policies',
      message: error.message
    });
  }
});

/**
 * POST /api/model-access/admin/policies
 * Create a new policy rule (admin only)
 */
router.post('/admin/policies', requireJwtAuth, checkRoles(['airwall-admin']), async (req, res) => {
  try {
    const { PolicyRule, PolicyVersion } = require('~/db/models');

    const policyData = {
      ...req.body,
      created_by: req.user.id
    };

    // Validate required fields
    const required = ['subject_type', 'subject_id', 'resource_type', 'resource_id', 'effect'];
    for (const field of required) {
      if (!policyData[field]) {
        return res.status(400).json({
          error: `Field '${field}' is required`
        });
      }
    }

    const policy = new PolicyRule(policyData);
    await policy.save();

    // Bump policy version for cache invalidation
    await bumpPolicyVersion('admin_update', `Created policy rule ${policy._id}`, req.user.id);

    logger.info(`[ModelAccess] Admin ${req.user.id} created policy rule ${policy._id}`);

    res.status(201).json({
      success: true,
      message: 'Policy rule created successfully',
      policy
    });

  } catch (error) {
    logger.error('[ModelAccess] Error creating policy:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        error: 'Duplicate policy rule',
        message: 'A policy rule with the same subject/resource/effect already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to create policy rule',
      message: error.message
    });
  }
});

/**
 * PUT /api/model-access/admin/policies/:policyId
 * Update a policy rule (admin only)
 */
router.put('/admin/policies/:policyId', requireJwtAuth, checkRoles(['airwall-admin']), async (req, res) => {
  try {
    const { PolicyRule } = require('~/db/models');
    const { policyId } = req.params;

    const policy = await PolicyRule.findByIdAndUpdate(
      policyId,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!policy) {
      return res.status(404).json({
        error: 'Policy rule not found'
      });
    }

    // Bump policy version
    await bumpPolicyVersion('admin_update', `Updated policy rule ${policy._id}`, req.user.id);

    logger.info(`[ModelAccess] Admin ${req.user.id} updated policy rule ${policy._id}`);

    res.json({
      success: true,
      message: 'Policy rule updated successfully',
      policy
    });

  } catch (error) {
    logger.error('[ModelAccess] Error updating policy:', error);
    res.status(500).json({
      error: 'Failed to update policy rule',
      message: error.message
    });
  }
});

/**
 * DELETE /api/model-access/admin/policies/:policyId
 * Delete a policy rule (admin only)
 */
router.delete('/admin/policies/:policyId', requireJwtAuth, checkRoles(['airwall-admin']), async (req, res) => {
  try {
    const { PolicyRule } = require('~/db/models');
    const { policyId } = req.params;

    const policy = await PolicyRule.findByIdAndDelete(policyId);

    if (!policy) {
      return res.status(404).json({
        error: 'Policy rule not found'
      });
    }

    // Bump policy version
    await bumpPolicyVersion('admin_update', `Deleted policy rule ${policy._id}`, req.user.id);

    logger.info(`[ModelAccess] Admin ${req.user.id} deleted policy rule ${policy._id}`);

    res.json({
      success: true,
      message: 'Policy rule deleted successfully'
    });

  } catch (error) {
    logger.error('[ModelAccess] Error deleting policy:', error);
    res.status(500).json({
      error: 'Failed to delete policy rule',
      message: error.message
    });
  }
});

/**
 * POST /api/model-access/admin/policies/explain
 * Explain access for any user (admin only)
 */
router.post('/admin/policies/explain', requireJwtAuth, checkRoles(['airwall-admin']), async (req, res) => {
  try {
    const { user_id, model, endpoint, token_claims = {} } = req.body;

    if (!user_id || !model || !endpoint) {
      return res.status(400).json({
        error: 'user_id, model, and endpoint are required'
      });
    }

    const authorization = await policyEngine.authorize(user_id, token_claims, model, endpoint);

    res.json({
      success: true,
      user_id,
      model: `${endpoint}/${model}`,
      allowed: authorization.allowed,
      reason: authorization.reason,
      decision_log: authorization.decision_log || [],
      model_config: authorization.model_config,
      credential_source: authorization.credential_source
    });

  } catch (error) {
    logger.error('[ModelAccess] Error in admin explain:', error);
    res.status(500).json({
      error: 'Failed to explain access',
      message: error.message
    });
  }
});

/**
 * GET /api/model-access/admin/usage
 * Get usage statistics (admin only)
 */
router.get('/admin/usage', requireJwtAuth, checkRoles(['airwall-admin']), async (req, res) => {
  try {
    const { AccessLog } = require('~/db/models');
    const { period = 'month', user_id, model } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();

    if (period === 'day') {
      startDate.setDate(startDate.getDate() - 1);
    } else if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate.setMonth(startDate.getMonth() - 1);
    }

    const matchFilter = {
      createdAt: { $gte: startDate, $lte: endDate },
      success: true
    };

    if (user_id) matchFilter.user_id = user_id;
    if (model) matchFilter.model = model;

    const stats = await AccessLog.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            user_id: '$user_id',
            model: '$model',
            endpoint: '$endpoint'
          },
          total_requests: { $sum: 1 },
          total_tokens_in: { $sum: '$tokens_in' },
          total_tokens_out: { $sum: '$tokens_out' },
          total_cost: { $sum: '$cost_usd' },
          avg_response_time: { $avg: '$response_time_ms' }
        }
      },
      {
        $group: {
          _id: null,
          total_requests: { $sum: '$total_requests' },
          total_tokens_in: { $sum: '$total_tokens_in' },
          total_tokens_out: { $sum: '$total_tokens_out' },
          total_cost: { $sum: '$total_cost' },
          unique_users: { $addToSet: '$_id.user_id' },
          unique_models: { $addToSet: '$_id.model' },
          by_model: {
            $push: {
              model: '$_id.model',
              endpoint: '$_id.endpoint',
              requests: '$total_requests',
              tokens_in: '$total_tokens_in',
              tokens_out: '$total_tokens_out',
              cost: '$total_cost'
            }
          }
        }
      }
    ]);

    const result = stats[0] || {
      total_requests: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
      total_cost: 0,
      unique_users: [],
      unique_models: [],
      by_model: []
    };

    res.json({
      success: true,
      period,
      date_range: { start: startDate, end: endDate },
      summary: {
        total_requests: result.total_requests,
        total_tokens_in: result.total_tokens_in,
        total_tokens_out: result.total_tokens_out,
        total_cost: result.total_cost,
        unique_users: result.unique_users.length,
        unique_models: result.unique_models.length
      },
      by_model: result.by_model
    });

  } catch (error) {
    logger.error('[ModelAccess] Error getting usage stats:', error);
    res.status(500).json({
      error: 'Failed to get usage statistics',
      message: error.message
    });
  }
});

// ==================
// HELPER FUNCTIONS
// ==================

/**
 * Bump policy version for cache invalidation
 * @private
 */
async function bumpPolicyVersion(source, summary, userId) {
  try {
    const { PolicyVersion } = require('~/db/models');

    const latestVersion = await PolicyVersion.findOne().sort({ version: -1 });
    const newVersion = latestVersion ? latestVersion.version + 1 : 1;

    const versionEntry = new PolicyVersion({
      version: newVersion,
      source,
      changes_summary: summary,
      updated_by: userId
    });

    await versionEntry.save();

    logger.debug(`[ModelAccess] Bumped policy version to ${newVersion}`);

  } catch (error) {
    logger.error('[ModelAccess] Error bumping policy version:', error);
  }
}

module.exports = router;