const {
  CacheKeys,
  SystemRoles,
  roleDefaults,
  permissionsSchema,
  removeNullishValues,
} = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const getLogStores = require('~/cache/getLogStores');
const { Role } = require('~/db/models');

/**
 * Retrieve a role by name and convert the found role document to a plain object.
 * If the role with the given name doesn't exist and the name is a system defined role,
 * create it and return the lean version.
 *
 * @param {string} roleName - The name of the role to find or create.
 * @param {string|string[]} [fieldsToSelect] - The fields to include or exclude in the returned document.
 * @returns {Promise<IRole>} Role document.
 */
const getRoleByName = async function (roleName, fieldsToSelect = null) {
  const cache = getLogStores(CacheKeys.ROLES);
  try {
    const cachedRole = await cache.get(roleName);
    if (cachedRole) {
      return cachedRole;
    }
    let query = Role.findOne({ name: roleName });
    if (fieldsToSelect) {
      query = query.select(fieldsToSelect);
    }
    let role = await query.lean().exec();

    if (!role && SystemRoles[roleName]) {
      role = await new Role(roleDefaults[roleName]).save();
      await cache.set(roleName, role);
      return role.toObject();
    }
    await cache.set(roleName, role);
    return role;
  } catch (error) {
    throw new Error(`Failed to retrieve or create role: ${error.message}`);
  }
};

/**
 * Update role values by name.
 *
 * @param {string} roleName - The name of the role to update.
 * @param {Partial<TRole>} updates - The fields to update.
 * @returns {Promise<TRole>} Updated role document.
 */
const updateRoleByName = async function (roleName, updates) {
  const cache = getLogStores(CacheKeys.ROLES);
  try {
    const role = await Role.findOneAndUpdate(
      { name: roleName },
      { $set: updates },
      { new: true, lean: true },
    )
      .select('-__v')
      .lean()
      .exec();
    await cache.set(roleName, role);
    return role;
  } catch (error) {
    throw new Error(`Failed to update role: ${error.message}`);
  }
};

/**
 * Updates access permissions for a specific role and multiple permission types.
 * @param {string} roleName - The role to update.
 * @param {Object.<PermissionTypes, Object.<Permissions, boolean>>} permissionsUpdate - Permissions to update and their values.
 * @param {IRole} [roleData] - Optional role data to use instead of fetching from the database.
 */
async function updateAccessPermissions(roleName, permissionsUpdate, roleData) {
  // Filter and clean the permission updates based on our schema definition.
  const updates = {};
  for (const [permissionType, permissions] of Object.entries(permissionsUpdate)) {
    if (permissionsSchema.shape && permissionsSchema.shape[permissionType]) {
      updates[permissionType] = removeNullishValues(permissions);
    }
  }
  if (!Object.keys(updates).length) {
    return;
  }

  try {
    const role = roleData ?? (await getRoleByName(roleName));
    if (!role) {
      return;
    }

    const currentPermissions = role.permissions || {};
    const updatedPermissions = { ...currentPermissions };
    let hasChanges = false;

    const unsetFields = {};
    const permissionTypes = Object.keys(permissionsSchema.shape || {});
    for (const permType of permissionTypes) {
      if (role[permType] && typeof role[permType] === 'object') {
        logger.info(
          `Migrating '${roleName}' role from old schema: found '${permType}' at top level`,
        );

        updatedPermissions[permType] = {
          ...updatedPermissions[permType],
          ...role[permType],
        };

        unsetFields[permType] = 1;
        hasChanges = true;
      }
    }

    for (const [permissionType, permissions] of Object.entries(updates)) {
      const currentTypePermissions = currentPermissions[permissionType] || {};
      updatedPermissions[permissionType] = { ...currentTypePermissions };

      for (const [permission, value] of Object.entries(permissions)) {
        if (currentTypePermissions[permission] !== value) {
          updatedPermissions[permissionType][permission] = value;
          hasChanges = true;
          logger.info(
            `Updating '${roleName}' role permission '${permissionType}' '${permission}' from ${currentTypePermissions[permission]} to: ${value}`,
          );
        }
      }
    }

    if (hasChanges) {
      const updateObj = { permissions: updatedPermissions };

      if (Object.keys(unsetFields).length > 0) {
        logger.info(
          `Unsetting old schema fields for '${roleName}' role: ${Object.keys(unsetFields).join(', ')}`,
        );

        try {
          await Role.updateOne(
            { name: roleName },
            {
              $set: updateObj,
              $unset: unsetFields,
            },
          );

          const cache = getLogStores(CacheKeys.ROLES);
          const updatedRole = await Role.findOne({ name: roleName }).select('-__v').lean().exec();
          await cache.set(roleName, updatedRole);

          logger.info(`Updated role '${roleName}' and removed old schema fields`);
        } catch (updateError) {
          logger.error(`Error during role migration update: ${updateError.message}`);
          throw updateError;
        }
      } else {
        // Standard update if no migration needed
        await updateRoleByName(roleName, updateObj);
      }

      logger.info(`Updated '${roleName}' role permissions`);
    } else {
      logger.info(`No changes needed for '${roleName}' role permissions`);
    }
  } catch (error) {
    logger.error(`Failed to update ${roleName} role permissions:`, error);
  }
}

