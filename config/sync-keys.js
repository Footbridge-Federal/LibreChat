#!/usr/bin/env node

/**
 * Sync Group API Keys Configuration
 *
 * Syncs keys.json (ground truth) to encrypted database storage.
 * Similar to how groups.yaml → Keycloak and model-access.yaml → MongoDB.
 *
 * Usage:
 *   node config/sync-keys.js                    # Sync keys.json to database
 *   node config/sync-keys.js --dry-run          # Preview what would be synced
 *   node config/sync-keys.js --clean            # Remove keys not in keys.json
 */

require('dotenv').config();
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });

const fs = require('fs');
const { connectDb } = require('../api/db');
const { KeyVault } = require('../api/server/services/ModelAccess/KeyVault');
const { GroupApiKey } = require('../api/db/models');
const { logger } = require('../api/config');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const clean = args.includes('--clean');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Sync Group API Keys Configuration

Syncs keys.json (ground truth) to encrypted database storage.

Usage:
  node config/sync-keys.js [options]

Options:
  --dry-run    Preview changes without applying them
  --clean      Remove keys from DB that aren't in keys.json
  --help, -h   Show this help message

Examples:
  node config/sync-keys.js
  node config/sync-keys.js --dry-run
  node config/sync-keys.js --clean

Keys File Format (config/keys.json):
  [
    {
      "keyRef": "group_org_airwall",
      "groupPath": "/org-airwall",
      "provider": "openai",
      "apiKey": "sk-..."
    },
    {
      "keyRef": "group_org_partner",
      "groupPath": "/org-partner",
      "provider": "anthropic",
      "apiKey": "sk-ant-..."
    }
  ]

Environment Variables:
  CONFIG_DIR              Config directory (default: ./config)
