import accessLogSchema from '~/schema/accessLog';
import type * as t from '~/types';

export function createAccessLogModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.AccessLog || mongoose.model<t.IAccessLog>('AccessLog', accessLogSchema);
}