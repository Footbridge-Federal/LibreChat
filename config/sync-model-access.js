#!/usr/bin/env node

/**
 * Sync Model Access Configuration
 *
 * Syncs groups.yaml to MongoDB ModelAccess collection
 *
 * Usage:
 *   node config/sync-model-access.js            # Sync all rules
 *   node config/sync-model-access.js --dry-run  # Preview changes
 *   node config/sync-model-access.js --clean    # Remove stale rules
 */

require('dotenv').config();
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });

const { connectDb } = require('../api/db');
const { yamlConfigLoader } = require('../api/server/services/Config/YAMLConfigLoader');
const { logger } = require('../api/config');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const clean = args.includes('--clean');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Sync Model Access Configuration

Syncs groups.yaml to MongoDB ModelAccess collection.

Usage:
  node config/sync-model-access.js [options]

Options:
  --dry-run    Preview changes without applying them
  --clean      Remove stale git-sourced rules (not in YAML anymore)
  --help, -h   Show this help message

Examples:
  node config/sync-model-access.js
  node config/sync-model-access.js --dry-run
  node config/sync-model-access.js --clean --dry-run
`);
  process.exit(0);
}

async function syncModelAccess() {
  try {
    logger.info('='.repeat(60));
    logger.info('SYNC MODEL ACCESS CONFIGURATION');
    logger.info('='.repeat(60));

    if (dryRun) {
      logger.info('🔍 DRY RUN MODE - No changes will be applied');
    }

    // Connect to database
    logger.info('Connecting to MongoDB...');
    await connectDb();
    logger.info('✓ Connected to MongoDB');

    // Check if config files exist
    const exists = yamlConfigLoader.checkConfigExists();
    if (!exists.groups) {
      throw new Error('groups.yaml not found. Expected at: ' + yamlConfigLoader.getConfigPaths().groups);
    }

    logger.info('✓ Found groups.yaml');

    // Sync rules from YAML to MongoDB
    logger.info('\nSyncing access rules from YAML to MongoDB...');
    const syncResult = await yamlConfigLoader.syncModelAccessToDatabase(dryRun);

    logger.info('\nSync Results:');
    logger.info(`  ✓ Synced: ${syncResult.synced}`);
    logger.info(`  ✗ Errors: ${syncResult.errors}`);

    if (syncResult.results && syncResult.results.length > 0) {
      logger.info('\nDetailed Results:');
      for (const result of syncResult.results) {
        if (result.action === 'created') {
          logger.info(`  [CREATED] ${result.rule.subject}/${result.rule.provider}/${result.rule.model}`);
        } else if (result.action === 'updated') {
          logger.info(`  [UPDATED] ${result.rule.subject}/${result.rule.provider}/${result.rule.model}`);
        } else if (result.action === 'error') {
          logger.error(`  [ERROR] ${result.rule.subject}/${result.rule.provider}/${result.rule.model}: ${result.error}`);
        }
      }
    }

    // Clean up stale rules if requested
    if (clean) {
      logger.info('\nCleaning up stale git-sourced rules...');
      const cleanupResult = await yamlConfigLoader.cleanupStaleGitRules(dryRun);

      logger.info(`\nCleanup Results:`);
      logger.info(`  ✓ Removed: ${cleanupResult.removed}`);

      if (cleanupResult.removedRules && cleanupResult.removedRules.length > 0) {
        logger.info('\nRemoved Rules:');
        for (const rule of cleanupResult.removedRules) {
          logger.info(`  [REMOVED] ${rule}`);
        }
      }
    }

    logger.info('\n' + '='.repeat(60));
    if (dryRun) {
      logger.info('✓ DRY RUN COMPLETE - No changes were applied');
    } else {
      logger.info('✓ MODEL ACCESS SYNC COMPLETE');
    }
    logger.info('='.repeat(60));

    process.exit(0);

  } catch (error) {
    logger.error('\n❌ SYNC FAILED');
    logger.error('Error:', error.message);
    logger.error(error.stack);
    process.exit(1);
  }
}

// Run sync
syncModelAccess();