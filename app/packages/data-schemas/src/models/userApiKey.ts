import userApiKeySchema from '~/schema/userApiKey';
import type * as t from '~/types';

export function createUserApiKeyModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.UserApiKey || mongoose.model<t.IUserApiKey>('UserApiKey', userApiKeySchema);
}