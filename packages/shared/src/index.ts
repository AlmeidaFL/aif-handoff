// Schema
export {
  projects,
  appSettings,
  participants,
  participantSessions,
  tasks,
  taskComments,
  taskAssignments,
  taskExecutorHistory,
  auditEvents,
  githubRepositories,
  githubIssues,
  runtimeProfiles,
  agentCustomizations,
  chatSessions,
  chatMessages,
  usageEvents,
  runtimeWarmupSessions,
  codexSessions,
  codexSessionFiles,
  codexLimitHeads,
  codexLimitHistory,
  codexIndexCursors,
  taskRuns,
} from "./schema.js";
export type {
  ProjectRow,
  NewProjectRow,
  AppSettingsRow,
  NewAppSettingsRow,
  ParticipantRow,
  NewParticipantRow,
  ParticipantSessionRow,
  NewParticipantSessionRow,
  TaskRow,
  NewTaskRow,
  TaskCommentRow,
  NewTaskCommentRow,
  TaskAssignmentRow,
  NewTaskAssignmentRow,
  TaskExecutorHistoryRow,
  NewTaskExecutorHistoryRow,
  AuditEventRow,
  NewAuditEventRow,
  GitHubRepositoryRow,
  NewGitHubRepositoryRow,
  GitHubIssueRow,
  NewGitHubIssueRow,
  RuntimeProfileRow,
  NewRuntimeProfileRow,
  AgentCustomizationRow,
  NewAgentCustomizationRow,
  ChatSessionRow,
  NewChatSessionRow,
  ChatMessageRow,
  NewChatMessageRow,
  UsageEventRow,
  NewUsageEventRow,
  RuntimeWarmupSessionStatus,
  RuntimeWarmupSessionRow,
  NewRuntimeWarmupSessionRow,
  CodexSessionRow,
  NewCodexSessionRow,
  CodexSessionFileRow,
  NewCodexSessionFileRow,
  CodexLimitHeadRow,
  NewCodexLimitHeadRow,
  CodexLimitHistoryRow,
  NewCodexLimitHistoryRow,
  CodexIndexCursorRow,
  NewCodexIndexCursorRow,
  TaskRunRow,
  NewTaskRunRow,
} from "./schema.js";

// Types
export {
  TASK_STATUSES,
  type TaskStatus,
  PARTICIPANT_ROLES,
  type ParticipantRole,
  EXECUTION_OWNERS,
  type ExecutionOwner,
  AUDIT_ACTOR_KINDS,
  type AuditActorKind,
  type AutoQueueCommitStatus,
  AUTO_REVIEW_STRATEGIES,
  type AutoReviewStrategy,
  AUTO_REVIEW_FINDING_SOURCES,
  type AutoReviewFindingSource,
  type AutoReviewFinding,
  type AutoReviewState,
  type Project,
  type GitHubEligibility,
  type GitHubRepositoryConnection,
  type GitHubIssueCommentSnapshot,
  type GitHubIssueSnapshot,
  type GitHubIssueLink,
  type UpdateProjectOrganizationInput,
  type CreateProjectInput,
  type UpdateProjectInput,
  type AppSettings,
  type UpdateAppSettingsInput,
  type Task,
  type TaskListItem,
  type ParticipantSummary,
  type Participant,
  type AuthSessionState,
  type CreateParticipantInput,
  type UpdateParticipantInput,
  type ResetParticipantPasswordInput,
  type TaskAssigneeSummary,
  type TaskPermissions,
  type AuditActor,
  type AuditEvent,
  type TaskExecutorHistoryEntry,
  type TaskOwnership,
  type HandoffTaskInput,
  type TaskOwnershipConflictCode,
  type TaskOwnershipConflict,
  type ProjectTaskPreview,
  type ProjectTaskOverview,
  type TaskActiveRuntimeSelection,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskComment,
  type TaskCommentAttachment,
  type CreateTaskCommentInput,
  TASK_EVENTS,
  type TaskEvent,
  type TaskEventInput,
  type ReorderTaskInput,
  type WsEventType,
  type WsEvent,
  type ParticipantBroadcastPayload,
  type ParticipantSessionRevokedPayload,
  type TaskOwnershipBroadcastPayload,
  type TaskCommentBroadcastPayload,
  type ChatMessage,
  type ChatMessageAttachment,
  type ChatRequest,
  type ChatStreamTokenPayload,
  type ChatDonePayload,
  type ChatErrorPayload,
  type ChatAction,
  type ChatActionCreateTask,
  isRuntimeTransport,
  RUNTIME_TRANSPORTS,
  RuntimeTransport,
  type RuntimeProfileUsage,
  type RuntimeProfile,
  type CreateRuntimeProfileInput,
  type UpdateRuntimeProfileInput,
  type AgentCustomization,
  type UpsertAgentCustomizationInput,
  type TaskRun,
  type TaskRunStatus,
  type TaskRunExecutionMode,
  type TaskRunLogPayload,
  type TaskRunStatusPayload,
  type EffectiveRuntimeProfileSource,
  type EffectiveRuntimeProfileSelection,
  RuntimeLimitSource,
  RuntimeLimitStatus,
  RuntimeLimitPrecision,
  RuntimeLimitScope,
  type RuntimeLimitWindow,
  type RuntimeLimitSnapshot,
  type RuntimeLimitEventPayload,
  type WarmupBroadcastPayload,
  type ChatSessionSource,
  type ChatSession,
  type CreateChatSessionInput,
  type UpdateChatSessionInput,
  type ChatSessionMessage,
} from "./types.js";

