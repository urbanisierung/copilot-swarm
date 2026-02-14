/** Centralized log messages. Edit this file to change any user-facing output. */
export const msg = {
  // --- Lifecycle ---
  startingSwarm: "🚀 Starting Copilot Swarm...",
  swarmComplete: "🏁 All Swarm Streams Completed.",
  configLoaded: (model: string, review: string, verbose: boolean) =>
    `⚙️  Config: primary=${model}, review=${review}, verbose=${verbose}`,
  pipelineSource: (source: string) => `📋 Pipeline: ${source}`,

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
} as const;