/**
 * Migrates roles from old schema to new schema structure.
 * This can be called directly to fix existing roles.
 *
 * @param {string} [roleName] - Optional specific role to migrate. If not provided, migrates all roles.
 * @returns {Promise<number>} Number of roles migrated.
 */
const migrateRoleSchema = async function (roleName) {
  try {
    // Get roles to migrate
    let roles;
    if (roleName) {
      const role = await Role.findOne({ name: roleName });
      roles = role ? [role] : [];
    } else {
      roles = await Role.find({});
    }

    logger.info(`Migrating ${roles.length} roles to new schema structure`);
    let migratedCount = 0;

    for (const role of roles) {
      const permissionTypes = Object.keys(permissionsSchema.shape || {});
      const unsetFields = {};
      let hasOldSchema = false;

      // Check for old schema fields
      for (const permType of permissionTypes) {
        if (role[permType] && typeof role[permType] === 'object') {
          hasOldSchema = true;

          // Ensure permissions object exists
          role.permissions = role.permissions || {};

          // Migrate permissions from old location to new
          role.permissions[permType] = {
            ...role.permissions[permType],
            ...role[permType],
          };

          // Mark field for removal
          unsetFields[permType] = 1;
        }
      }

      if (hasOldSchema) {
        try {
          logger.info(`Migrating role '${role.name}' from old schema structure`);

          // Simple update operation
          await Role.updateOne(
            { _id: role._id },
            {
              $set: { permissions: role.permissions },
              $unset: unsetFields,
            },
          );

          // Refresh cache
          const cache = getLogStores(CacheKeys.ROLES);
          const updatedRole = await Role.findById(role._id).lean().exec();
          await cache.set(role.name, updatedRole);

          migratedCount++;
          logger.info(`Migrated role '${role.name}'`);
        } catch (error) {
          logger.error(`Failed to migrate role '${role.name}': ${error.message}`);
        }
      }
    }

    logger.info(`Migration complete: ${migratedCount} roles migrated`);
    return migratedCount;
  } catch (error) {
    logger.error(`Role schema migration failed: ${error.message}`);
    throw error;
  }
};

/**
 * Create a new custom role
 * @param {Object} roleData - The role data
 * @param {string} roleData.name - The role name
 * @param {string} [roleData.displayName] - Display name for the role
 * @param {string} [roleData.description] - Description of the role
 * @param {string} [roleData.source] - Source of the role (custom, keycloak, system)
 * @param {string} [roleData.externalId] - External ID for role mapping
 * @param {Object} [roleData.permissions] - Permissions object
 * @returns {Promise<IRole>} Created role document
 */
