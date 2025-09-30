#!/usr/bin/env node

/**
 * Sync All Configurations
 *
 * Runs all sync scripts in the correct order:
 * 1. Sync groups to Keycloak
 * 2. Sync model access rules to MongoDB
 * 3. Sync API keys to MongoDB
 *
 * Usage:
 *   node config/sync-all.js            # Sync everything
 *   node config/sync-all.js --dry-run  # Preview changes
 *   node config/sync-all.js --clean    # Clean up stale rules
 */

require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const clean = args.includes('--clean');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
Sync All Configurations

Syncs groups.yaml, model-access.yaml, and keys.json to Keycloak and MongoDB.

Usage:
  node config/sync-all.js [options]

Options:
  --dry-run    Preview changes without applying them
  --clean      Remove stale git-sourced rules and keys
  --help, -h   Show this help message

Examples:
  node config/sync-all.js
  node config/sync-all.js --dry-run
  node config/sync-all.js --clean
`);
  process.exit(0);
}

/**
 * Run a script and wait for it to complete
 */
function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${scriptName}`);
    console.log('='.repeat(60));

    const child = spawn('node', [path.join(__dirname, scriptName), ...args], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptName} exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function syncAll() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('SYNC ALL CONFIGURATIONS');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be applied\n');
    }

    const startTime = Date.now();

    // Step 1: Sync groups to Keycloak
    const groupArgs = [];
    if (dryRun) groupArgs.push('--dry-run');

    await runScript('sync-groups.js', groupArgs);

    // Step 2: Sync model access to MongoDB
    const modelArgs = [];
    if (dryRun) modelArgs.push('--dry-run');
    if (clean) modelArgs.push('--clean');

    await runScript('sync-model-access.js', modelArgs);

    // Step 3: Sync API keys to MongoDB
    const keyArgs = [];
    if (dryRun) keyArgs.push('--dry-run');
    if (clean) keyArgs.push('--clean');

    await runScript('sync-keys.js', keyArgs);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('✓ ALL CONFIGURATIONS SYNCED SUCCESSFULLY');
    console.log(`  Duration: ${duration}s`);
    console.log('='.repeat(60));

    process.exit(0);

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ SYNC FAILED');
    console.error('Error:', error.message);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

// Run sync
syncAll();