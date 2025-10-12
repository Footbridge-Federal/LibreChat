const express = require('express');
const {
  SystemRoles,
  roleDefaults,
  PermissionTypes,
  agentPermissionsSchema,
  promptPermissionsSchema,
  memoryPermissionsSchema,
  marketplacePermissionsSchema,
  peoplePickerPermissionsSchema,
} = require('librechat-data-provider');
const { requireJwtAuth } = require('~/server/middleware');
const { checkAdmin, checkRoles, validateRoles } = require('~/server/middleware/roles/admin');
const {
  updateRoleByName,
  getRoleByName,
  createRole,
  getRoles,
  deleteRole,
  updateRoleStatus,
} = require('~/models/Role');

const router = express.Router();
router.use(requireJwtAuth);

/**
 * Permission configuration mapping
 * Maps route paths to their corresponding schemas and permission types
 */
const permissionConfigs = {
  prompts: {
    schema: promptPermissionsSchema,
    permissionType: PermissionTypes.PROMPTS,
    errorMessage: 'Invalid prompt permissions.',
  },
  agents: {
    schema: agentPermissionsSchema,
    permissionType: PermissionTypes.AGENTS,
    errorMessage: 'Invalid agent permissions.',
  },
  memories: {
    schema: memoryPermissionsSchema,
    permissionType: PermissionTypes.MEMORIES,
    errorMessage: 'Invalid memory permissions.',
  },
  'people-picker': {
    schema: peoplePickerPermissionsSchema,
    permissionType: PermissionTypes.PEOPLE_PICKER,
    errorMessage: 'Invalid people picker permissions.',
  },
  marketplace: {
    schema: marketplacePermissionsSchema,
    permissionType: PermissionTypes.MARKETPLACE,
    errorMessage: 'Invalid marketplace permissions.',
  },
};

/**
 * Generic handler for updating permissions
 * @param {string} permissionKey - The key from permissionConfigs
 * @returns {Function} Express route handler
 */
const createPermissionUpdateHandler = (permissionKey) => {
  const config = permissionConfigs[permissionKey];

  return async (req, res) => {
    const { roleName: _r } = req.params;
    // TODO: TEMP, use a better parsing for roleName
    const roleName = _r.toUpperCase();
    const updates = req.body;

    try {
      const parsedUpdates = config.schema.partial().parse(updates);

      const role = await getRoleByName(roleName);
      if (!role) {
        return res.status(404).send({ message: 'Role not found' });
      }

      const currentPermissions =
        role.permissions?.[config.permissionType] || role[config.permissionType] || {};

      const mergedUpdates = {
        permissions: {
          ...role.permissions,
          [config.permissionType]: {
            ...currentPermissions,
            ...parsedUpdates,
          },
        },
      };

      const updatedRole = await updateRoleByName(roleName, mergedUpdates);
      res.status(200).send(updatedRole);
    } catch (error) {
      return res.status(400).send({ message: config.errorMessage, error: error.errors });
    }
  };
};

/**
 * GET /api/roles/:roleName
 * Get a specific role by name
 */
router.get('/:roleName', async (req, res) => {
  const { roleName: _r } = req.params;
  // TODO: TEMP, use a better parsing for roleName
  const roleName = _r.toUpperCase();

  if (
    (req.user.role !== SystemRoles.ADMIN && roleName === SystemRoles.ADMIN) ||
    (req.user.role !== SystemRoles.ADMIN && !roleDefaults[roleName])
  ) {
    return res.status(403).send({ message: 'Unauthorized' });
  }

  try {
    const role = await getRoleByName(roleName, '-_id -__v');
    if (!role) {
      return res.status(404).send({ message: 'Role not found' });
    }

    res.status(200).send(role);
  } catch (error) {
    return res.status(500).send({ message: 'Failed to retrieve role', error: error.message });
  }
});

/**
 * PUT /api/roles/:roleName/prompts
 * Update prompt permissions for a specific role
 */
router.put('/:roleName/prompts', checkAdmin, createPermissionUpdateHandler('prompts'));

/**
 * PUT /api/roles/:roleName/agents
 * Update agent permissions for a specific role
 */
router.put('/:roleName/agents', checkAdmin, createPermissionUpdateHandler('agents'));

/**
 * PUT /api/roles/:roleName/memories
 * Update memory permissions for a specific role
 */
router.put('/:roleName/memories', checkAdmin, createPermissionUpdateHandler('memories'));

/**
 * PUT /api/roles/:roleName/people-picker
 * Update people picker permissions for a specific role
 */
router.put('/:roleName/people-picker', checkAdmin, createPermissionUpdateHandler('people-picker'));

/**
 * PUT /api/roles/:roleName/marketplace
 * Update marketplace permissions for a specific role
 */
router.put('/:roleName/marketplace', checkAdmin, createPermissionUpdateHandler('marketplace'));

// =============================
// Custom Role Management Routes
// =============================

/**
 * GET /api/roles
 * Get all roles with pagination and search
 */
router.get('/', checkAdmin, async (req, res) => {
  try {
    const {
      limit = 20,
      skip = 0,
      search,
      activeOnly = 'true',
    } = req.query;

    const options = {
      limit: parseInt(limit, 10),
      skip: parseInt(skip, 10),
      search,
      activeOnly: activeOnly === 'true',
    };

    const result = await getRoles(options);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to retrieve roles',
      error: error.message,
    });
  }
});

/**
 * POST /api/roles
 * Create a new custom role
 */
router.post('/', checkAdmin, async (req, res) => {
  try {
    const { name, displayName, description, permissions } = req.body;

    // Validation
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Role name is required' });
    }

    // Validate permissions structure if provided
    if (permissions && typeof permissions !== 'object') {
      return res.status(400).json({ message: 'Permissions must be an object' });
    }

    const roleData = {
      name: name.trim(),
      displayName: displayName?.trim() || name.trim(),
      description: description?.trim() || '',
      source: 'custom',
      permissions: permissions || {},
    };

    const newRole = await createRole(roleData);
    res.status(201).json({
      message: 'Role created successfully',
      role: newRole,
    });
  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.status(409).json({ message: error.message });
    }
    res.status(500).json({
      message: 'Failed to create role',
      error: error.message,
    });
  }
});

/**
 * DELETE /api/roles/:roleName
 * Delete a custom role
 */
router.delete('/:roleName', checkAdmin, async (req, res) => {
  try {
    const { roleName } = req.params;

    await deleteRole(roleName);
    res.status(200).json({
      message: `Role '${roleName}' deleted successfully`,
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }
    if (error.message.includes('Cannot delete')) {
      return res.status(403).json({ message: error.message });
    }
    res.status(500).json({
      message: 'Failed to delete role',
      error: error.message,
    });
  }
});

/**
 * PATCH /api/roles/:roleName/status
 * Update role active status
 */
router.patch('/:roleName/status', checkAdmin, async (req, res) => {
  try {
    const { roleName } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean' });
    }

    const updatedRole = await updateRoleStatus(roleName, isActive);
    res.status(200).json({
      message: `Role '${roleName}' status updated successfully`,
      role: updatedRole,
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({
      message: 'Failed to update role status',
      error: error.message,
    });
  }
});

module.exports = router;
