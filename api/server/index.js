require('dotenv').config();
const fs = require('fs');
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..') });
const cors = require('cors');
const axios = require('axios');
const express = require('express');
const https = require('https');
const passport = require('passport');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { logger } = require('@librechat/data-schemas');
const mongoSanitize = require('express-mongo-sanitize');
const { isEnabled, ErrorController } = require('@librechat/api');
const { connectDb, indexSync } = require('~/db');
const validateImageRequest = require('./middleware/validateImageRequest');
const { ldapLogin, passportLogin } = require('~/strategies');
const { checkMigrations } = require('./services/start/migration');
const initializeMCPs = require('./services/initializeMCPs');
const configureSocialLogins = require('./socialLogins');
const AppService = require('./services/AppService');
const KeycloakSyncService = require('./services/KeycloakSyncService');
const { keycloakSync } = require('./services/ModelAccess/KeycloakSync');
const staticCache = require('./utils/staticCache');
const noIndex = require('./middleware/noIndex');
const routes = require('./routes');

const { PORT, HOST, ALLOW_SOCIAL_LOGIN, DISABLE_COMPRESSION, TRUST_PROXY } = process.env ?? {};

// Allow PORT=0 to be used for automatic free port assignment
const port = isNaN(Number(PORT)) ? 3080 : Number(PORT);
const host = HOST || 'localhost';
const trusted_proxy = Number(TRUST_PROXY) || 1; /* trust first proxy by default */

const app = express();

/**
 * Runs startup initialization tasks in the correct order:
 * 1. Config sync from YAML files
 * 2. Expire old runtime overrides
 * 3. Check migrations
 * 4. Start Keycloak sync service
 * 5. Initialize token-based model access control
 */
const runStartupInitialization = async () => {
  // ===== Config Sync from YAML Files =====
  try {
    logger.info('[Startup] Syncing configuration from YAML files...');
    const { yamlConfigLoader } = require('~/server/services/Config/YAMLConfigLoader');
    const { configMerger } = require('~/server/services/ModelAccess/ConfigMerger');

    // Check if config files exist
    const configExists = yamlConfigLoader.checkConfigExists();

    if (configExists.modelAccess) {
      // Sync model access rules to MongoDB
      const syncResult = await yamlConfigLoader.syncModelAccessToDatabase(false);
      logger.info(`[Startup] Model access sync: ${syncResult.synced} rules synced, ${syncResult.errors} errors`);

      if (syncResult.errors > 0) {
        logger.warn('[Startup] Some model access rules failed to sync. Check logs for details.');
      }
    } else {
      logger.warn('[Startup] model-access.yaml not found. Using existing database configuration.');
    }

    // Expire old runtime overrides
    const expired = await configMerger.expireOverrides();
    if (expired > 0) {
      logger.info(`[Startup] Expired ${expired} old runtime overrides`);
    }

  } catch (configError) {
    logger.error('[Startup] Failed to sync configuration:', configError);
    logger.warn('[Startup] Continuing with existing database configuration');
    // Don't exit - can continue with existing DB state
  }

  // ===== Existing Initialization =====
  checkMigrations();
  // Start Keycloak sync service
  KeycloakSyncService.start();
  // Initialize token-based model access control - MUST succeed if Keycloak enabled
  await keycloakSync.initialize();
};

