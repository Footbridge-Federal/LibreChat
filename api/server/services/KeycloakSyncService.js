const { logger } = require('@librechat/data-schemas');
const KeycloakService = require('./KeycloakService');

/**
 * Background service for periodic Keycloak synchronization
 */
class KeycloakSyncService {
  constructor() {
    this.syncInterval = null;
    this.isRunning = false;
  }

  /**
   * Start periodic role synchronization
   */
  start() {
    if (!KeycloakService.enabled) {
      logger.debug('Keycloak sync service skipped - Keycloak not enabled');
      return;
    }

    const syncEnabled = process.env.KEYCLOAK_ROLE_SYNC_ENABLED === 'true';
    if (!syncEnabled) {
      logger.debug('Keycloak sync service skipped - sync not enabled');
      return;
    }

    const intervalMinutes = parseInt(process.env.KEYCLOAK_ROLE_SYNC_INTERVAL_MINUTES) || 60;
    const intervalMs = intervalMinutes * 60 * 1000;

    logger.info(`Starting Keycloak role sync service (interval: ${intervalMinutes}min)`);

    // Run initial sync
    this.performSync();

    // Set up periodic sync
    this.syncInterval = setInterval(() => {
      this.performSync();
    }, intervalMs);

    this.isRunning = true;
  }

  /**
   * Stop periodic synchronization
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.isRunning = false;
    logger.info('Keycloak sync service stopped');
  }

  /**
   * Perform role synchronization
   */
  async performSync() {
    if (!KeycloakService.enabled) {
      return;
    }

    try {
      logger.debug('Starting scheduled Keycloak role sync...');
      const result = await KeycloakService.syncRoles();
      logger.info(`Scheduled Keycloak role sync completed: ${result.synced} synced, ${result.errors} errors`);
    } catch (error) {
      logger.error(`Scheduled Keycloak role sync failed: ${error.message}`);
    }
  }

  /**
   * Get sync service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      syncEnabled: process.env.KEYCLOAK_ROLE_SYNC_ENABLED === 'true',
      intervalMinutes: parseInt(process.env.KEYCLOAK_ROLE_SYNC_INTERVAL_MINUTES) || 60,
      keycloakEnabled: KeycloakService.enabled,
    };
  }
}

// Export singleton instance
module.exports = new KeycloakSyncService();