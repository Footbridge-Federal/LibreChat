const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { ModelAccess } = require('~/db/models');
const { logger } = require('~/config');

const router = express.Router();

/**
 * TEMPORARY: Populate ModelAccess table for testing
 * This route will be removed once the architecture overhaul is complete
 */
router.post('/populate-test-data', requireJwtAuth, async (req, res) => {
  try {
    logger.info('[TestModelAccess] Populating test data...');

    // Clear existing
    await ModelAccess.deleteMany({});

    // Create access rules for /org-airwall group
    const rules = [
      {
        type: 'group',
        subject: '/org-airwall',
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 8000,
        maxOutputTokens: 4000,
        temperatureMax: 1.0,
        requestsPerMinute: 60,
        tokensPerDay: 33333,
        monthlyTokenLimit: 1000000,
        keySource: 'preconfigured',
        keyRef: 'airwall_openai',
        active: true,
        createdBy: 'test',
        description: 'Test: OpenAI GPT-4o-mini for Airwall organization'
      },
      {
        type: 'group',
        subject: '/org-airwall',
        provider: 'anthropic',
        model: 'claude-3.5',
        maxTokens: 8000,
        maxOutputTokens: 4000,
        temperatureMax: 1.0,
        requestsPerMinute: 60,
        tokensPerDay: 33333,
        monthlyTokenLimit: 1000000,
        keySource: 'preconfigured',
        keyRef: 'airwall_anthropic',
        active: true,
        createdBy: 'test',
        description: 'Test: Anthropic Claude 3.5 for Airwall organization'
      }
    ];

    const insertedRules = await ModelAccess.insertMany(rules);

    logger.info(`[TestModelAccess] Created ${insertedRules.length} test access rules`);

    res.json({
      success: true,
      message: `Created ${insertedRules.length} test access rules`,
      rules: insertedRules.map(r => ({
        subject: r.subject,
        provider: r.provider,
        model: r.model
      }))
    });

  } catch (error) {
    logger.error('[TestModelAccess] Error populating test data:', error);
    res.status(500).json({
      error: 'Failed to populate test data',
      message: error.message
    });
  }
});

/**
 * TEMPORARY: View current ModelAccess data
 */
router.get('/view-data', requireJwtAuth, async (req, res) => {
  try {
    const rules = await ModelAccess.find({});

    res.json({
      success: true,
      count: rules.length,
      rules: rules.map(r => ({
        subject: r.subject,
        type: r.type,
        provider: r.provider,
        model: r.model,
        active: r.active,
        createdBy: r.createdBy
      }))
    });

  } catch (error) {
    logger.error('[TestModelAccess] Error viewing data:', error);
    res.status(500).json({
      error: 'Failed to view data',
      message: error.message
    });
  }
});

module.exports = router;