const startServer = async () => {
  logger.info('Starting server initialization...');
  if (typeof Bun !== 'undefined') {
    axios.defaults.headers.common['Accept-Encoding'] = 'gzip';
  }
  logger.info('About to connect to database...');
  await connectDb();

  logger.info('Connected to MongoDB');
  indexSync().catch((err) => {
    logger.error('[indexSync] Background sync failed:', err);
  });

  app.disable('x-powered-by');
  app.set('trust proxy', trusted_proxy);

  await AppService(app);

  const indexPath = path.join(app.locals.paths.dist, 'index.html');
  const indexHTML = fs.readFileSync(indexPath, 'utf8');

  app.get('/health', (_req, res) => res.status(200).send('OK'));

  /* Middleware */
  app.use(noIndex);
  app.use(express.json({ limit: '3mb' }));
  app.use(express.urlencoded({ extended: true, limit: '3mb' }));
  app.use(mongoSanitize());
  app.use(cors());
  app.use(cookieParser());

  if (!isEnabled(DISABLE_COMPRESSION)) {
    app.use(compression());
  } else {
    console.warn('Response compression has been disabled via DISABLE_COMPRESSION.');
  }

  // Serve static assets with aggressive caching
  app.use(staticCache(app.locals.paths.dist));
  app.use(staticCache(app.locals.paths.fonts));
  app.use(staticCache(app.locals.paths.assets));

  if (!ALLOW_SOCIAL_LOGIN) {
    console.warn('Social logins are disabled. Set ALLOW_SOCIAL_LOGIN=true to enable them.');
  }

  /* OAUTH */
  app.use(passport.initialize());
  // Legacy JWT removed - using only Keycloak JWT via openidJwt strategy
  passport.use(passportLogin());

  /* LDAP Auth */
  if (process.env.LDAP_URL && process.env.LDAP_USER_SEARCH_BASE) {
    passport.use(ldapLogin);
  }

  if (isEnabled(ALLOW_SOCIAL_LOGIN)) {
    try {
      await configureSocialLogins(app);
    } catch (error) {
      logger.error(`Social login configuration failed: ${error.message}`);
      logger.info('Continuing with server startup without social logins');
    }
  }

  app.use('/oauth', routes.oauth);
  /* API Endpoints */
  // SECURITY: Add model access control to chat endpoint FIRST
  const { enforceModelAccess, logSuccessfulRequest } = require('./middleware/modelAccessControl');
  app.use('/api/ask', enforceModelAccess, logSuccessfulRequest);

  app.use('/api/auth', routes.auth);
  app.use('/api/actions', routes.actions);
  app.use('/api/keys', routes.keys);
  app.use('/api/user', routes.user);
  app.use('/api/search', routes.search);
  app.use('/api/edit', routes.edit);
  app.use('/api/messages', routes.messages);
  app.use('/api/convos', routes.convos);
  app.use('/api/presets', routes.presets);
  app.use('/api/prompts', routes.prompts);
  app.use('/api/categories', routes.categories);
  app.use('/api/tokenizer', routes.tokenizer);
  app.use('/api/endpoints', routes.endpoints);
  app.use('/api/balance', routes.balance);
  app.use('/api/models', routes.models);
  // app.use('/api/plugins', routes.plugins); // Disabled plugin APIs
  app.use('/api/config', routes.config);
  // app.use('/api/assistants', routes.assistants); // Disabled assistants APIs
  app.use('/api/files', await routes.files.initialize());
  app.use('/images/', validateImageRequest, routes.staticRoute);
  app.use('/api/share', routes.share);
  app.use('/api/roles', routes.roles);
  app.use('/api/agents', routes.agents);
  app.use('/api/banner', routes.banner);
  app.use('/api/memories', routes.memories);
  app.use('/api/permissions', routes.accessPermissions);
  app.use('/api/integration', routes.integration);
  app.use('/api/model-access', routes.modelAccess);
  app.use('/api/admin/group-keys', routes.groupKeys);

  app.use('/api/tags', routes.tags);
  app.use('/api/mcp', routes.mcp);

  app.use(ErrorController);

  app.use((req, res) => {
    res.set({
      'Cache-Control': process.env.INDEX_CACHE_CONTROL || 'no-cache, no-store, must-revalidate',
      Pragma: process.env.INDEX_PRAGMA || 'no-cache',
      Expires: process.env.INDEX_EXPIRES || '0',
    });

    const lang = req.cookies.lang || req.headers['accept-language']?.split(',')[0] || 'en-US';
    const saneLang = lang.replace(/"/g, '&quot;');
    const updatedIndexHtml = indexHTML.replace(/lang="en-US"/g, `lang="${saneLang}"`);
    res.type('html');
    res.send(updatedIndexHtml);
  });

  logger.info('Reached server startup section');
  // Check if HTTPS is enabled
  const useHttps = process.env.HTTPS === 'true';
  logger.info(`HTTPS configuration: enabled=${useHttps}`);

  if (useHttps) {
    try {
      logger.info(`Loading SSL certificates from ${process.env.HTTPS_KEY_PATH} and ${process.env.HTTPS_CERT_PATH}`);
      const httpsOptions = {
        key: fs.readFileSync(process.env.HTTPS_KEY_PATH || '/app/ssl/librechat.key'),
        cert: fs.readFileSync(process.env.HTTPS_CERT_PATH || '/app/ssl/librechat.crt')
      };
      logger.info('SSL certificates loaded successfully');

      // Start HTTPS server on the same port
      https.createServer(httpsOptions, app).listen(port, host, () => {
        if (host === '0.0.0.0') {
          logger.info(
            `HTTPS server listening on all interfaces at port ${port}. Use https://localhost:${port} to access it`,
          );
        } else {
          logger.info(`HTTPS server listening at https://${host == '0.0.0.0' ? 'localhost' : host}:${port}`);
        }

        initializeMCPs(app).then(async () => {
          await runStartupInitialization();
        }).catch((error) => {
          logger.error('Critical initialization failure:', error);
          process.exit(1);
        });
      });

    } catch (error) {
      logger.error(`Failed to start HTTPS server: ${error.message}`);
      logger.info('Falling back to HTTP server');

      app.listen(port, host, () => {
        if (host === '0.0.0.0') {
          logger.info(
            `Server listening on all interfaces at port ${port}. Use http://localhost:${port} to access it`,
          );
        } else {
          logger.info(`Server listening at http://${host == '0.0.0.0' ? 'localhost' : host}:${port}`);
        }

        initializeMCPs(app).then(async () => {
          await runStartupInitialization();
        }).catch((error) => {
          logger.error('Critical initialization failure:', error);
          process.exit(1);
        });
      });
    }
  } else {
    app.listen(port, host, () => {
      if (host === '0.0.0.0') {
        logger.info(
          `Server listening on all interfaces at port ${port}. Use http://localhost:${port} to access it`,
        );
      } else {
        logger.info(`Server listening at http://${host == '0.0.0.0' ? 'localhost' : host}:${port}`);
      }

      initializeMCPs(app).then(async () => {
        checkMigrations();
        // Start Keycloak sync service
        KeycloakSyncService.start();
        // Initialize token-based model access control - MUST succeed if Keycloak enabled
        await keycloakSync.initialize();
      }).catch((error) => {
        logger.error('Critical initialization failure:', error);
        process.exit(1);
      });
    });
  }
};

logger.info('About to call startServer()...');
startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

let messageCount = 0;
process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    logger.error('There was an uncaught error:', err);
  }

  if (err.message.includes('abort')) {
    logger.warn('There was an uncatchable AbortController error.');
    return;
  }

  if (err.message.includes('GoogleGenerativeAI')) {
    logger.warn(
      '\n\n`GoogleGenerativeAI` errors cannot be caught due to an upstream issue, see: https://github.com/google-gemini/generative-ai-js/issues/303',
    );
    return;
  }

  if (err.message.includes('fetch failed')) {
    if (messageCount === 0) {
      logger.warn('Meilisearch error, search will be disabled');
      messageCount++;
    }

    return;
  }

  if (err.message.includes('OpenAIError') || err.message.includes('ChatCompletionMessage')) {
    logger.error(
      '\n\nAn Uncaught `OpenAIError` error may be due to your reverse-proxy setup or stream configuration, or a bug in the `openai` node package.',
    );
    return;
  }

  process.exit(1);
});

/** Export app for easier testing purposes */
module.exports = app;
