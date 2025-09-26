import policyRuleSchema from '~/schema/policyRule';
import type * as t from '~/types';

export function createPolicyRuleModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.PolicyRule || mongoose.model<t.IPolicyRule>('PolicyRule', policyRuleSchema);
}