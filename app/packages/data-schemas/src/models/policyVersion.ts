import policyVersionSchema from '~/schema/policyVersion';
import type * as t from '~/types';

export function createPolicyVersionModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.PolicyVersion || mongoose.model<t.IPolicyVersion>('PolicyVersion', policyVersionSchema);
}