import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { Document } from 'mongoose';
import { CursorPaginationParams } from '~/common';

export interface IRole extends Document {
  name: string;
  displayName?: string;
  description?: string;
  source?: 'system' | 'keycloak' | 'custom';
  externalId?: string;
  isActive?: boolean;
  allowedModels?: string[]; // Array of model IDs this role can access
  allowedEndpoints?: string[]; // Array of endpoint names this role can access
  createdAt?: Date;
  updatedAt?: Date;
  permissions: {
    [PermissionTypes.BOOKMARKS]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.PROMPTS]?: {
      [Permissions.SHARED_GLOBAL]?: boolean;
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
    };
    [PermissionTypes.MEMORIES]?: {
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
      [Permissions.UPDATE]?: boolean;
      [Permissions.READ]?: boolean;
    };
    [PermissionTypes.AGENTS]?: {
      [Permissions.SHARED_GLOBAL]?: boolean;
      [Permissions.USE]?: boolean;
      [Permissions.CREATE]?: boolean;
    };
    [PermissionTypes.MULTI_CONVO]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.TEMPORARY_CHAT]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.RUN_CODE]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.WEB_SEARCH]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.PEOPLE_PICKER]?: {
      [Permissions.VIEW_USERS]?: boolean;
      [Permissions.VIEW_GROUPS]?: boolean;
      [Permissions.VIEW_ROLES]?: boolean;
    };
    [PermissionTypes.MARKETPLACE]?: {
      [Permissions.USE]?: boolean;
    };
    [PermissionTypes.FILE_SEARCH]?: {
      [Permissions.USE]?: boolean;
    };
  };
}

export type RolePermissions = IRole['permissions'];
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type RolePermissionsInput = DeepPartial<RolePermissions>;

export interface CreateRoleRequest {
  name: string;
  displayName?: string;
  description?: string;
  source?: 'custom';
  externalId?: string;
  allowedModels?: string[];
  allowedEndpoints?: string[];
  permissions: RolePermissionsInput;
}

export interface UpdateRoleRequest {
  name?: string;
  displayName?: string;
  description?: string;
  isActive?: boolean;
  permissions?: RolePermissionsInput;
}

export interface RoleFilterOptions extends CursorPaginationParams {
  // Includes role name
  search?: string;
  hasPermission?: string;
}
