const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { checkAdmin } = require('~/server/middleware/roles/admin');
const KeycloakService = require('~/server/services/KeycloakService');
const { logger } = require('@librechat/data-schemas');

const router = express.Router();
router.use(requireJwtAuth);

/**
 * GET /api/integration/keycloak/status
 * Get Keycloak integration status and basic configuration info
 */
router.get('/keycloak/status', checkAdmin, async (req, res) => {
  try {
    if (!KeycloakService.enabled) {
      return res.json({
        enabled: false,
        message: 'Keycloak integration not configured'
      });
    }

    res.json({
      enabled: true,
      adminUrl: process.env.KEYCLOAK_ADMIN_URL,
      realm: process.env.KEYCLOAK_TARGET_REALM,
      rolePrefix: process.env.KEYCLOAK_ROLE_MAPPING_PREFIX || 'librechat-',
      syncEnabled: process.env.KEYCLOAK_ROLE_SYNC_ENABLED === 'true',
      syncInterval: process.env.KEYCLOAK_ROLE_SYNC_INTERVAL_MINUTES || '60',
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to get integration status',
      error: error.message,
    });
  }
});

/**
 * POST /api/integration/keycloak/sync-roles
 * Manually trigger role synchronization from Keycloak
 */
router.post('/keycloak/sync-roles', checkAdmin, async (req, res) => {
  try {
    if (!KeycloakService.enabled) {
      return res.status(400).json({
        message: 'Keycloak integration not configured'
      });
    }

    logger.info(`[keycloak] Manual role sync triggered by ${req.user.email}`);
    const result = await KeycloakService.syncRoles();

    res.json({
      message: 'Role synchronization completed',
      ...result,
    });
  } catch (error) {
    logger.error(`[keycloak] Role sync failed: ${error.message}`);
    res.status(500).json({
      message: 'Role synchronization failed',
      error: error.message,
    });
  }
});

/**
 * POST /api/integration/keycloak/test-connection
 * Test Keycloak admin connection
 */
router.post('/keycloak/test-connection', checkAdmin, async (req, res) => {
  try {
    if (!KeycloakService.enabled) {
      return res.status(400).json({
        message: 'Keycloak integration not configured'
      });
    }

    // Try to get admin token
    const token = await KeycloakService.getAdminToken();

    if (token) {
      res.json({
        success: true,
        message: 'Keycloak admin connection successful',
        realm: process.env.KEYCLOAK_TARGET_REALM,
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to obtain Keycloak admin token',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Keycloak connection test failed',
      error: error.message,
    });
  }
});

module.exports = router;