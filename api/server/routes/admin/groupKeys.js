const express = require('express');
const { GroupApiKey } = require('~/db/models');
const { requireJwtAuth } = require('~/server/middleware');
const { KeyVault } = require('~/server/services/ModelAccess/KeyVault');
const { logger } = require('~/config');

const router = express.Router();
const keyVault = new KeyVault();

/**
 * Middleware to check if user has admin permissions
 * TODO: Replace with actual admin check based on your system
 */
const requireAdmin = (req, res, next) => {
  const userGroups = req.user?.token_claims?.groups || [];
  const isAdmin = userGroups.some(g =>
    g.includes('/org-airwall') || g.includes('admin')
  );

  if (!isAdmin) {
    return res.status(403).json({
      error: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    });
  }

  next();
};

/**
 * GET /api/admin/group-keys
 * List all group API keys (without revealing actual keys)
 */
router.get('/', requireJwtAuth, requireAdmin, async (req, res) => {
  try {
    const { groupPath, provider, includeInactive } = req.query;

    const filter = {};
    if (groupPath) {
      filter.groupPath = groupPath;
    }
    if (provider) {
      filter.provider = provider.toLowerCase();
    }
    if (!includeInactive) {
      filter.isActive = true;
    }

    const keys = await GroupApiKey.find(filter)
      .select('-encryptedKey')
      .sort({ groupPath: 1, provider: 1, createdAt: -1 });

    res.json({
      keys: keys.map(k => ({
        id: k._id.toString(),
        groupPath: k.groupPath,
        keyRef: k.keyRef,
        provider: k.provider,
        keyName: k.keyName,
        keyPrefix: k.keyPrefix,
        isActive: k.isActive,
        lastUsed: k.lastUsed,
        usageCount: k.usageCount,
        expiresAt: k.expiresAt,
        source: k.source,
        reason: k.reason,
        createdBy: k.createdBy,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt
      })),
      total: keys.length
    });

  } catch (error) {
    logger.error('[GroupKeys API] Error listing keys:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * POST /api/admin/group-keys
 * Add new group API key
 */
router.post('/', requireJwtAuth, requireAdmin, async (req, res) => {
  try {
    const { groupPath, keyRef, provider, apiKey, expiresAt, reason } = req.body;

    // Validate required fields
    if (!groupPath || !keyRef || !provider || !apiKey) {
      return res.status(400).json({
        error: 'Missing required fields: groupPath, keyRef, provider, apiKey'
      });
    }

    // Validate key format
    if (typeof apiKey !== 'string' || apiKey.length < 10) {
      return res.status(400).json({
        error: 'Invalid API key format'
      });
    }

    // Check if key already exists
    const existing = await GroupApiKey.findOne({
      keyRef,
      provider: provider.toLowerCase(),
      isActive: true
    });

    if (existing) {
      return res.status(409).json({
        error: `Active API key already exists for ${keyRef}/${provider}. Use rotate endpoint to replace it.`,
        code: 'KEY_EXISTS'
      });
    }

    // Store key
    const result = await keyVault.storeGroupKey(
      keyRef,
      groupPath,
      provider,
      apiKey,
      {
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        reason: reason || 'Added via admin API',
        createdBy: req.user.id,
        source: 'manual'
      }
    );

    logger.info(`[GroupKeys API] Key added for ${keyRef}/${provider} by ${req.user.email}`);

    res.status(201).json({
      message: 'API key stored successfully',
      key: result
    });

  } catch (error) {
    logger.error('[GroupKeys API] Error storing key:', error);

    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Duplicate key detected',
        code: 'DUPLICATE_KEY'
      });
    }

    res.status(500).json({ error: 'Failed to store API key' });
  }
});

/**
 * POST /api/admin/group-keys/:keyId/rotate
 * Rotate an existing API key
 */
router.post('/:keyId/rotate', requireJwtAuth, requireAdmin, async (req, res) => {
  try {
    const { newApiKey, reason } = req.body;

    if (!newApiKey) {
      return res.status(400).json({ error: 'newApiKey is required' });
    }

    // Get old key
    const oldKey = await GroupApiKey.findById(req.params.keyId);
    if (!oldKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (!oldKey.isActive) {
      return res.status(400).json({ error: 'Cannot rotate inactive key' });
    }

    // Store new key
    const newKey = await keyVault.storeGroupKey(
      oldKey.keyRef,
      oldKey.groupPath,
      oldKey.provider,
      newApiKey,
      {
        reason: reason || `Key rotation (from ${oldKey.keyPrefix})`,
        createdBy: req.user.id,
        rotatedFrom: oldKey._id,
        source: 'manual'
      }
    );

    // Deactivate old key
    oldKey.isActive = false;
    await oldKey.save();

    logger.info(`[GroupKeys API] Key rotated for ${oldKey.keyRef}/${oldKey.provider} by ${req.user.email}`);

    res.json({
      message: 'API key rotated successfully',
      oldKeyId: oldKey._id.toString(),
      newKey
    });

  } catch (error) {
    logger.error('[GroupKeys API] Error rotating key:', error);
    res.status(500).json({ error: 'Failed to rotate API key' });
  }
});

/**
 * DELETE /api/admin/group-keys/:keyId
 * Revoke/deactivate an API key
 */
router.delete('/:keyId', requireJwtAuth, requireAdmin, async (req, res) => {
  try {
    const key = await GroupApiKey.findById(req.params.keyId);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    key.isActive = false;
    await key.save();

    logger.info(`[GroupKeys API] Key revoked: ${key.keyRef}/${key.provider} by ${req.user.email}`);

    res.json({
      message: 'API key revoked successfully',
      keyId: key._id.toString()
    });

  } catch (error) {
    logger.error('[GroupKeys API] Error revoking key:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

/**
 * GET /api/admin/group-keys/stats
 * Get API key usage statistics
 */
router.get('/stats', requireJwtAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await GroupApiKey.aggregate([
      {
        $group: {
          _id: {
            groupPath: '$groupPath',
            provider: '$provider'
          },
          totalKeys: { $sum: 1 },
          activeKeys: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          totalUsage: { $sum: '$usageCount' },
          lastUsed: { $max: '$lastUsed' }
        }
      },
      {
        $sort: { '_id.groupPath': 1, '_id.provider': 1 }
      }
    ]);

    res.json({
      stats: stats.map(s => ({
        groupPath: s._id.groupPath,
        provider: s._id.provider,
        totalKeys: s.totalKeys,
        activeKeys: s.activeKeys,
        totalUsage: s.totalUsage,
        lastUsed: s.lastUsed
      }))
    });

  } catch (error) {
    logger.error('[GroupKeys API] Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;