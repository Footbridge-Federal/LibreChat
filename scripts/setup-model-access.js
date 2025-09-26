#!/usr/bin/env node

/**
 * Model Access Control Setup Script
 *
 * This script helps you set up the model access control system by:
 * 1. Generating encryption keys
 * 2. Encrypting and storing API keys securely
 * 3. Creating initial policy rules
 * 4. Syncing with Keycloak groups
 */

require('dotenv').config();
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Setup readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

function encryptApiKey(apiKey, encryptionKey) {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(algorithm, encryptionKey);
  cipher.setAAD(Buffer.from('librechat-api-key', 'utf8'));

  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex')
  };
}

function createVaultEntry(provider, encryptedKey) {
  return JSON.stringify({
    provider,
    encrypted_key: encryptedKey,
    created_at: new Date().toISOString()
  });
}

async function main() {
  console.log('\n🔐 LibreChat Model Access Control Setup\n');
  console.log('This script will help you set up secure model access control.\n');

  // Check if encryption key exists
  let encryptionKey = process.env.API_KEY_ENCRYPTION_KEY;

  if (!encryptionKey) {
    console.log('📝 Generating API key encryption key...');
    encryptionKey = generateEncryptionKey();
    console.log(`✅ Generated encryption key: ${encryptionKey}\n`);
    console.log('⚠️  Add this to your .env file:');
    console.log(`API_KEY_ENCRYPTION_KEY=${encryptionKey}\n`);
  } else {
    console.log('✅ Found existing encryption key in environment\n');
  }

  // Collect organization information
  console.log('🏢 Organization Setup\n');

  const airwallOrg = await question('Enter your organization name (default: airwall): ') || 'airwall';
  const partnerOrg = await question('Enter partner organization name (default: partner): ') || 'partner';

  // Collect API keys
  console.log('\n🔑 API Key Setup\n');

  const airwallOpenAIKey = await question(`Enter OpenAI API key for ${airwallOrg} org (or press enter to skip): `);
  const airwallAnthropicKey = await question(`Enter Anthropic API key for ${airwallOrg} org (or press enter to skip): `);
  const partnerOpenAIKey = await question(`Enter OpenAI API key for ${partnerOrg} org (or press enter to skip): `);

  // Generate encrypted keys
  const vaultEntries = {};

  if (airwallOpenAIKey) {
    const encrypted = encryptApiKey(airwallOpenAIKey, encryptionKey);
    vaultEntries[`VAULT_GROUP_ORG_${airwallOrg.toUpperCase()}`] = createVaultEntry('openai', encrypted);
    console.log(`✅ Encrypted OpenAI key for ${airwallOrg}`);
  }

  if (airwallAnthropicKey) {
    const encrypted = encryptApiKey(airwallAnthropicKey, encryptionKey);
    vaultEntries[`VAULT_GROUP_PREMIUM_USERS`] = createVaultEntry('anthropic', encrypted);
    console.log(`✅ Encrypted Anthropic key for premium users`);
  }

  if (partnerOpenAIKey) {
    const encrypted = encryptApiKey(partnerOpenAIKey, encryptionKey);
    vaultEntries[`VAULT_GROUP_ORG_${partnerOrg.toUpperCase()}`] = createVaultEntry('openai', encrypted);
    console.log(`✅ Encrypted OpenAI key for ${partnerOrg}`);
  }

  // Update existing .env and .env.secrets files
  console.log('\n📁 Updating configuration files...\n');

  // Update organization names in .env if different from defaults
  if (airwallOrg !== 'airwall' || partnerOrg !== 'partner') {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    envContent = envContent.replace('AIRWALL_ORG_NAME=airwall', `AIRWALL_ORG_NAME=${airwallOrg}`);
    envContent = envContent.replace('PARTNER_ORG_NAME=partner', `PARTNER_ORG_NAME=${partnerOrg}`);

    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Updated organization names in .env`);
  }

  // Add encrypted keys to .env.secrets
  if (Object.keys(vaultEntries).length > 0) {
    const secretsPath = path.join(process.cwd(), '.env.secrets');
    let secretsContent = fs.readFileSync(secretsPath, 'utf8');

    // Remove example entries if they exist
    secretsContent = secretsContent.replace(/# VAULT_GROUP_.*\n/g, '');

    // Add new encrypted keys
    secretsContent += '\n# Generated encrypted API keys\n';
    for (const [key, value] of Object.entries(vaultEntries)) {
      secretsContent += `${key}='${value}'\n`;
    }

    fs.writeFileSync(secretsPath, secretsContent);
    console.log('✅ Added encrypted API keys to .env.secrets');
  }

  console.log('\n🚀 Next Steps:\n');
  console.log('1. Generate your Keycloak realm configuration:');
  console.log('   cd keycloak && ./generate_realm.sh');
  console.log('2. Import the generated realm-export.json into Keycloak');
  console.log('3. Restart your LibreChat server');
  console.log('4. Test the setup by checking available models: GET /api/model-access/available');

  console.log('\n📋 Example Test Commands:\n');
  console.log('# Check what models are available for a user');
  console.log('curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3080/api/model-access/available');
  console.log('');
  console.log('# Explain why a user can/cannot access a specific model');
  console.log('curl -H "Authorization: Bearer YOUR_TOKEN" "http://localhost:3080/api/model-access/explain?model=gpt-4o&endpoint=openai"');
  console.log('');
  console.log('# Admin: View all policy rules');
  console.log('curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" http://localhost:3080/api/model-access/admin/policies');

  console.log('\n⚠️  Security Reminders:\n');
  console.log('- Never commit .env.secrets to version control');
  console.log('- Rotate API keys regularly');
  console.log('- Monitor access logs for unusual activity');
  console.log('- Use different keys for different environments');

  rl.close();
}

main().catch(console.error);