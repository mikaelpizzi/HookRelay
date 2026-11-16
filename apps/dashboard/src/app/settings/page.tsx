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
  FileCode,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { useTenant } from '../../context/tenant-context';
import { Badge } from '../../components/ui/badge';
import { Modal } from '../../components/ui/modal';
import { CodeBlock } from '../../components/ui/code-block';
import { ApiKeyItem, EventTopic, EnvironmentType } from '../../lib/types';

export default function SettingsPage() {
  const { apiFetch, apiKey, environment, tenantName } = useTenant();

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
          amount: { type: 'number', minimum: 1 },
          customer_email: { type: 'string', format: 'email' },
        },
        required: ['id', 'amount'],
      },
      null,
      2,
    ),
  );
  const [topicError, setTopicError] = useState<string | null>(null);
  const [schemaSyntaxError, setSchemaSyntaxError] = useState<string | null>(null);

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
      // Error handling
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Schema Live Syntax Validation
  const handleSchemaChange = (text: string) => {
    setNewTopicSchema(text);
    try {
      JSON.parse(text);
      setSchemaSyntaxError(null);
    } catch (err: any) {
      setSchemaSyntaxError(err.message);
    }
  };

  // Create Topic
  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopicError(null);
    let parsedSchema: any;
    try {
      parsedSchema = JSON.parse(newTopicSchema);
    } catch {
      setTopicError('Invalid JSON schema syntax');
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
      setCreatedRawKey(result.apiKey);
      await loadData();
    } catch (err: any) {
      setKeyError(err.message);
    }
  };

  // Revoke API Key
  const handleRevokeKey = async (keyId: string) => {
    if (
      !confirm(
        'Are you sure you want to revoke this API key? This action is immediate and cannot be undone.',
      )
    ) {
      return;
    }
    try {
      await apiFetch(`/api/v1/api-keys/${keyId}`, {
        method: 'DELETE',
      });
      await loadData();
    } catch (err: any) {
      alert(`Failed to revoke API key: ${err.message}`);
    }
  };

  return (
    <div className="p-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
              Tenant Configuration
            </span>
            <span className="text-[11px] font-mono text-zinc-500">
              Active Tenant: <strong className="text-zinc-300">{tenantName}</strong>
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 mt-1 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span>Settings & Schema Configuration</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5 max-w-3xl">
            Configure event schemas with Draft-07 validation and manage tenant API keys with revocation controls.
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

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 gap-4 text-xs font-mono">
        <button
          onClick={() => setActiveTab('topics')}
          className={`flex items-center gap-2 pb-3 border-b-2 font-semibold transition-colors ${
            activeTab === 'topics'
              ? 'border-zinc-100 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Event Topics & Schemas ({topics.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('keys')}
          className={`flex items-center gap-2 pb-3 border-b-2 font-semibold transition-colors ${
            activeTab === 'keys'
              ? 'border-zinc-100 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Tenant API Keys ({apiKeys.length})</span>
        </button>
      </div>

      {/* Tab 1: Event Topics */}
      {activeTab === 'topics' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-mono text-zinc-400">
              Registered Event Topics (Draft-07 Validation)
            </span>
            <button
              onClick={() => {
                setTopicError(null);
                setSchemaSyntaxError(null);
                setNewTopicName('');
                setNewTopicDescription('');
                setIsTopicModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition-colors self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>+ Create Topic</span>
            </button>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0e1015] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#09090b] border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-400 tracking-wider">
                <tr>
                  <th className="py-2.5 px-4">Topic Name</th>
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4">Max Attempts</th>
                  <th className="py-2.5 px-4">Schema Validation</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-sans">
                {topics.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-zinc-500 font-mono text-xs">
                      No event topics registered for this tenant. Click &quot;+ Create Topic&quot;.
                    </td>
                  </tr>
                ) : (
                  topics.map((t) => (
                    <tr key={t.id} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-emerald-400">
                        {t.name}
                      </td>
                      <td className="py-3 px-4 text-zinc-400 text-xs max-w-sm">
                        {t.description || 'No description provided'}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-300 tabular-nums">
                        {t.max_attempts}
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                          JSON Schema Draft-07
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setViewingTopic(t)}
                          className="px-2.5 py-1 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-mono transition-colors"
                        >
                          View Schema
                        </button>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition-colors self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>+ Generate Key</span>
            </button>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0e1015] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#09090b] border-b border-zinc-800 text-[10px] uppercase font-mono text-zinc-400 tracking-wider">
                <tr>
                  <th className="py-2.5 px-4">Key Name</th>
                  <th className="py-2.5 px-4">Prefix</th>
                  <th className="py-2.5 px-4">Environment</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Last Used</th>
                  <th className="py-2.5 px-4">Created At</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-zinc-500 text-xs">
                      No API keys found for this tenant. Click &quot;+ Generate Key&quot;.
                    </td>
                  </tr>
                ) : (
                  apiKeys.map((k) => {
                    const isRevoked = !!k.revoked_at;
                    return (
                      <tr key={k.id} className="hover:bg-zinc-900/40 transition-colors">
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
                        <td className="py-3 px-4">
                          {isRevoked ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950/80 border border-rose-800 text-rose-300">
                              REVOKED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 border border-emerald-800 text-emerald-300">
                              ACTIVE
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-zinc-400 text-[11px] tabular-nums">
                          {k.last_used_at
                            ? new Date(k.last_used_at).toISOString().slice(0, 16).replace('T', ' ')
                            : 'Never'}
                        </td>
                        <td className="py-3 px-4 text-zinc-500 text-[11px] tabular-nums">
                          {new Date(k.created_at).toISOString().slice(0, 10)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!isRevoked && (
                            <button
                              onClick={() => handleRevokeKey(k.id)}
                              className="px-2 py-1 rounded border border-rose-900/80 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-mono transition-colors flex items-center gap-1 ml-auto"
                              title="Revoke compromised API key"
                            >
                              <Ban className="w-3 h-3" />
                              <span>Revoke</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
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
            <div className="flex justify-between items-center text-[11px] font-mono">
              <span className="text-zinc-400">JSON SCHEMA (DRAFT-07) *</span>
              {schemaSyntaxError ? (
                <span className="text-rose-400 text-[10px]">Invalid JSON</span>
              ) : (
                <span className="text-emerald-400 text-[10px]">Valid JSON Syntax</span>
              )}
            </div>
            <textarea
              rows={10}
              value={newTopicSchema}
              onChange={(e) => handleSchemaChange(e.target.value)}
              className={`w-full bg-[#0c0c0e] font-mono text-xs text-zinc-300 p-3 rounded border focus:outline-hidden leading-relaxed min-h-[180px] ${
                schemaSyntaxError ? 'border-rose-700' : 'border-zinc-800 focus:border-zinc-700'
              }`}
              spellCheck={false}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={() => setIsTopicModalOpen(false)}
              className="px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 text-xs font-mono hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!!schemaSyntaxError || !newTopicName.trim()}
              className="px-4 py-1.5 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-bold transition-colors disabled:opacity-50"
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
                className="px-4 py-2 rounded bg-zinc-100 hover:bg-white text-xs font-semibold text-zinc-950 transition-colors"
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
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-hidden focus:border-zinc-700 [color-scheme:dark]"
              >
                <option value="PRODUCTION">PRODUCTION</option>
                <option value="SANDBOX">SANDBOX</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsKeyModalOpen(false)}
                className="px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 text-xs font-mono hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newKeyName.trim()}
                className="px-4 py-1.5 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-bold transition-colors disabled:opacity-50"
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
