#!/usr/bin/env node

/**
 * Sync Groups Configuration
 *
 * Syncs groups.yaml to Keycloak
 *
 * Usage:
 *   node config/sync-groups.js            # Sync all groups
 *   node config/sync-groups.js --dry-run  # Preview changes
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });

const { connectDb } = require('../api/db');
const { keycloakSync } = require('../api/server/services/ModelAccess/KeycloakSync');
const { yamlConfigLoader } = require('../api/server/services/Config/YAMLConfigLoader');
const { logger } = require('../api/config');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Sync Groups Configuration

Syncs groups.yaml to Keycloak realm.

Usage:
  node config/sync-groups.js [options]

Options:
  --dry-run    Preview changes without applying them
  --help, -h   Show this help message

Examples:
  node config/sync-groups.js
  node config/sync-groups.js --dry-run

Environment Variables:
  KEYCLOAK_SERVER_URL          Keycloak server URL (default: http://localhost:8080)
  KEYCLOAK_ADMIN_REALM         Admin realm (default: master)
  KEYCLOAK_TARGET_REALM        Target realm (default: AirwallChat)
  KEYCLOAK_ADMIN_USERNAME      Admin username
  KEYCLOAK_ADMIN_PASSWORD      Admin password
`);
  process.exit(0);
}

/**
 * Update realm-export.json with synced groups
 * This ensures fresh Keycloak deployments have the same groups
 */
async function updateRealmExport(groups) {
  const realmExportPath = path.join(__dirname, '..', 'keycloak', 'realm-export.json');

  if (!fs.existsSync(realmExportPath)) {
    throw new Error(`realm-export.json not found at: ${realmExportPath}`);
  }

  // Read existing realm export
  const realmExport = JSON.parse(fs.readFileSync(realmExportPath, 'utf8'));

  // Update groups section
  realmExport.groups = groups.map(g => ({
    name: g.name,
    path: g.path,
    attributes: g.attributes || {},
    subGroups: g.subGroups || []
  }));

  // Write back to file with pretty formatting
  fs.writeFileSync(
    realmExportPath,
    JSON.stringify(realmExport, null, 2),
    'utf8'
  );

  logger.debug(`Updated realm-export.json with ${groups.length} groups`);
}

async function syncGroups() {
  try {
    logger.info('='.repeat(60));
    logger.info('SYNC GROUPS CONFIGURATION');
    logger.info('='.repeat(60));

    if (dryRun) {
      logger.info('🔍 DRY RUN MODE - No changes will be applied');
    }

    // Connect to database (needed for some operations)
    logger.info('Connecting to MongoDB...');
    await connectDb();
    logger.info('✓ Connected to MongoDB');

    // Initialize Keycloak connection
    logger.info('Connecting to Keycloak...');
    await keycloakSync.initialize();
    logger.info('✓ Connected to Keycloak');

    // Check if config files exist
    const exists = yamlConfigLoader.checkConfigExists();
    if (!exists.groups) {
      throw new Error('groups.yaml not found. Expected at: ' + yamlConfigLoader.getConfigPaths().groups);
    }

    logger.info('✓ Found groups.yaml');

    // Load groups config (new hierarchical format)
    const yaml = require('js-yaml');
    const groupsPath = yamlConfigLoader.getConfigPaths().groups;
    const content = fs.readFileSync(groupsPath, 'utf8');
    const config = yaml.load(content);

    if (!config.groups) {
      throw new Error('groups.yaml must have "groups" key');
    }

    // Convert hierarchical format to array
    const groupsArray = Object.entries(config.groups).map(([groupName, groupConfig]) => ({
      name: groupName,
      path: `/${groupName}`,  // Automatically add slash prefix
      description: groupConfig.description,
      attributes: {
        requestsPerMinute: String(groupConfig.requestsPerMinute || 30),
        monthlyTokenLimit: String(groupConfig.monthlyTokenLimit || 500000)
      }
    }));

    logger.info(`\nLoaded ${groupsArray.length} groups from config`);

    // Sync each group to Keycloak
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const group of groupsArray) {
      try {
        logger.info(`\nProcessing group: ${group.path}`);

        // Check if group already exists
        const existingGroups = await keycloakSync.getGroups();
        const existing = existingGroups.find(g => g.path === group.path);

        if (dryRun) {
          if (existing) {
            logger.info(`  [DRY RUN] Would update group ${group.path}`);
            updated++;
          } else {
            logger.info(`  [DRY RUN] Would create group ${group.path}`);
            created++;
          }
        } else {
          if (existing) {
            // Update existing group attributes
            await keycloakSync.setGroupModelAccess(group.path, group.attributes || {});
            logger.info(`  ✓ Updated group ${group.path}`);
            updated++;
          } else {
            // Create new group directly via Keycloak Admin Client
            await keycloakSync.kcAdminClient.groups.create({
              name: group.name,
              path: group.path,
              attributes: group.attributes || {}
            });
            logger.info(`  ✓ Created group ${group.path}`);
            created++;
          }
        }

      } catch (error) {
        logger.error(`  ✗ Failed to sync group ${group.path}:`, error.message);
        errors++;
      }
    }

    logger.info('\n' + '='.repeat(60));
    logger.info('Sync Results:');
    logger.info(`  ✓ Created: ${created}`);
    logger.info(`  ✓ Updated: ${updated}`);
    logger.info(`  ✗ Errors: ${errors}`);
    logger.info('='.repeat(60));

    // Update realm-export.json for fresh deployments
    if (!dryRun && (created > 0 || updated > 0)) {
      try {
        logger.info('\nUpdating realm-export.json...');
        await updateRealmExport(groupsArray);
        logger.info('✓ realm-export.json updated successfully');
      } catch (realmError) {
        logger.warn('Failed to update realm-export.json:', realmError.message);
        logger.warn('This will not affect runtime, but fresh deployments may need manual sync');
      }
    }

    if (dryRun) {
      logger.info('✓ DRY RUN COMPLETE - No changes were applied');
    } else {
      logger.info('✓ GROUPS SYNC COMPLETE');
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
syncGroups();