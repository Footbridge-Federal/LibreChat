const redis = require('redis');
const { logger } = require('@librechat/data-schemas');

// Redis client for rate limiting
let redisClient;

const initRedis = async () => {
  if (!redisClient && process.env.REDIS_URI) {
    try {
      redisClient = redis.createClient({
        url: process.env.REDIS_URI,
      });

      redisClient.on('error', (err) => {
        logger.error('[Redis] Connection error:', err);
      });

      await redisClient.connect();
      logger.info('[Redis] Connected for rate limiting');
    } catch (error) {
      logger.error('[Redis] Failed to initialize:', error);
    }
  }
};

// Initialize Redis on module load
initRedis();

/**
 * Rate limiting middleware with Redis backing
 * Implements both per-minute and monthly quotas
 */
const rateLimitMiddleware = (options = {}) => {
  const {
    windowMs = 60 * 1000, // 1 minute
    maxRequests = 60, // requests per minute
    monthlyQuota = 10000, // monthly request limit
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  return async (req, res, next) => {
    // Fail open if Redis is not available (allow request through)
    if (!redisClient || !redisClient.isReady) {
      logger.warn('[RateLimit] Redis not available, allowing request through');
      return next();
    }

    const userId = req.user?.id || req.ip;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    const rateLimitKey = `rate_limit:${userId}:${windowStart}`;
    const monthlyQuotaKey = `quota:${userId}:${month}`;

    try {
      // Check current window count
      const currentCount = await redisClient.get(rateLimitKey);
      const currentQuota = await redisClient.get(monthlyQuotaKey);

      // Check rate limit
      if (currentCount && parseInt(currentCount) >= maxRequests) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((windowStart + windowMs - now) / 1000),
        });
      }

      // Check monthly quota
      if (currentQuota && parseInt(currentQuota) >= monthlyQuota) {
        return res.status(429).json({
          error: 'Monthly quota exceeded',
          code: 'QUOTA_EXCEEDED',
          resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
        });
      }

      // Store original end handler to check response status
      const originalEnd = res.end;
      res.end = function(chunk, encoding) {
        const shouldCount = (
          (!skipSuccessfulRequests || res.statusCode >= 400) &&
          (!skipFailedRequests || res.statusCode < 400)
        );

        if (shouldCount) {
          // Increment counters asynchronously
          redisClient.multi()
            .incr(rateLimitKey)
            .expire(rateLimitKey, Math.ceil(windowMs / 1000))
            .incr(monthlyQuotaKey)
            .expire(monthlyQuotaKey, 32 * 24 * 60 * 60) // ~1 month
            .exec()
            .catch(err => logger.error('[RateLimit] Failed to update counters:', err));
        }

        originalEnd.call(this, chunk, encoding);
      };

      next();
    } catch (error) {
      logger.error('[RateLimit] Error checking limits:', error);
      // Fail open - allow request through when rate limiting fails
      return next();
    }
  };
};

module.exports = rateLimitMiddleware;