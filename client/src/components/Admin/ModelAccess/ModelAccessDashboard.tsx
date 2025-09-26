import React, { useState, useEffect } from 'react';
import { Plus, Shield, Users, Settings, Activity } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '~/components/ui';
import { useAuthContext } from '~/hooks/AuthContext';
import { PolicyRulesList } from './PolicyRulesList';
import { CreatePolicyDialog } from './CreatePolicyDialog';
import { UsageStats } from './UsageStats';
import { KeycloakSync } from './KeycloakSync';

interface PolicyRule {
  _id: string;
  subject_type: 'user' | 'group' | 'role' | 'org';
  subject_id: string;
  resource_type: 'model' | 'tool' | 'endpoint';
  resource_id: string;
  effect: 'allow' | 'deny';
  conditions?: {
    max_tokens?: number;
    max_output_tokens?: number;
    temperature_max?: number;
  };
  key_policy: 'pre_configured' | 'user_provided' | 'both';
  priority: number;
  active: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface UsageSummary {
  total_requests: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost: number;
  unique_users: number;
  unique_models: number;
}

const ModelAccessDashboard: React.FC = () => {
  const { user, token } = useAuthContext();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'policies' | 'usage' | 'sync'>('policies');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Check if user is admin
  const isAdmin = user?.role === 'admin' || user?.roles?.includes('airwall-admin');

  // Fetch policy rules
  const { data: policiesData, isLoading: policiesLoading } = useQuery({
    queryKey: ['admin', 'policies'],
    queryFn: async () => {
      const response = await fetch('/api/model-access/admin/policies', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch policies');
      }

      return response.json();
    },
    enabled: isAdmin,
  });

  // Fetch usage statistics
  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['admin', 'usage'],
    queryFn: async () => {
      const response = await fetch('/api/model-access/admin/usage?period=month', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch usage stats');
      }

      return response.json();
    },
    enabled: isAdmin,
  });

  // Delete policy mutation
  const deletePolicyMutation = useMutation({
    mutationFn: async (policyId: string) => {
      const response = await fetch(`/api/model-access/admin/policies/${policyId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete policy');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'policies'] });
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Shield className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">
            You need administrator privileges to access model access controls.
          </p>
        </div>
      </div>
    );
  }

  const policies: PolicyRule[] = policiesData?.policies || [];
  const usage: UsageSummary = usageData?.summary || {
    total_requests: 0,
    total_tokens_in: 0,
    total_tokens_out: 0,
    total_cost: 0,
    unique_users: 0,
    unique_models: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl">
              Model Access Control
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage user and group permissions for AI models
            </p>
          </div>
          <div className="flex space-x-3">
            <Button
              onClick={() => setCreateDialogOpen(true)}
              className="inline-flex items-center"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Policy
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Shield className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Active Policies
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {policies.filter(p => p.active).length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Users className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Active Users
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {usage.unique_users}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Settings className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Models Available
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {usage.unique_models}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Activity className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Monthly Requests
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {usage.total_requests.toLocaleString()}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('policies')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'policies'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Policy Rules
          </button>
          <button
            onClick={() => setActiveTab('usage')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'usage'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Usage Statistics
          </button>
          <button
            onClick={() => setActiveTab('sync')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'sync'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Keycloak Sync
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white shadow rounded-lg">
        {activeTab === 'policies' && (
          <PolicyRulesList
            policies={policies}
            loading={policiesLoading}
            onDelete={(policyId) => deletePolicyMutation.mutate(policyId)}
          />
        )}

        {activeTab === 'usage' && (
          <UsageStats
            usage={usage}
            byModel={usageData?.by_model || []}
            loading={usageLoading}
          />
        )}

        {activeTab === 'sync' && (
          <KeycloakSync />
        )}
      </div>

      {/* Create Policy Dialog */}
      <CreatePolicyDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['admin', 'policies'] });
          setCreateDialogOpen(false);
        }}
      />
    </div>
  );
};

export default ModelAccessDashboard;