// Database
export { getDb, createTestDb, closeDb } from "./db.js";

// Environment
export { getEnv, validateEnv, resetEnvCache } from "./env.js";
export type { Env } from "./env.js";

// Constants
export {
  STATUS_CONFIG,
  ORDERED_STATUSES,
  WARMUP_TARGETS,
  WARMUP_WORKFLOW_KINDS,
  DEFAULT_WARMUP_TARGET,
  isWarmupWorkflowKind,
  type WarmupTarget,
  type WarmupWorkflowKind,
  type WarmupProfileMode,
} from "./constants.js";
export {
  applyHumanTaskEvent,
  resolveTaskAction,
  resolveTaskPermissions,
  HUMAN_ACTIONS_BY_STATUS,
  CLEAN_STATE_RESET,
  type TaskActionContext,
  type TaskActionDeniedCode,
  type TaskPolicyView,
  type TransitionPatch,
  type TransitionResult,
} from "./stateMachine.js";

// Agent catalog
export {
  AGENT_CATALOG,
  CUSTOMIZABLE_AGENT_ROLES,
  isCustomizableAgentRole,
  type AgentRole,
  type CustomizableAgentRole,
  type AgentCatalogEntry,
} from "./agentCatalog.js";

// Logger
export { logger, rootLogger } from "./logger.js";

// Monorepo root resolution
export { findMonorepoRoot, findMonorepoRootFromUrl } from "./monorepoRoot.js";

// Project initialization
export { initBaseProjectDirectory } from "./projectInit.js";
export {
  slugify,
  generatePlanPath,
  getCanonicalPlanPath,
  syncPlanTextToCanonicalFile,
} from "./planFile.js";
export type { GeneratePlanPathOptions } from "./planFile.js";
export { persistTaskPlan } from "./taskPlan.js";
export {
  parseHowToRunFile,
  getHowToRunPath,
  syncHowToRunToProjectRoot,
  HOW_TO_RUN_RELATIVE_PATH,
  type HowToRunSpec,
  type HowToRunType,
} from "./howToRun.js";

// Path validation
export { validateProjectRootPath } from "./pathValidation.js";

// Git/worktree isolation utilities (Node-only)
export {
  BranchIsolationError,
  assertCurrentBranch,
  assertWorkingTreeClean,
  branchExists,
  buildBranchName,
  buildTaskWorktreePath,
  countCommitsBetween,
  describeDirtyWorkingTree,
  ensureFeatureBranch,
  ensureTaskWorktree,
  getCurrentBranch,
  getHeadCommitSha,
  isBranchIsolationError,
  isGitRepo,
  projectSupportsTaskWorktrees,
  projectUsesSharedBranchIsolation,
  restorePersistedBranch,
  slugifyTitle,
  validateBranchName,
  workingTreeClean,
  type EnsureFeatureBranchInput,
  type EnsureFeatureBranchResult,
  type EnsureTaskWorktreeInput,
  type EnsureTaskWorktreeResult,
  type RestorePersistedBranchInput,
} from "./gitIsolation.js";

export { buildCommitPrompt } from "./commitWorkflow.js";

// Attachment utilities
export {
  parseAttachments,
  isFileBackedAttachment,
  formatAttachmentsForPrompt,
  extractHeadings,
  looksLikeFullPlanUpdate,
  type ParsedAttachment,
} from "./attachments.js";

// Task usage metrics
export { parseTaskTokenUsage, type TaskTokenUsage } from "./taskUsage.js";

// Sync utilities
export {
  type SyncDirection,
  type ConflictResolution,
  type SyncEvent,
  type PlanAnnotation,
  parsePlanAnnotations,
  insertPlanAnnotation,
} from "./sync.js";

// Project config (config.yaml)
export {
  getProjectConfig,
  clearProjectConfigCache,
  type AifProjectConfig,
  type AifProjectPaths,
  type AifProjectWorkflow,
  type AifProjectGit,
  type AifProjectLanguage,
} from "./projectConfig.js";

// Telegram notifications
export {
  escapeMarkdown,
  sendTelegramNotification,
  type TelegramNotificationOptions,
} from "./telegram.js";

// Planner mode defaults
export { defaultsForMode } from "./plannerDefaults.js";
export type { PlannerMode, PlannerFlagDefaults } from "./plannerDefaults.js";

// Utilities
export { withTimeout } from "./withTimeout.js";
export { parseMcpPortSetting, type ParsedMcpPortSetting } from "./mcpPort.js";

// Runtime-limit shared helpers
export {
  buildRuntimeLimitSignature,
  mapSafeRuntimeErrorReason,
  normalizeRuntimeLimitSnapshot,
  redactProviderText,
  redactProviderTextForLogs,
  resolveRuntimeLimitFutureHint,
  sanitizeRuntimeLimitSnapshotForExposure,
  sanitizeProviderMeta,
  selectViolatedWindowForExactThreshold,
  type RuntimeLimitFutureHint,
  type RuntimeLimitFutureHintSource,
  type RuntimeLimitSnapshotExposure,
  type SafeRuntimeErrorCategory,
  type SafeRuntimeErrorReason,
} from "./runtimeLimitUtils.js";
