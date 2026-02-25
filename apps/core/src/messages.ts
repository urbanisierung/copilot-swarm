/** Centralized log messages. Edit this file to change any user-facing output. */
export const msg = {
  // --- Lifecycle ---
  startingSwarm: "🚀 Starting Copilot Swarm...",
  swarmComplete: "🏁 All Swarm Streams Completed.",
  configLoaded: (model: string, review: string, verbose: boolean) =>
    `⚙️  Config: primary=${model}, review=${review}, verbose=${verbose}`,
  pipelineSource: (source: string) => `📋 Pipeline: ${source}`,
  repoAnalysisLoaded: "📚 Repository analysis found — using as context for all phases",

  // --- PM Phase ---
  pmPhaseStart: "🚀 Starting PM Phase...",
  pmDrafting: "\n[Phase: PM Drafting]",
  reviewPhase: (agent: string) => `\n[Phase: Review by ${agent}]`,
  taskDecomposition: "\n[Phase: Task Decomposition]",
  tasksResult: (tasks: string[]) => `  📋 Tasks: ${JSON.stringify(tasks)}`,

  // --- Design Phase ---
  designPhaseStart: "\n🎨 Starting Design Phase...",
  designPhase: "\n[Phase: UI/UX Design]",
  designerClarification: "  🔍 Designer needs clarification — consulting PM...",
  reviewerClarification: "  🔍 Clarification needed — consulting PM...",

  // --- Task Streams ---
  launchingStreams: (count: number) => `\n🚀 Launching ${count} Parallel Task Streams...`,
  wavesDetected: (count: number) => `  🌊 ${count} execution wave(s) detected — tasks will run in dependency order`,
  waveStart: (wave: number, total: number, taskCount: number) =>
    `\n🌊 Wave ${wave}/${total}: launching ${taskCount} stream(s)...`,
  waveDone: (wave: number, total: number) => `  ✅ Wave ${wave}/${total} complete`,
  streamLabel: (idx: number) => `Stream ${idx + 1}`,
  streamStart: (label: string, task: string) => `\n[${label}: ${task.substring(0, 60)}...]`,
  streamEngineering: (label: string) => `  [${label}: Engineering]`,
  streamClarification: (label: string) => `  🔍 ${label}: Engineer needs clarification — consulting PM...`,
  streamCodeReview: (label: string, agent: string) => `  [${label}: Review by ${agent}]`,
  streamQa: (label: string) => `  [${label}: QA]`,

  // --- Cross-Model Review ---
  crossModelSkipped: "\n⏭️  Skipping Cross-Model Review (review model equals primary model).",
  crossModelStart: (model: string) => `\n🔄 Starting Cross-Model Review Phase (model: ${model})...`,
  crossModelStreamReview: (label: string) => `  [${label}: Cross-Model Review]`,

  // --- Iteration messages ---
  reviewIteration: (i: number, max: number) => `  └─ Iteration ${i}/${max}: Reviewing...`,
  qaIteration: (i: number, max: number) => `    └─ QA Iteration ${i}/${max}: Testing...`,
  crossModelIteration: (i: number, max: number, model: string) =>
    `    └─ Iteration ${i}/${max}: Reviewing with ${model}...`,

  // --- Outcomes ---
  approved: (agent: string) => `  ✅ Approved by ${agent}`,
  codeApproved: "    ✅ Code approved",
  allTestsPassed: "    ✅ All tests passed",
  crossModelApproved: "    ✅ Approved by cross-model reviewer",
  feedbackReceived: (preview: string) => `  ❌ Feedback: ${preview}...`,
  codeFeedback: (preview: string) => `    ❌ Feedback: ${preview}...`,
  defectsFound: "    🐛 Defects found — fixing...",
  crossModelIssues: "    ❌ Issues found — sending fixes back to original engineer...",

  // --- Errors & Warnings ---
  emptyResponse: (agent: string, attempt: number, max: number) =>
    `  ⚠️  Empty response from ${agent} (attempt ${attempt}/${max})`,
  callError: (agent: string, attempt: number, max: number) => `  ⚠️  Error calling ${agent} (attempt ${attempt}/${max})`,

  // --- Verbose session events ---
  toolExecution: (name: string) => `    🔧 Tool: ${name}`,
  intentUpdate: (intent: string) => `    💭 Intent: ${intent}`,

  // --- Planning Mode ---
  planningStart: "🧠 Starting Planning Mode...",
  planPrereqsAnalyzing: "\n[Planning: Analyzing request for parallel research tasks]",
  planPrereqsNone: "  ℹ️  No parallel research tasks needed — proceeding directly",
  planPrereqsFound: (count: number) => `  🔍 Found ${count} research task(s) — running in parallel`,
  planPrereqsRunning: (task: string) => `  ⚡ Researching: ${task}`,
  planPrereqsDone: (count: number) => `  ✅ ${count} research task(s) completed — context enriched`,
  planningPmPhase: "\n[Planning: Requirements Clarification]",
  planningEngClarifyPhase: "\n[Planning: Engineer Clarification]",
  planningDesignClarifyPhase: "\n[Planning: Designer Clarification]",
  planningEngPhase: "\n[Planning: Technical Analysis]",
  planningReviewPhase: (section: string) => `\n[Planning: Reviewing ${section}]`,
  planReviewIteration: (i: number, max: number) => `  └─ Review iteration ${i}/${max}`,
  planReviewApproved: (section: string) => `  ✅ ${section} approved by reviewer`,
  planReviewFeedback: (preview: string) => `  ❌ Feedback: ${preview}...`,
  planCrossModelPhase: (model: string) => `\n[Planning: Cross-model review — ${model}]`,
  planCrossModelApproved: "  ✅ Plan approved by cross-model reviewer",
  planningComplete: "\n✅ Planning complete.",
  planSaved: (path: string) => `📄 Plan saved to ${path}`,
  planningUserPrompt: "\n💬 Your answer (empty line to send, or press Enter to skip):\n",
  planningInputContinue: "   ... ",
  sessionExpiredRecovery: "  ⚠️  Session expired — recovering with collected answers…",
  sessionRecoveryFailed: "  ⚠️  Recovery session also failed — using last available response",
  clarificationAutoSkipped: "  ⏭️  Non-interactive mode — auto-skipping clarification (agent will use best judgment)",

  // --- Analyze Mode ---
  analyzeStart: "🔍 Starting Repository Analysis...",
  analyzeChunkedStart: (totalFiles: number, chunkCount: number) =>
    `🔍 Large repository detected (${totalFiles} files) — splitting into ${chunkCount} chunk(s) for parallel analysis`,
  analyzeScoutPhase: (model: string) => `\n[Analysis: Scout exploration — ${model}]`,
  analyzePartitionResult: (chunkCount: number, totalFiles: number) =>
    `  📦 Partitioned into ${chunkCount} chunk(s) covering ${totalFiles} files`,
  analyzeChunkStart: (chunkId: string, label: string) => `\n[Analysis: Chunk "${label}" — ${chunkId}]`,
  analyzeChunkComplete: (chunkId: string) => `  ✅ Chunk ${chunkId} analysis complete`,
  analyzeSynthesisPhase: (model: string) => `\n[Analysis: Synthesis — ${model}]`,
  analyzeArchitectPhase: (model: string) => `\n[Analysis: Architect exploration — ${model}]`,
  analyzeReviewPhase: (model: string) => `\n[Analysis: Senior engineer review — ${model}]`,
  analyzeIteration: (i: number, max: number) => `  └─ Iteration ${i}/${max}`,
  analyzeApproved: "  ✅ Analysis approved by senior engineer",
  analyzeFeedback: (preview: string) => `  ❌ Feedback: ${preview}...`,
  analyzeComplete: "\n✅ Repository analysis complete.",
  analyzeSaved: (path: string) => `📄 Analysis saved to ${path}`,

  // --- Checkpoints & Resume ---
  checkpointSaved: (phase: string) => `💾 Checkpoint saved after ${phase} phase`,
  resuming: (completedCount: number) => `🔄 Resuming from checkpoint (${completedCount} phases completed)`,
  noCheckpoint: "⚠️  No checkpoint found — starting from the beginning",
  phaseSkipped: (phase: string) => `⏭️  Skipping ${phase} phase (already completed)`,
  specSkippedPlan: "⏭️  Skipping spec phase (plan provided — requirements already refined)",
  streamSkipped: (label: string) => `  ⏭️  Skipping ${label} (already completed)`,
  draftResumed: "  ⏭️  Resuming from saved draft",
  iterationResumed: (completed: number, max: number) => `  ⏭️  Resuming from iteration ${completed}/${max}`,
  partialStreamFailure: (failed: number, total: number) =>
    `⚠️  ${failed}/${total} streams failed. Completed streams saved to checkpoint.`,
  autoResumeAttempt: (attempt: number, max: number) =>
    `\n🔁 Auto-resuming from checkpoint (attempt ${attempt}/${max})...`,
  autoResumeExhausted: (max: number) =>
    `\n❌ All ${max} auto-resume attempts exhausted. Use --resume to retry manually.`,

  // --- Review Mode ---
  reviewStart: "🔄 Starting Review Mode...",
  reviewLoadedContext: (runId: string) => `📦 Loaded previous run context from ${runId}`,
  reviewNoPreviousRun: "❌ No previous run found. Run 'swarm run' first, then use 'swarm review' to provide feedback.",
  summaryReviewComplete: (elapsed: string) => `✅ Review completed in ${elapsed}`,

  // --- Finish Command ---
  finishStart: (sessionId: string, name: string) => `📦 Finalizing session ${sessionId} — "${name}"`,
  finishNoSession: "❌ No active session found. Create one with 'swarm session create' first.",
  finishChangelogSaved: (path: string) => `📝 Changelog updated: ${path}`,
  finishCheckpointsCleaned: (count: number) => `🧹 Cleaned up ${count} checkpoint file(s)`,
  finishComplete: "✅ Session finalized successfully.",

  // --- Verify Phase ---
  verifySkipped: "\n⏭️  Skipping verification (no build/test/lint commands configured or detected).",
  verifyStart: "\n🔬 Starting Verification Phase...",
  verifyIteration: (i: number, max: number) => `  └─ Verify iteration ${i}/${max}`,
  verifyRunning: (label: string, cmd: string) => `    🏃 ${label}: ${cmd}`,
  verifyCommandPassed: (label: string) => `    ✅ ${label} passed`,
  verifyCommandFailed: (label: string) => `    ❌ ${label} failed`,
  verifyAllPassed: "  ✅ All verification commands passed",
  verifyFixing: (count: number) => `  🔧 ${count} command(s) failed — sending errors to fix agent...`,
  verifyExhausted: (max: number) =>
    `  ⚠️  Verification still failing after ${max} attempts. See verify-failures summary.`,

  // --- Log File ---
  logFileHint: (path: string) => `📋 Full log: ${path}`,

  // --- Completion Summary ---
  summaryDivider: "─".repeat(48),
  summaryRunSuccess: (elapsed: string) => `✅ Copilot Swarm completed in ${elapsed}`,
  summaryRunFailed: (elapsed: string) => `❌ Copilot Swarm failed after ${elapsed}`,
  summaryPlanComplete: (elapsed: string) => `✅ Planning completed in ${elapsed}`,
  summaryAutoPhaseSwitch: "🔄 Planning complete — starting implementation...",
  summaryAutoComplete: (elapsed: string) => `✅ Auto mode completed in ${elapsed}`,
  summaryTaskComplete: (elapsed: string) => `✅ Task completed in ${elapsed}`,
  summaryAnalyzeComplete: (elapsed: string) => `✅ Analysis completed in ${elapsed}`,
  summaryBrainstormComplete: (elapsed: string) => `✅ Brainstorm completed in ${elapsed}`,

  // --- Brainstorm Mode ---
  brainstormStart: "💡 Starting Brainstorm Mode...",
  brainstormPhase: "\n[Brainstorm: Discussion]",
  brainstormSummarizing: "\n[Brainstorm: Generating Summary]",
  brainstormComplete: "\n✅ Brainstorm complete.",
  brainstormSaved: (path: string) => `📄 Brainstorm summary saved to ${path}`,
  summaryPhases: (done: number, total: number, skipped: number) => {
    const parts = [`${done}/${total} phases completed`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    return `📊 ${parts.join(", ")}`;
  },
  summaryStreams: (done: number, failed: number, total: number) => {
    const parts = [`${done}/${total} streams completed`];
    if (failed > 0) parts.push(`${failed} failed`);
    return `🔀 ${parts.join(", ")}`;
  },
  summaryOutput: (path: string) => `📁 Output: ${path}`,
} as const;
