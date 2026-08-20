export interface SqliteMigration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "v1-authoritative-state",
    sql: `
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
) STRICT;

CREATE TABLE project_memberships (
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
) STRICT;

CREATE TABLE access_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id),
  token_hash TEXT NOT NULL UNIQUE,
  token_type TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE secrets (
  secret_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id),
  name TEXT NOT NULL,
  encrypted_value BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, name)
) STRICT;

CREATE UNIQUE INDEX secrets_global_name_idx
  ON secrets(name)
  WHERE project_id IS NULL;

CREATE TABLE backup_records (
  backup_id TEXT PRIMARY KEY,
  destination TEXT NOT NULL,
  status TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE schedule_firings (
  firing_id TEXT PRIMARY KEY,
  schedule_key TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_id TEXT NOT NULL REFERENCES agent_definitions(agent_id),
  agent_version_id TEXT NOT NULL REFERENCES agent_versions(agent_version_id),
  scheduled_for TEXT NOT NULL,
  run_id TEXT REFERENCES runs(run_id),
  status TEXT NOT NULL,
  error_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (schedule_key, scheduled_for)
) STRICT;

CREATE TABLE auth_validators (
  validator_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  slug TEXT NOT NULL,
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, slug)
) STRICT;

CREATE TABLE agent_definitions (
  agent_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  active_version_id TEXT,
  source_path TEXT,
  source_state TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, slug)
) STRICT;

CREATE TABLE agent_versions (
  agent_version_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent_definitions(agent_id),
  version_label TEXT,
  source_kind TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  manifest_schema_version TEXT NOT NULL,
  sdk_version TEXT,
  status TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  artifact_uri TEXT NOT NULL,
  build_metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT
) STRICT;

CREATE TRIGGER agent_versions_immutable_content
BEFORE UPDATE OF agent_id, version_label, source_kind, source_hash, manifest_hash,
  artifact_hash, manifest_schema_version, sdk_version, manifest_json, artifact_uri,
  build_metadata_json, created_at ON agent_versions
BEGIN
  SELECT RAISE(ABORT, 'AGENT_VERSION_IMMUTABLE');
END;

CREATE TRIGGER agent_versions_no_delete
BEFORE DELETE ON agent_versions
BEGIN
  SELECT RAISE(ABORT, 'AGENT_VERSION_IMMUTABLE');
END;

CREATE TABLE agent_entrypoints (
  entrypoint_id TEXT PRIMARY KEY,
  agent_version_id TEXT NOT NULL REFERENCES agent_versions(agent_version_id),
  entrypoint_type TEXT NOT NULL,
  binding_key TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (agent_version_id, entrypoint_type, binding_key)
) STRICT;

CREATE TABLE agent_instances (
  instance_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent_definitions(agent_id),
  agent_version_id TEXT NOT NULL REFERENCES agent_versions(agent_version_id),
  runtime_profile TEXT NOT NULL,
  residency TEXT NOT NULL,
  mpid TEXT NOT NULL UNIQUE,
  os_pid INTEGER,
  state TEXT NOT NULL,
  health TEXT NOT NULL,
  restarted_from_instance_id TEXT REFERENCES agent_instances(instance_id),
  started_at TEXT NOT NULL,
  stopped_at TEXT
) STRICT;

CREATE TABLE processes (
  mpid TEXT PRIMARY KEY,
  process_type TEXT NOT NULL,
  project_id TEXT REFERENCES projects(project_id),
  agent_id TEXT REFERENCES agent_definitions(agent_id),
  agent_version_id TEXT REFERENCES agent_versions(agent_version_id),
  instance_id TEXT REFERENCES agent_instances(instance_id),
  parent_mpid TEXT REFERENCES processes(mpid),
  os_pid INTEGER,
  state TEXT NOT NULL,
  health TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT,
  last_progress_at TEXT,
  exit_code INTEGER,
  signal TEXT
) STRICT;

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_id TEXT NOT NULL REFERENCES agent_definitions(agent_id),
  principal_id TEXT,
  chat_id TEXT,
  scope TEXT NOT NULL,
  next_sequence INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, agent_id, scope, principal_id, chat_id)
) STRICT;

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_id TEXT NOT NULL REFERENCES agent_definitions(agent_id),
  agent_version_id TEXT NOT NULL REFERENCES agent_versions(agent_version_id),
  instance_id TEXT REFERENCES agent_instances(instance_id),
  entrypoint TEXT NOT NULL,
  state TEXT NOT NULL,
  result TEXT NOT NULL,
  principal_id TEXT,
  conversation_id TEXT REFERENCES conversations(conversation_id),
  idempotency_key TEXT,
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_json TEXT,
  trace_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  accepted_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
) STRICT;

CREATE UNIQUE INDEX runs_idempotency_idx
  ON runs(project_id, agent_id, principal_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX runs_state_idx ON runs(state, accepted_at);
CREATE INDEX runs_agent_idx ON runs(agent_id, accepted_at DESC);

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  parent_task_id TEXT REFERENCES tasks(task_id),
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE steps (
  step_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  step_type TEXT NOT NULL,
  state TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE execution_graphs (
  graph_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  root_run_id TEXT NOT NULL REFERENCES runs(run_id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE execution_edges (
  graph_id TEXT NOT NULL REFERENCES execution_graphs(graph_id),
  parent_run_id TEXT NOT NULL REFERENCES runs(run_id),
  child_run_id TEXT NOT NULL REFERENCES runs(run_id),
  relationship TEXT NOT NULL,
  join_group_id TEXT,
  parent_close_policy TEXT NOT NULL,
  PRIMARY KEY (graph_id, parent_run_id, child_run_id)
) STRICT;

CREATE TABLE mailboxes (
  mailbox_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  address TEXT NOT NULL,
  next_sequence INTEGER NOT NULL DEFAULT 1,
  max_pending INTEGER NOT NULL,
  UNIQUE (project_id, address)
) STRICT;

CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(mailbox_id),
  mailbox_sequence INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  sender_json TEXT NOT NULL,
  recipient_json TEXT NOT NULL,
  run_id TEXT REFERENCES runs(run_id),
  task_id TEXT REFERENCES tasks(task_id),
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  reply_to TEXT,
  priority TEXT NOT NULL,
  deadline_at TEXT,
  content_type TEXT NOT NULL,
  payload_json TEXT,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  trace_id TEXT NOT NULL,
  deduplication_key TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (mailbox_id, mailbox_sequence),
  UNIQUE (mailbox_id, deduplication_key)
) STRICT;

CREATE TABLE message_deliveries (
  delivery_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  available_at TEXT NOT NULL,
  delivered_at TEXT,
  acknowledged_at TEXT,
  error_json TEXT
) STRICT;

CREATE TABLE dead_letters (
  dead_letter_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  reason TEXT NOT NULL,
  error_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  agent_version_id TEXT NOT NULL REFERENCES agent_versions(agent_version_id),
  schema_version INTEGER NOT NULL,
  resume_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX checkpoints_run_idx ON checkpoints(run_id, created_at DESC);

CREATE TABLE conversation_messages (
  conversation_message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  run_id TEXT REFERENCES runs(run_id),
  agent_version_id TEXT REFERENCES agent_versions(agent_version_id),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, sequence)
) STRICT;

CREATE TABLE rate_limit_rules (
  rule_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  name TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  burst INTEGER,
  configuration_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (scope_type, scope_id, name)
) STRICT;

CREATE TABLE rate_limit_counters (
  rule_id TEXT NOT NULL REFERENCES rate_limit_rules(rule_id),
  counter_key TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  value REAL NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (rule_id, counter_key, window_start_ms)
) STRICT;

CREATE TABLE rate_limit_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE concurrency_leases (
  lease_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  scope TEXT NOT NULL,
  lease_key TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (scope, lease_key, run_id)
) STRICT;

CREATE INDEX concurrency_leases_expiry_idx ON concurrency_leases(expires_at);

CREATE TABLE budgets (
  budget_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  limit_value REAL NOT NULL,
  period TEXT,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE budget_usage (
  budget_id TEXT NOT NULL REFERENCES budgets(budget_id),
  period_key TEXT NOT NULL,
  used_value REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, period_key)
) STRICT;

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  agent_id TEXT NOT NULL REFERENCES agent_definitions(agent_id),
  agent_version_id TEXT NOT NULL REFERENCES agent_versions(agent_version_id),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  task_id TEXT REFERENCES tasks(task_id),
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_uri TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  task_id TEXT REFERENCES tasks(task_id),
  tool_id TEXT NOT NULL,
  state TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_json TEXT,
  trace_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE approval_requests (
  approval_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  action TEXT NOT NULL,
  prompt TEXT NOT NULL,
  data_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_json TEXT
) STRICT;

CREATE INDEX approval_requests_project_idx ON approval_requests(project_id, status, requested_at DESC);

CREATE TABLE providers (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  base_url TEXT,
  secret_refs_json TEXT NOT NULL,
  status TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE model_roles (
  role TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(provider_id),
  model_name TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE kernel_events (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  node_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(project_id),
  agent_id TEXT REFERENCES agent_definitions(agent_id),
  run_id TEXT REFERENCES runs(run_id),
  mpid TEXT,
  actor_json TEXT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  trace_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;

CREATE INDEX kernel_events_project_idx ON kernel_events(project_id, event_seq);
CREATE INDEX kernel_events_run_idx ON kernel_events(run_id, event_seq);

CREATE TABLE audit_events (
  audit_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id),
  actor_json TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource_json TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  source_ip TEXT,
  trace_id TEXT NOT NULL,
  result TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_homes (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id),
  mode TEXT NOT NULL,
  physical_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT
) STRICT;

CREATE TABLE project_files (
  file_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  relative_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  media_type TEXT,
  sha256 TEXT,
  revision INTEGER NOT NULL,
  source TEXT NOT NULL,
  index_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  last_indexed_at TEXT,
  UNIQUE (project_id, relative_path)
) STRICT;

CREATE TABLE file_revisions (
  file_id TEXT NOT NULL REFERENCES project_files(file_id),
  revision INTEGER NOT NULL,
  sha256 TEXT,
  size INTEGER NOT NULL,
  actor_id TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (file_id, revision)
) STRICT;

CREATE TABLE trash_entries (
  trash_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  original_path TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  expires_at TEXT
) STRICT;

CREATE TABLE uploads (
  upload_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  destination TEXT,
  file_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expected_size INTEGER NOT NULL,
  expected_sha256 TEXT,
  received_size INTEGER NOT NULL DEFAULT 0,
  staging_path TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE sync_sessions (
  sync_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  local_root_fingerprint TEXT NOT NULL,
  project_root TEXT NOT NULL,
  mode TEXT NOT NULL,
  delete_policy TEXT NOT NULL,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`,
  },
  {
    version: 2,
    name: "reusable-auth-validator-versions",
    sql: `
ALTER TABLE auth_validators ADD COLUMN source_path TEXT;
ALTER TABLE auth_validators ADD COLUMN source_state TEXT NOT NULL DEFAULT 'clean';
ALTER TABLE auth_validators ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE auth_validators ADD COLUMN updated_at TEXT;

CREATE TABLE auth_validator_versions (
  validator_version_id TEXT PRIMARY KEY,
  validator_id TEXT NOT NULL REFERENCES auth_validators(validator_id),
  source_hash TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  artifact_uri TEXT NOT NULL,
  scheme TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('valid', 'active', 'superseded', 'invalid')),
  created_at TEXT NOT NULL,
  activated_at TEXT
) STRICT;

CREATE INDEX auth_validator_versions_validator_idx
  ON auth_validator_versions(validator_id, created_at DESC);

CREATE TRIGGER auth_validator_versions_immutable_content
BEFORE UPDATE OF validator_id, source_hash, artifact_hash, artifact_uri, scheme, created_at
ON auth_validator_versions
BEGIN
  SELECT RAISE(ABORT, 'AUTH_VALIDATOR_VERSION_IMMUTABLE');
END;

CREATE TRIGGER auth_validator_versions_no_delete
BEFORE DELETE ON auth_validator_versions
BEGIN
  SELECT RAISE(ABORT, 'AUTH_VALIDATOR_VERSION_IMMUTABLE');
END;
`,
  },
  {
    version: 3,
    name: "durable-hmac-replay-window",
    sql: `
CREATE TABLE hmac_replay_entries (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  replay_key_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, replay_key_hash)
) STRICT;

CREATE INDEX hmac_replay_entries_expiry_idx
  ON hmac_replay_entries(expires_at);
`,
  },
  {
    version: 4,
    name: "project-scoped-access-tokens",
    sql: `
ALTER TABLE access_tokens ADD COLUMN project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE;
ALTER TABLE access_tokens ADD COLUMN label TEXT;

CREATE INDEX access_tokens_project_idx
  ON access_tokens(project_id, created_at DESC);
`,
  },
  {
    version: 5,
    name: "versioned-tool-runtime",
    sql: `
ALTER TABLE tool_calls ADD COLUMN agent_version_id TEXT REFERENCES agent_versions(agent_version_id);
ALTER TABLE tool_calls ADD COLUMN tool_version TEXT;
ALTER TABLE tool_calls ADD COLUMN risk TEXT;
ALTER TABLE tool_calls ADD COLUMN side_effects INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tool_calls ADD COLUMN idempotency_key TEXT;
ALTER TABLE tool_calls ADD COLUMN approval_id TEXT REFERENCES approval_requests(approval_id);
ALTER TABLE tool_calls ADD COLUMN cached_from_call_id TEXT REFERENCES tool_calls(tool_call_id);

CREATE INDEX tool_calls_run_idx ON tool_calls(run_id, created_at DESC);
CREATE UNIQUE INDEX tool_calls_idempotency_idx
  ON tool_calls(agent_version_id, tool_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND state IN ('waiting_for_approval', 'running', 'completed');
`,
  },
] as const;
