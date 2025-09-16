const { HttpsProxyAgent } = require('https-proxy-agent');
const { createHandleLLMNewToken } = require('@librechat/api');
const {
  AuthType,
  Constants,
  EModelEndpoint,
  bedrockInputParser,
  bedrockOutputParser,
  removeNullishValues,
} = require('librechat-data-provider');
const { getUserKey, checkUserKeyExpiry } = require('~/server/services/UserService');

const getOptions = async ({ req, overrideModel, endpointOption }) => {
  const {
    AWS_BEARER_TOKEN_BEDROCK,
    BEDROCK_AWS_SECRET_ACCESS_KEY,
    BEDROCK_AWS_ACCESS_KEY_ID,
    BEDROCK_AWS_SESSION_TOKEN,
    BEDROCK_REVERSE_PROXY,
    BEDROCK_AWS_DEFAULT_REGION,
    PROXY,
  } = process.env;
  const expiresAt = req.body.key;

  // Check if using new API key method or legacy credentials
  const isApiKeyProvided = AWS_BEARER_TOKEN_BEDROCK === AuthType.USER_PROVIDED;
  const isLegacyUserProvided = BEDROCK_AWS_SECRET_ACCESS_KEY === AuthType.USER_PROVIDED;
  const isUserProvided = isApiKeyProvided || isLegacyUserProvided;

  let credentials;
  if (isUserProvided) {
    const userKey = await getUserKey({ userId: req.user.id, name: EModelEndpoint.bedrock });
    if (isApiKeyProvided) {
      // New API key method - set as environment variable for boto3
      credentials = { bearerToken: userKey };
      process.env.AWS_BEARER_TOKEN_BEDROCK = userKey;
    } else {
      // Legacy multi-credential method
      credentials = userKey;
    }
  } else {
    // Server-provided credentials
    if (AWS_BEARER_TOKEN_BEDROCK && AWS_BEARER_TOKEN_BEDROCK !== AuthType.USER_PROVIDED) {
      credentials = { bearerToken: AWS_BEARER_TOKEN_BEDROCK };
    } else {
      credentials = {
        accessKeyId: BEDROCK_AWS_ACCESS_KEY_ID,
        secretAccessKey: BEDROCK_AWS_SECRET_ACCESS_KEY,
        ...(BEDROCK_AWS_SESSION_TOKEN && { sessionToken: BEDROCK_AWS_SESSION_TOKEN }),
      };
    }
  }

  if (!credentials) {
    throw new Error('Bedrock credentials not provided. Please provide them again.');
  }

  if (
    !isUserProvided &&
    (credentials.accessKeyId === undefined || credentials.accessKeyId === '') &&
    (credentials.secretAccessKey === undefined || credentials.secretAccessKey === '')
  ) {
    credentials = undefined;
  }

  if (expiresAt && isUserProvided) {
    checkUserKeyExpiry(expiresAt, EModelEndpoint.bedrock);
  }

  /** @type {number} */
  let streamRate = Constants.DEFAULT_STREAM_RATE;

  /** @type {undefined | TBaseEndpoint} */
  const bedrockConfig = req.app.locals[EModelEndpoint.bedrock];

  if (bedrockConfig && bedrockConfig.streamRate) {
    streamRate = bedrockConfig.streamRate;
  }

  /** @type {undefined | TBaseEndpoint} */
  const allConfig = req.app.locals.all;
  if (allConfig && allConfig.streamRate) {
    streamRate = allConfig.streamRate;
  }

  /** @type {BedrockClientOptions} */
  const requestOptions = {
    model: overrideModel ?? endpointOption?.model,
    region: BEDROCK_AWS_DEFAULT_REGION,
  };

  const configOptions = {};
  if (PROXY) {
    /** NOTE: NOT SUPPORTED BY BEDROCK */
    configOptions.httpAgent = new HttpsProxyAgent(PROXY);
  }

  const llmConfig = bedrockOutputParser(
    bedrockInputParser.parse(
      removeNullishValues(Object.assign(requestOptions, endpointOption?.model_parameters ?? {})),
    ),
  );

  if (credentials) {
    llmConfig.credentials = credentials;
  }

  if (BEDROCK_REVERSE_PROXY) {
    llmConfig.endpointHost = BEDROCK_REVERSE_PROXY;
  }

  llmConfig.callbacks = [
    {
      handleLLMNewToken: createHandleLLMNewToken(streamRate),
    },
  ];

  return {
    /** @type {BedrockClientOptions} */
    llmConfig,
    configOptions,
  };
};

module.exports = getOptions;
