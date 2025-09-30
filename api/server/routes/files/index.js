const fs = require('fs');
const express = require('express');
const { uaParser, checkBan, requireJwtAuth, createFileLimiters } = require('~/server/middleware');
const { avatar: asstAvatarRouter } = require('~/server/routes/assistants/v1');
const { avatar: agentAvatarRouter } = require('~/server/routes/agents/v1');
const { createMulterInstance } = require('./multer');
const { enforceRAGAccess, attachRAGUsage } = require('~/server/middleware/ragAccessControl');
const { logger } = require('~/config');

const files = require('./files');
const images = require('./images');
const avatar = require('./avatar');
const speech = require('./speech');

/**
 * Middleware wrapper for RAG access control with automatic file cleanup
 * Ensures orphaned files are deleted if RAG check fails
 */
const enforceRAGAccessWithCleanup = async (req, res, next) => {
  try {
    // Run RAG access check
    await enforceRAGAccess(req, res, (err) => {
      if (err) {
        // Clean up uploaded file if it exists
        if (req.file?.path) {
          try {
            fs.unlinkSync(req.file.path);
            logger.debug(`[RAGAccess] Cleaned up orphaned file: ${req.file.path}`);
          } catch (cleanupError) {
            logger.warn('[RAGAccess] Failed to cleanup orphaned file:', cleanupError);
          }
        }
        return next(err);
      }
      next();
    });
  } catch (error) {
    // Clean up file on unexpected error
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
        logger.debug(`[RAGAccess] Cleaned up file after error: ${req.file.path}`);
      } catch (cleanupError) {
        logger.warn('[RAGAccess] Failed to cleanup file after error:', cleanupError);
      }
    }

    logger.error('[RAGAccess] Unexpected error in RAG access check:', error);
    res.status(500).json({
      error: 'RAG access check failed',
      code: 'RAG_CHECK_ERROR',
      message: 'An error occurred while checking file upload permissions'
    });
  }
};

const initialize = async () => {
  const router = express.Router();
  router.use(requireJwtAuth);
  router.use(checkBan);
  router.use(uaParser);

  const upload = await createMulterInstance();
  router.post('/speech/stt', upload.single('audio'));

  /* Important: speech route must be added before the upload limiters */
  router.use('/speech', speech);

  const { fileUploadIpLimiter, fileUploadUserLimiter } = createFileLimiters();
  router.post('*', fileUploadIpLimiter, fileUploadUserLimiter);

  // Document upload with RAG access control
  // Note: RAG middleware runs AFTER multer so we can check file size/type
  router.post('/',
    upload.single('file'),
    enforceRAGAccessWithCleanup  // Check RAG permissions + cleanup on failure
  );

  // Image uploads (no RAG check - different quota system)
  router.post('/images', upload.single('file'));
  router.post('/images/avatar', upload.single('file'));
  router.post('/images/agents/:agent_id/avatar', upload.single('file'));
  router.post('/images/assistants/:assistant_id/avatar', upload.single('file'));

  router.use('/', files);
  router.use('/images', images);
  router.use('/images/avatar', avatar);
  router.use('/images/agents', agentAvatarRouter);
  router.use('/images/assistants', asstAvatarRouter);
  return router;
};

module.exports = { initialize };
