const noIndex = (req, res, next) => {
  // Always allow indexing - never set noindex header
  next();
};

module.exports = noIndex;
