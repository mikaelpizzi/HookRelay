'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Sliders,
  Plus,
  Key,
  Layers,
  RotateCw,
  Copy,
  Check,
  Shield,
  Trash2,
} from 'lucide-react';
import { useTenant } from '../../context/tenant-context';
import { Badge } from '../../components/ui/badge';
import { Modal } from '../../components/ui/modal';
import { CodeBlock } from '../../components/ui/code-block';
import { ApiKeyItem, EventTopic, EnvironmentType } from '../../lib/types';

export default function SettingsPage() {
  const { apiFetch, apiKey, setApiKey, environment, tenantName } = useTenant();

  const [activeTab, setActiveTab] = useState<'topics' | 'keys'>('topics');
  const [topics, setTopics] = useState<EventTopic[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // New Topic Modal
  const [isTopicModalOpen, setIsTopicModalOpen] = useState<boolean>(false);
  const [newTopicName, setNewTopicName] = useState<string>('');
  const [newTopicDescription, setNewTopicDescription] = useState<string>('');
  const [newTopicMaxAttempts, setNewTopicMaxAttempts] = useState<number>(5);
  const [newTopicSchema, setNewTopicSchema] = useState<string>(
    JSON.stringify(
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      null,
      2,
    ),
  );
  const [topicError, setTopicError] = useState<string | null>(null);

  // New API Key Modal
  const [isKeyModalOpen, setIsKeyModalOpen] = useState<boolean>(false);
  const [newKeyName, setNewKeyName] = useState<string>('');
  const [newKeyEnv, setNewKeyEnv] = useState<EnvironmentType>('PRODUCTION');
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  // Schema Viewer Modal
  const [viewingTopic, setViewingTopic] = useState<EventTopic | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [topicsData, keysData] = await Promise.all([
        apiFetch<EventTopic[]>('/api/v1/topics').catch(() => []),
        apiFetch<ApiKeyItem[]>('/api/v1/api-keys').catch(() => []),
      ]);
      setTopics(topicsData || []);
      setApiKeys(keysData || []);
    } catch {
      // API error handling
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Create Topic
  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopicError(null);
    let parsedSchema: any;
    try {
      parsedSchema = JSON.parse(newTopicSchema);
    } catch {
      setTopicError('Invalid JSON schema');
      return;
    }

    try {
      await apiFetch('/api/v1/topics', {
        method: 'POST',
        body: JSON.stringify({
          name: newTopicName.trim(),
          description: newTopicDescription.trim() || undefined,
          maxAttempts: newTopicMaxAttempts,
          payloadSchema: parsedSchema,
        }),
      });
      setIsTopicModalOpen(false);
      setNewTopicName('');
      setNewTopicDescription('');
      await loadData();
    } catch (err: any) {
      setTopicError(err.message);
    }
  };

  // Create API Key
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyError(null);
    try {
      const result = await apiFetch<any>('/api/v1/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: newKeyName.trim(),
          environment: newKeyEnv,
        }),
      });
      setCreatedRawKey(result.rawKey);
      await loadData();
    } catch (err: any) {
      setKeyError(err.message);
    }
  };

  return (
    <div className="p-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span>Settings & Schema Configuration</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Manage event topics, JSON schema validation specifications, and API
            access credentials.
          </p>
        </div>
        <button
          onClick={() => loadData()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-zinc-100 text-xs font-mono transition-colors self-start sm:self-auto"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-zinc-800 text-xs font-mono">
        <button
          onClick={() => setActiveTab('topics')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 font-medium transition-colors ${
            activeTab === 'topics'
              ? 'border-zinc-100 text-zinc-100 font-bold'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Event Topics ({topics.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('keys')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 font-medium transition-colors ${
            activeTab === 'keys'
              ? 'border-zinc-100 text-zinc-100 font-bold'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Key className="w-4 h-4" />
          <span>API Keys ({apiKeys.length})</span>
        </button>
      </div>

      {/* Tab 1: Topics */}
      {activeTab === 'topics' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-zinc-400">
              Registered Event Topics for {tenantName}
            </span>
            <button
              onClick={() => {
                setTopicError(null);
                setIsTopicModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Topic</span>
            </button>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#09090b] border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-500 tracking-wider">
                <tr>
                  <th className="py-3 px-4">Topic Name</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Max Attempts</th>
                  <th className="py-3 px-4">Schema</th>
                  <th className="py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 font-mono">
                {topics.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-12 text-center text-zinc-500 text-xs"
                    >
                      No topics configured yet. Click &quot;Create Topic&quot; to define
                      one.
                    </td>
                  </tr>
                ) : (
                  topics.map((t) => (
                    <tr
                      key={t.id}
                      className="hover:bg-zinc-900/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-zinc-200">
                        {t.name}
                      </td>
                      <td className="py-3 px-4 text-zinc-400 font-sans">
                        {t.description || '—'}
                      </td>
                      <td className="py-3 px-4 text-zinc-300">
                        {t.max_attempts} attempts
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => setViewingTopic(t)}
                          className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-zinc-100 text-[11px] transition-colors"
                        >
                          View Schema
                        </button>
                      </td>
                      <td className="py-3 px-4 text-zinc-500 text-[11px]">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: API Keys */}
      {activeTab === 'keys' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-zinc-400">
              Active Tenant API Keys (SHA-256 Hashed at Rest)
            </span>
            <button
              onClick={() => {
                setKeyError(null);
                setCreatedRawKey(null);
                setNewKeyName('');
                setIsKeyModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Generate API Key</span>
            </button>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0e0e11] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#09090b] border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-500 tracking-wider">
                <tr>
                  <th className="py-3 px-4">Key Name</th>
                  <th className="py-3 px-4">Prefix</th>
                  <th className="py-3 px-4">Environment</th>
                  <th className="py-3 px-4">Last Used</th>
                  <th className="py-3 px-4">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 font-mono">
                {apiKeys.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-12 text-center text-zinc-500 text-xs"
                    >
                      No API keys found for this tenant.
                    </td>
                  </tr>
                ) : (
                  apiKeys.map((k) => (
                    <tr
                      key={k.id}
                      className="hover:bg-zinc-900/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-zinc-200">
                        {k.name}
                      </td>
                      <td className="py-3 px-4 text-emerald-400">
                        {k.key_prefix}...
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px]">
                          {k.environment}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-400 text-[11px]">
                        {k.last_used_at
                          ? new Date(k.last_used_at).toLocaleString()
                          : 'Never'}
                      </td>
                      <td className="py-3 px-4 text-zinc-500 text-[11px]">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Topic Modal */}
      <Modal
        isOpen={isTopicModalOpen}
        onClose={() => setIsTopicModalOpen(false)}
        title="Create Event Topic"
        description="Define a new event schema with strict payload validation constraints."
      >
        <form onSubmit={handleCreateTopic} className="space-y-4">
          {topicError && (
            <div className="p-3 border border-rose-800/80 bg-rose-950/40 text-rose-300 text-xs font-mono rounded">
              {topicError}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400">
              TOPIC NAME *
            </label>
            <input
              type="text"
              required
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              placeholder="e.g. order.fulfilled"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400">
              DESCRIPTION (OPTIONAL)
            </label>
            <input
              type="text"
              value={newTopicDescription}
              onChange={(e) => setNewTopicDescription(e.target.value)}
              placeholder="e.g. Dispatched when order inventory is shipped"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-200 focus:outline-hidden focus:border-zinc-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400">
              MAX RETRY ATTEMPTS (1 - 10)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={newTopicMaxAttempts}
              onChange={(e) => setNewTopicMaxAttempts(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono text-zinc-400">
              JSON SCHEMA (DRAFT-07)
            </label>
            <textarea
              rows={8}
              value={newTopicSchema}
              onChange={(e) => setNewTopicSchema(e.target.value)}
              className="w-full bg-[#0c0c0e] font-mono text-xs text-zinc-300 p-3 rounded border border-zinc-800 focus:outline-hidden focus:border-zinc-700 leading-relaxed"
              spellCheck={false}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsTopicModalOpen(false)}
              className="px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 text-xs font-mono hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-bold transition-colors"
            >
              Save Topic
            </button>
          </div>
        </form>
      </Modal>

      {/* Generate API Key Modal */}
      <Modal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        title="Generate Tenant API Key"
        description="Generates an authentication key. The raw key is shown only once."
      >
        {createdRawKey ? (
          <div className="space-y-4">
            <div className="p-4 rounded border border-emerald-800/80 bg-emerald-950/40 text-emerald-300 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>API Key Generated</span>
              </div>
              <p className="text-xs text-zinc-300">
                Copy this key now. It will not be shown again.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                RAW API KEY
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdRawKey}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-emerald-400 select-all"
                />
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(createdRawKey);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2000);
                  }}
                  className="px-3 py-2 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-mono text-zinc-200 transition-colors flex items-center gap-1.5"
                >
                  {copiedKey ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsKeyModalOpen(false)}
                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateKey} className="space-y-4">
            {keyError && (
              <div className="p-3 border border-rose-800/80 bg-rose-950/40 text-rose-300 text-xs font-mono rounded">
                {keyError}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                KEY NAME *
              </label>
              <input
                type="text"
                required
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. CI/CD Dispatcher Key"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-zinc-400">
                ENVIRONMENT
              </label>
              <select
                value={newKeyEnv}
                onChange={(e) =>
                  setNewKeyEnv(e.target.value as EnvironmentType)
                }
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700"
              >
                <option value="PRODUCTION">PRODUCTION (hr_live_...)</option>
                <option value="SANDBOX">SANDBOX (hr_test_...)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsKeyModalOpen(false)}
                className="px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 text-xs font-mono hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newKeyName.trim()}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-bold transition-colors disabled:opacity-50"
              >
                Generate Key
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Schema Viewer Modal */}
      <Modal
        isOpen={!!viewingTopic}
        onClose={() => setViewingTopic(null)}
        title={viewingTopic ? `Schema: ${viewingTopic.name}` : ''}
        description="JSON Schema validation definition applied at event ingestion."
      >
        {viewingTopic && (
          <CodeBlock
            code={viewingTopic.payload_schema || {}}
            language="json"
            maxHeight="500px"
          />
        )}
      </Modal>
    </div>
  );
}
