const { logger } = require('~/config');
const { ModelAccess } = require('~/db/models');
const { File } = require('~/db/models');
const { configMerger } = require('~/server/services/ModelAccess/ConfigMerger');

/**
 * Middleware to enforce RAG/file upload access control
 * Must be applied to all file upload and RAG endpoints
 */
async function enforceRAGAccess(req, res, next) {
  try {
    const startTime = Date.now();

    // Extract user info from token
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // Get user's groups from JWT token
    const jwtGroups = user.token_claims?.groups || [];
    if (!jwtGroups.length) {
      return res.status(403).json({
        error: 'No group membership found',
        code: 'NO_GROUPS',
        message: 'You must be a member of at least one organization to use RAG features'
      });
    }

    logger.debug(`[RAGAccess] Checking RAG permissions for user ${user.id} (groups: ${jwtGroups.join(', ')})`);

    // Find the most permissive RAG configuration across all user's groups
    let bestPermissions = null;
    let bestPermissionsGroup = null;

    for (const group of jwtGroups) {
      const groupConfigs = await configMerger.getAllEffectiveConfigs(group, 'group');

      // Find any config with RAG enabled
      const ragConfig = groupConfigs.find(c => c.ragEnabled === true && c.active === true);

      if (ragConfig) {
        // Use the config with the highest quota (most permissive)
        if (!bestPermissions || ragConfig.ragStorageQuotaMB > bestPermissions.ragStorageQuotaMB) {
          bestPermissions = ragConfig;
          bestPermissionsGroup = group;
        }
      }
    }

    if (!bestPermissions) {
      return res.status(403).json({
        error: 'RAG/file upload not enabled',
        code: 'RAG_ACCESS_DENIED',
        message: 'RAG and file upload features are not enabled for your organization. Contact your administrator.'
      });
    }

    logger.debug(`[RAGAccess] Using RAG permissions from group ${bestPermissionsGroup}`);

    // ========== CHECK STORAGE QUOTA ==========
    const userStorage = await File.aggregate([
      { $match: { user: user.id } },
      { $group: { _id: null, totalBytes: { $sum: '$bytes' } } }
    ]);

    const usedBytes = userStorage[0]?.totalBytes || 0;
    const usedMB = usedBytes / (1024 * 1024);
    const quotaMB = bestPermissions.ragStorageQuotaMB || 100;

    if (usedMB >= quotaMB) {
      return res.status(413).json({
        error: 'Storage quota exceeded',
        code: 'STORAGE_QUOTA_EXCEEDED',
        quota_mb: quotaMB,
        used_mb: parseFloat(usedMB.toFixed(2)),
        message: `You have used ${usedMB.toFixed(2)} MB of your ${quotaMB} MB storage quota. Please delete some files to upload more.`
      });
    }

    // ========== CHECK FILE SIZE (if uploading) ==========
    if (req.file) {
      const fileSizeMB = req.file.size / (1024 * 1024);
      const maxSizeMB = bestPermissions.ragMaxFileSizeMB || 10;

      if (fileSizeMB > maxSizeMB) {
        return res.status(413).json({
          error: 'File too large',
          code: 'FILE_TOO_LARGE',
          max_size_mb: maxSizeMB,
          file_size_mb: parseFloat(fileSizeMB.toFixed(2)),
          message: `File size ${fileSizeMB.toFixed(2)} MB exceeds the maximum allowed size of ${maxSizeMB} MB`
        });
      }

      // Check file type
      const fileExt = req.file.originalname.split('.').pop().toLowerCase();
      const allowedTypes = bestPermissions.ragAllowedFileTypes || ['pdf', 'txt', 'docx', 'md'];

      if (!allowedTypes.includes(fileExt)) {
        return res.status(400).json({
          error: 'File type not allowed',
          code: 'FILE_TYPE_NOT_ALLOWED',
          file_extension: fileExt,
          allowed_types: allowedTypes,
          message: `File type .${fileExt} is not allowed. Allowed types: ${allowedTypes.join(', ')}`
        });
      }
    }

    // ========== CHECK EMBEDDING LIMIT ==========
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const embeddingsThisMonth = await File.countDocuments({
      user: user.id,
      embedded: true,
      createdAt: { $gte: currentMonth }
    });

    const embeddingLimit = bestPermissions.ragEmbeddingLimitPerMonth || 1000;

    if (embeddingsThisMonth >= embeddingLimit) {
      return res.status(429).json({
        error: 'Monthly embedding limit reached',
        code: 'EMBEDDING_LIMIT_EXCEEDED',
        limit: embeddingLimit,
        used: embeddingsThisMonth,
        message: `You have reached your monthly embedding limit of ${embeddingLimit}. Limit resets on the 1st of next month.`
      });
    }

    // ========== CHECK DOCUMENT COUNT ==========
    const userDocCount = await File.countDocuments({
      user: user.id
    });

    const maxDocuments = bestPermissions.ragMaxDocuments || 1000;

    if (userDocCount >= maxDocuments) {
      return res.status(429).json({
        error: 'Maximum document count reached',
        code: 'MAX_DOCUMENTS_EXCEEDED',
        limit: maxDocuments,
        used: userDocCount,
        message: `You have reached your maximum document limit of ${maxDocuments}. Please delete some documents to upload more.`
      });
    }

    // ========== CHECK VECTOR SEARCH PERMISSION (for search endpoints) ==========
    if (req.path.includes('/search') && !bestPermissions.ragVectorSearchEnabled) {
      return res.status(403).json({
        error: 'Vector search not enabled',
        code: 'VECTOR_SEARCH_DISABLED',
        message: 'Vector search is not enabled for your organization'
      });
    }

    // ========== ATTACH PERMISSIONS TO REQUEST ==========
    req.ragAuth = {
      permissions: bestPermissions,
      group: bestPermissionsGroup,
      usage: {
        storage_used_mb: parseFloat(usedMB.toFixed(2)),
        storage_quota_mb: quotaMB,
        storage_available_mb: parseFloat((quotaMB - usedMB).toFixed(2)),
        embeddings_this_month: embeddingsThisMonth,
        embedding_limit: embeddingLimit,
        embeddings_available: embeddingLimit - embeddingsThisMonth,
        document_count: userDocCount,
        max_documents: maxDocuments,
        documents_available: maxDocuments - userDocCount
      },
      authorization_time: Date.now() - startTime
    };

    logger.info(`[RAGAccess] Authorized user ${user.id} for RAG access (${req.ragAuth.authorization_time}ms)`);

    next();

  } catch (error) {
    logger.error('[RAGAccess] Authorization error:', error);

    return res.status(500).json({
      error: 'RAG authorization system error',
      code: 'RAG_AUTHORIZATION_ERROR',
      message: 'An error occurred while checking RAG permissions'
    });
  }
}

