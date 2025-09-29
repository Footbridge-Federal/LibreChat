const { ModelAccess } = require('~/db/models');
const { logger } = require('~/config');

/**
 * Migration script to populate the new simple ModelAccess table
 * with your current JWT group configuration
 */
async function migrateToSimpleModelAccess() {
  try {
    logger.info('[Migration] Starting migration to SimpleModelAccess');

    // Clear existing data
    await ModelAccess.deleteMany({});
    logger.info('[Migration] Cleared existing ModelAccess data');

    // Your current environment variable mappings
    const groupConfigs = [
      {
        groupPath: '/org-airwall',
        models: process.env.AIRWALL_ORG_MODELS_ALLOW?.split(',').map(m => m.trim()) || ['openai/gpt-4o-mini', 'anthropic/claude-3.5'],
        maxTokens: parseInt(process.env.AIRWALL_ORG_MAX_TOKENS) || 8000,
        maxOutputTokens: parseInt(process.env.AIRWALL_ORG_MAX_OUTPUT_TOKENS) || 4000,
        monthlyLimit: parseInt(process.env.AIRWALL_ORG_MONTHLY_LIMIT) || 1000000,
        rateLimit: parseInt(process.env.AIRWALL_ORG_RATE_LIMIT) || 60,
        keyRef: 'airwall_openai'
      },
      {
        groupPath: '/org-partner',
        models: process.env.PARTNER_ORG_MODELS_ALLOW?.split(',').map(m => m.trim()) || ['openai/gpt-4o-mini'],
        maxTokens: parseInt(process.env.PARTNER_ORG_MAX_TOKENS) || 4000,
        maxOutputTokens: parseInt(process.env.PARTNER_ORG_MAX_OUTPUT_TOKENS) || 2000,
        monthlyLimit: parseInt(process.env.PARTNER_ORG_MONTHLY_LIMIT) || 500000,
        rateLimit: parseInt(process.env.PARTNER_ORG_RATE_LIMIT) || 30,
        keyRef: 'partner_openai'
      }
    ];

    const accessRules = [];

    for (const config of groupConfigs) {
      logger.info(`[Migration] Processing group: ${config.groupPath}`);

      for (const modelId of config.models) {
        const [provider, model] = modelId.split('/');

        if (!provider || !model) {
          logger.warn(`[Migration] Invalid model format: ${modelId}`);
          continue;
        }

        const accessRule = {
          type: 'group',
          subject: config.groupPath,
          provider: provider.toLowerCase(), // Normalize to lowercase
          model: model,
          maxTokens: config.maxTokens,
          maxOutputTokens: config.maxOutputTokens,
          temperatureMax: 1.0,
          requestsPerMinute: config.rateLimit,
          tokensPerDay: Math.floor(config.monthlyLimit / 30),
          monthlyTokenLimit: config.monthlyLimit,
          keySource: 'preconfigured',
          keyRef: config.keyRef,
          active: true,
          createdBy: 'migration',
          description: `Migrated from ${config.groupPath} environment configuration`
        };

        accessRules.push(accessRule);
        logger.info(`[Migration] Created rule: ${provider}/${model} for ${config.groupPath}`);
      }
    }

    // Insert all access rules
    if (accessRules.length > 0) {
      await ModelAccess.insertMany(accessRules);
      logger.info(`[Migration] Inserted ${accessRules.length} access rules`);
    }

    // Log what was created
    const allRules = await ModelAccess.find({});
    logger.info('[Migration] Final ModelAccess rules:');
    for (const rule of allRules) {
      logger.info(`  ${rule.subject} -> ${rule.provider}/${rule.model}`);
    }

    logger.info('[Migration] Migration completed successfully!');
    return true;

  } catch (error) {
    logger.error('[Migration] Migration failed:', error);
    return false;
  }
}

/**
 * CLI runner for the migration
 */
if (require.main === module) {
  (async () => {
    // Connect to database
    const { connectDb } = require('~/db');
    await connectDb();

    const success = await migrateToSimpleModelAccess();
    process.exit(success ? 0 : 1);
  })();
}

module.exports = { migrateToSimpleModelAccess };