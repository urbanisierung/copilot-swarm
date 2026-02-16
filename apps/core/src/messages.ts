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
  streamLabel: (idx: number) => `Stream ${idx + 1}`,
  streamStart: (label: string, task: string) => `\n[${label}: ${task.substring(0, 60)}...]`,
  streamEngineering: (label: string) => `  [${label}: Engineering]`,
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
  planningPmPhase: "\n[Planning: Requirements Clarification]",
  planningEngPhase: "\n[Planning: Technical Analysis]",
  planningComplete: "\n✅ Planning complete.",
  planSaved: (path: string) => `📄 Plan saved to ${path}`,
  planningUserPrompt: "\n💬 Your answer (empty line to send, or press Enter to skip):\n",
  planningInputContinue: "   ... ",

  // --- Analyze Mode ---
  analyzeStart: "🔍 Starting Repository Analysis...",
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
  streamSkipped: (label: string) => `  ⏭️  Skipping ${label} (already completed)`,
  draftResumed: "  ⏭️  Resuming from saved draft",
  iterationResumed: (completed: number, max: number) => `  ⏭️  Resuming from iteration ${completed}/${max}`,
  partialStreamFailure: (failed: number, total: number) =>
    `⚠️  ${failed}/${total} streams failed. Completed streams saved to checkpoint.`,
  autoResumeAttempt: (attempt: number, max: number) =>
    `\n🔁 Auto-resuming from checkpoint (attempt ${attempt}/${max})...`,
  autoResumeExhausted: (max: number) =>
    `\n❌ All ${max} auto-resume attempts exhausted. Use --resume to retry manually.`,

  // --- Log File ---
  logFileHint: (path: string) => `📋 Full log: ${path}`,
} as const;