`);
  process.exit(0);
}

/**
 * Parse environment variable name to extract keyRef and provider
 */
function parseEnvVarName(envVarName) {
  // Remove common suffixes
  let normalized = envVarName
    .replace(/_API_KEY$/, '')
    .replace(/_KEY$/, '');

  // Extract provider (last component)
  const parts = normalized.split('_');
  if (parts.length < 2) {
    return null;
  }

  const provider = parts.pop().toLowerCase();
  const groupName = parts.join('_').toLowerCase();

  // Build keyRef
  const keyRef = `group_org_${groupName}`;
  const groupPath = `/org-${groupName}`;

  return {
    keyRef,
    groupPath,
    provider,
    envVarName
  };
}

/**
 * Scan environment variables for API keys
 */
function scanEnvVars() {
  const patterns = [
    /_OPENAI_API_KEY$/,
    /_ANTHROPIC_API_KEY$/,
    /_BEDROCK_KEY$/,
    /_AWS_ACCESS_KEY_ID$/
  ];

  const found = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (patterns.some(p => p.test(key))) {
      const parsed = parseEnvVarName(key);
      if (parsed && value) {
        found.push({
          ...parsed,
          apiKey: value
        });
      }
    }
  }

  return found;
}

/**
 * Load keys from JSON file (ground truth)
 */
function loadKeysConfig() {
  const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..');
  const keysPath = path.join(configDir, 'config', 'keys.json');

  try {
    if (!fs.existsSync(keysPath)) {
      logger.warn(`[KeysSync] keys.json not found at: ${keysPath}`);
      return [];
    }

    const content = fs.readFileSync(keysPath, 'utf8');
    const keys = JSON.parse(content);

    if (!Array.isArray(keys)) {
      throw new Error('keys.json must contain an array of keys');
    }

    // Validate format
    for (const key of keys) {
      if (!key.keyRef || !key.groupPath || !key.provider || !key.apiKey) {
        throw new Error('Invalid key format: missing required fields (keyRef, groupPath, provider, apiKey)');
      }
    }

    logger.info(`[KeysSync] Loaded ${keys.length} keys from keys.json`);
    return keys;

  } catch (error) {
    logger.error('[KeysSync] Error loading keys.json:', error);
    throw error;
  }
}

/**
 * Main sync function
 */
async function syncKeys() {
  try {
    console.log('='.repeat(60));
    console.log('SYNC GROUP API KEYS CONFIGURATION');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be applied\n');
    }

    // Connect to database
    await connectDb();
    logger.info('✓ Connected to MongoDB\n');

    // Load keys from config file (ground truth)
    const keysFromConfig = loadKeysConfig();

    if (keysFromConfig.length === 0) {
      logger.warn('⚠️  No keys found in config/keys.json');
      logger.info('Tip: Create config/keys.json with your API keys (see keys.json.example)');
      process.exit(0);
    }

    logger.info(`Found ${keysFromConfig.length} keys in config/keys.json\n`);

    const keyVault = new KeyVault();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Sync each key
    for (const keyData of keysFromConfig) {
      try {
        logger.info(`Processing: ${keyData.keyRef}/${keyData.provider}`);

        // Check if already exists
        const existing = await GroupApiKey.findOne({
          keyRef: keyData.keyRef,
          provider: keyData.provider,
          isActive: true
        });

        if (existing) {
          // Key exists - check if it needs update
          const existingDecrypted = keyVault._decrypt(existing.encryptedKey);

          if (existingDecrypted === keyData.apiKey) {
            // Same key, no update needed
            if (dryRun) {
              logger.info(`  [DRY RUN] Would skip (already synced)`);
            } else {
              logger.info(`  ⏭️  Skipped (already synced)`);
            }
            skipped++;
          } else {
            // Key changed - update it
            if (dryRun) {
              logger.info(`  [DRY RUN] Would update key (changed in config)`);
            } else {
              // Deactivate old key
              existing.isActive = false;
              await existing.save();

              // Create new key
              await keyVault.storeGroupKey(
                keyData.keyRef,
                keyData.groupPath,
                keyData.provider,
                keyData.apiKey,
                {
                  reason: 'Updated from keys.json',
                  source: 'git',
                  rotatedFrom: existing._id
                }
              );
              logger.info(`  🔄 Updated successfully`);
            }
            updated++;
          }
        } else {
          // New key - create it
          if (dryRun) {
            logger.info(`  [DRY RUN] Would create key`);
            logger.info(`    - keyRef: ${keyData.keyRef}`);
            logger.info(`    - groupPath: ${keyData.groupPath}`);
            logger.info(`    - provider: ${keyData.provider}`);
            logger.info(`    - keyPrefix: ${keyData.apiKey.substring(0, 8)}***`);
          } else {
            await keyVault.storeGroupKey(
              keyData.keyRef,
              keyData.groupPath,
              keyData.provider,
              keyData.apiKey,
              {
                reason: 'Synced from keys.json',
                source: 'git'
              }
            );
            logger.info(`  ✅ Created successfully`);
          }
          created++;
        }

      } catch (error) {
        logger.error(`  ❌ Error: ${error.message}`);
        errors++;
      }
    }

    // Clean up stale keys (if --clean flag)
    let deleted = 0;
    if (clean && !dryRun) {
      logger.info('\n🧹 Cleaning up keys not in keys.json...');

      const configKeyRefs = new Set(
        keysFromConfig.map(k => `${k.keyRef}:${k.provider}`)
      );

      const allDbKeys = await GroupApiKey.find({
        isActive: true,
        source: 'git'  // Only clean up git-sourced keys
      });

      for (const dbKey of allDbKeys) {
        const dbKeyRef = `${dbKey.keyRef}:${dbKey.provider}`;
        if (!configKeyRefs.has(dbKeyRef)) {
          logger.info(`  Removing: ${dbKey.keyRef}/${dbKey.provider} (not in config)`);
          dbKey.isActive = false;
          await dbKey.save();
          deleted++;
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SYNC SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total keys in config:  ${keysFromConfig.length}`);
    console.log(`Created:               ${created}`);
    console.log(`Updated:               ${updated}`);
    console.log(`Skipped (unchanged):   ${skipped}`);
    console.log(`Deleted (cleaned):     ${deleted}`);
    console.log(`Errors:                ${errors}`);
    console.log('='.repeat(60));

    if (dryRun) {
      console.log('\n✓ DRY RUN COMPLETE - No changes were applied');
      console.log('Run without --dry-run to sync keys');
    } else {
      console.log('\n✓ KEYS SYNC COMPLETE');
    }
    console.log('='.repeat(60));

    process.exit(errors > 0 ? 1 : 0);

  } catch (error) {
    logger.error('\n❌ SYNC FAILED');
    logger.error('Error:', error.message);
    logger.error(error.stack);
    process.exit(1);
  }
}

syncKeys();