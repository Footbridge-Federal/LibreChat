const express = require('express');
const router = express.Router();
const endpointController = require('~/server/controllers/EndpointController');
const overrideController = require('~/server/controllers/OverrideController');
const { optionalJwtAuth } = require('~/server/middleware/');

router.get('/', optionalJwtAuth, endpointController);
router.get('/config/override', overrideController);

module.exports = router;
