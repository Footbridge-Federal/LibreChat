const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');
const { ModelAccess } = require('./schema/ModelAccess');
const GroupApiKey = require('./schema/GroupApiKey');

const models = createModels(mongoose);

module.exports = {
  ...models,
  ModelAccess,
  GroupApiKey
};