/**
 * Middleware to get RAG usage stats (doesn't enforce, just attaches info)
 * Use this for endpoints that need to show quotas but don't need enforcement
 */
async function attachRAGUsage(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return next();
    }

    const jwtGroups = user.token_claims?.groups || [];
    if (!jwtGroups.length) {
      return next();
    }

    // Find best RAG permissions
    let bestPermissions = null;
    let bestPermissionsGroup = null;

    for (const group of jwtGroups) {
      const groupConfigs = await configMerger.getAllEffectiveConfigs(group, 'group');
      const ragConfig = groupConfigs.find(c => c.ragEnabled === true && c.active === true);

      if (ragConfig) {
        if (!bestPermissions || ragConfig.ragStorageQuotaMB > bestPermissions.ragStorageQuotaMB) {
          bestPermissions = ragConfig;
          bestPermissionsGroup = group;
        }
      }
    }

    if (!bestPermissions) {
      req.ragUsage = null;
      return next();
    }

    // Get usage stats
    const userStorage = await File.aggregate([
      { $match: { user: user.id } },
      { $group: { _id: null, totalBytes: { $sum: '$bytes' } } }
    ]);

    const usedBytes = userStorage[0]?.totalBytes || 0;
    const usedMB = usedBytes / (1024 * 1024);

    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const embeddingsThisMonth = await File.countDocuments({
      user: user.id,
      embedded: true,
      createdAt: { $gte: currentMonth }
    });

    const userDocCount = await File.countDocuments({
      user: user.id
    });

    req.ragUsage = {
      enabled: true,
      group: bestPermissionsGroup,
      storage_used_mb: parseFloat(usedMB.toFixed(2)),
      storage_quota_mb: bestPermissions.ragStorageQuotaMB,
      embeddings_this_month: embeddingsThisMonth,
      embedding_limit: bestPermissions.ragEmbeddingLimitPerMonth,
      document_count: userDocCount,
      max_documents: bestPermissions.ragMaxDocuments,
      allowed_file_types: bestPermissions.ragAllowedFileTypes,
      max_file_size_mb: bestPermissions.ragMaxFileSizeMB,
      vector_search_enabled: bestPermissions.ragVectorSearchEnabled,
      retention_days: bestPermissions.ragRetentionDays
    };

    next();

  } catch (error) {
    logger.error('[RAGAccess] Error attaching RAG usage:', error);
    req.ragUsage = null;
    next();
  }
}

module.exports = {
  enforceRAGAccess,
  attachRAGUsage
};