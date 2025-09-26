import { Schema } from 'mongoose';
import type { IPolicyVersion } from '~/types';

const policyVersionSchema = new Schema<IPolicyVersion>(
  {
    version: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['admin_update', 'keycloak_sync', 'scheduled_sync'],
      required: true,
    },
    changes_summary: {
      type: String,
      maxlength: 1000,
    },
    updated_by: {
      type: String,
    },
  },
  { timestamps: true },
);

// Only keep latest 100 versions for audit trail
policyVersionSchema.index({ createdAt: -1 });

export default policyVersionSchema;