const createRole = async function (roleData) {
  const cache = getLogStores(CacheKeys.ROLES);

  try {
    // Check if role already exists
    const existingRole = await Role.findOne({ name: roleData.name });
    if (existingRole) {
      throw new Error(`Role with name '${roleData.name}' already exists`);
    }

    // Set defaults for custom roles
    const roleDoc = {
      name: roleData.name,
      displayName: roleData.displayName || roleData.name,
      description: roleData.description || '',
      source: roleData.source || 'custom',
      externalId: roleData.externalId,
      isActive: true,
      permissions: roleData.permissions || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const newRole = new Role(roleDoc);
    await newRole.save();

    const createdRole = newRole.toObject();

    // Cache the new role
    await cache.set(roleData.name, createdRole);

    // Register with RoleManager
    const { RoleManager } = require('librechat-data-provider');
    RoleManager.registerRole(roleData.name);

    logger.info(`Created custom role: ${roleData.name}`);
    return createdRole;
  } catch (error) {
    logger.error(`Failed to create role '${roleData.name}': ${error.message}`);
    throw error;
  }
};

/**
 * Get all roles with pagination
 * @param {Object} options - Query options
 * @param {number} [options.limit] - Maximum number of results
 * @param {number} [options.skip] - Number of results to skip
 * @param {string} [options.search] - Search term for role names
 * @param {boolean} [options.activeOnly] - Only return active roles
 * @returns {Promise<{roles: IRole[], total: number}>} Roles and total count
 */
const getRoles = async function (options = {}) {
  try {
    const {
      limit = 20,
      skip = 0,
      search,
      activeOnly = true,
    } = options;

    // Build query
    const query = {};
    if (activeOnly) {
      query.isActive = { $ne: false };
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    // Execute queries
    const [roles, total] = await Promise.all([
      Role.find(query)
        .sort({ name: 1 })
        .limit(limit)
        .skip(skip)
        .lean()
        .exec(),
      Role.countDocuments(query),
    ]);

    return { roles, total };
  } catch (error) {
    logger.error(`Failed to get roles: ${error.message}`);
    throw error;
  }
};

/**
 * Delete a custom role
 * @param {string} roleName - Name of the role to delete
 * @returns {Promise<boolean>} Success status
 */
const deleteRole = async function (roleName) {
  const cache = getLogStores(CacheKeys.ROLES);

  try {
    // Prevent deletion of system roles
    if (Object.values(SystemRoles).includes(roleName)) {
      throw new Error(`Cannot delete system role: ${roleName}`);
    }

    const role = await Role.findOne({ name: roleName });
    if (!role) {
      throw new Error(`Role '${roleName}' not found`);
    }

    if (role.source === 'system') {
      throw new Error(`Cannot delete system role: ${roleName}`);
    }

    // TODO: Check if any users have this role assigned
    // const { User } = require('~/db/models');
    // const usersWithRole = await User.countDocuments({ roles: roleName });
    // if (usersWithRole > 0) {
    //   throw new Error(`Cannot delete role '${roleName}': ${usersWithRole} users still have this role`);
    // }

    await Role.deleteOne({ name: roleName });
    await cache.delete(roleName);

    logger.info(`Deleted custom role: ${roleName}`);
    return true;
  } catch (error) {
    logger.error(`Failed to delete role '${roleName}': ${error.message}`);
    throw error;
  }
};

/**
 * Update a role's active status
 * @param {string} roleName - Name of the role to update
 * @param {boolean} isActive - New active status
 * @returns {Promise<IRole>} Updated role document
 */
const updateRoleStatus = async function (roleName, isActive) {
  const cache = getLogStores(CacheKeys.ROLES);

  try {
    const role = await Role.findOneAndUpdate(
      { name: roleName },
      {
        isActive,
        updatedAt: new Date(),
      },
      { new: true, lean: true }
    );

    if (!role) {
      throw new Error(`Role '${roleName}' not found`);
    }

    await cache.set(roleName, role);
    logger.info(`Updated role '${roleName}' status to: ${isActive}`);

    return role;
  } catch (error) {
    logger.error(`Failed to update role '${roleName}' status: ${error.message}`);
    throw error;
  }
};

module.exports = {
  getRoleByName,
  updateRoleByName,
  migrateRoleSchema,
  updateAccessPermissions,
  createRole,
  getRoles,
  deleteRole,
  updateRoleStatus,
};
