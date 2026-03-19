import * as fs from "node:fs/promises";
import type { QAPair } from "./checkpoint.js";

/** Role definition for a harvest question section. */
export interface HarvestRole {
  label: string;
  phaseKey: string;
}

export const HARVEST_ROLES: HarvestRole[] = [
  { label: "PM / Requirements", phaseKey: "plan-clarify" },
  { label: "Engineering", phaseKey: "plan-eng-clarify" },
  { label: "Design", phaseKey: "plan-design-clarify" },
];

/** Write a structured questions file for async answering. */
export async function writeQuestionsFile(
  filePath: string,
  roleQuestions: Record<string, string[]>,
  meta: { sessionId?: string; request: string; timestamp: string },
): Promise<void> {
  const lines: string[] = [];
  const preview = meta.request.length > 100 ? `${meta.request.substring(0, 100)}...` : meta.request;

  // Compute summary stats
  const sectionStats: string[] = [];
  let totalQuestions = 0;
  for (let s = 0; s < HARVEST_ROLES.length; s++) {
    const count = (roleQuestions[HARVEST_ROLES[s].phaseKey] ?? []).length;
    totalQuestions += count;
    sectionStats.push(`Section ${s + 1} (${HARVEST_ROLES[s].label}): ${count}`);
  }

  lines.push("# Plan Questions");
  lines.push("");
  lines.push(`> Session: ${meta.sessionId ?? "default"}`);
  lines.push(`> Request: ${preview.replace(/\n/g, " ")}`);
  lines.push(`> Generated: ${meta.timestamp}`);
  lines.push("");
  lines.push(`<!-- Summary: ${totalQuestions} question(s) across ${HARVEST_ROLES.length} sections -->`);
  lines.push(`<!-- ${sectionStats.join(" | ")} -->`);
  lines.push("<!-- Fill in your answers below each question. Leave blank to let the agent decide. -->");
  lines.push("<!-- For multiple-choice questions, just write the letter (A, B, C, ...) or a custom answer. -->");
  lines.push("<!-- When done, run: swarm plan --resume -->");
  lines.push("");

  let sectionIdx = 0;
  for (const role of HARVEST_ROLES) {
    sectionIdx++;
    const questions = roleQuestions[role.phaseKey] ?? [];
    lines.push(`## ${role.label} (\`${role.phaseKey}\`)`);
    lines.push("");

    if (questions.length === 0) {
      lines.push("_No questions from this role._");
      lines.push("");
      continue;
    }

    for (let i = 0; i < questions.length; i++) {
      lines.push(`### Q${sectionIdx}.${i + 1}`);
      for (const qLine of questions[i].split("\n")) {
        lines.push(`> ${qLine}`);
      }
      lines.push("");
      lines.push("**Answer:**");
      lines.push("");
      lines.push("");
    }
  }

  await fs.writeFile(filePath, lines.join("\n"));
}

/** Write a questions file preserving existing answers. */
export async function writeQuestionsFileWithAnswers(
  filePath: string,
  roleQAPairs: Record<string, QAPair[]>,
  meta: { sessionId?: string; request: string; timestamp: string },
): Promise<void> {
  const lines: string[] = [];
  const preview = meta.request.length > 100 ? `${meta.request.substring(0, 100)}...` : meta.request;

  // Compute summary stats
  const sectionStats: string[] = [];
  let totalQuestions = 0;
  let totalAnswered = 0;
  for (let s = 0; s < HARVEST_ROLES.length; s++) {
    const pairs = roleQAPairs[HARVEST_ROLES[s].phaseKey] ?? [];
    const answered = pairs.filter((p) => p.answer).length;
    totalQuestions += pairs.length;
    totalAnswered += answered;
    sectionStats.push(`Section ${s + 1} (${HARVEST_ROLES[s].label}): ${pairs.length} (${answered} answered)`);
  }

  lines.push("# Plan Questions");
  lines.push("");
  lines.push(`> Session: ${meta.sessionId ?? "default"}`);
  lines.push(`> Request: ${preview.replace(/\n/g, " ")}`);
  lines.push(`> Generated: ${meta.timestamp}`);
  lines.push("");
  lines.push(
    `<!-- Summary: ${totalQuestions} question(s), ${totalAnswered} answered, across ${HARVEST_ROLES.length} sections -->`,
  );
  lines.push(`<!-- ${sectionStats.join(" | ")} -->`);
  lines.push("<!-- Fill in your answers below each question. Leave blank to let the agent decide. -->");
  lines.push("<!-- For multiple-choice questions, just write the letter (A, B, C, ...) or a custom answer. -->");
  lines.push("<!-- When done, run: swarm plan --resume -->");
  lines.push("");

  let sectionIdx = 0;
  for (const role of HARVEST_ROLES) {
    sectionIdx++;
    const pairs = roleQAPairs[role.phaseKey] ?? [];
    lines.push(`## ${role.label} (\`${role.phaseKey}\`)`);
    lines.push("");

    if (pairs.length === 0) {
      lines.push("_No questions from this role._");
      lines.push("");
      continue;
    }

    for (let i = 0; i < pairs.length; i++) {
      lines.push(`### Q${sectionIdx}.${i + 1}`);
      for (const qLine of pairs[i].question.split("\n")) {
        lines.push(`> ${qLine}`);
      }
      lines.push("");
      lines.push("**Answer:**");
      if (pairs[i].answer) {
        lines.push("");
        lines.push(pairs[i].answer);
      }
      lines.push("");
      lines.push("");
    }
  }

  await fs.writeFile(filePath, lines.join("\n"));
}

/**
 * Parse a questions file and extract answered Q&A pairs per phase key.
 * Unanswered questions (empty answer) are omitted.
 */
export function parseQuestionsFile(content: string): Record<string, QAPair[]> {
  const result: Record<string, QAPair[]> = {};
  let currentPhaseKey: string | null = null;
  let currentQuestion: string | null = null;
  let collectingAnswer = false;
  let answerLines: string[] = [];

  const flushQA = () => {
    if (currentPhaseKey && currentQuestion !== null) {
      const answer = answerLines.join("\n").trim();
      if (answer) {
        if (!result[currentPhaseKey]) result[currentPhaseKey] = [];
        result[currentPhaseKey].push({ question: currentQuestion.trim(), answer });
      }
    }
    currentQuestion = null;
    collectingAnswer = false;
    answerLines = [];
  };

  for (const line of content.split("\n")) {
    // Detect section header: ## PM / Requirements (`plan-clarify`)
    const sectionMatch = line.match(/^## .+\(`([^`]+)`\)/);
    if (sectionMatch) {
      flushQA();
      currentPhaseKey = sectionMatch[1];
      continue;
    }

    // Detect question header: ### Q1 (old) or ### Q1.1 (new)
    if (/^### Q\d+(\.\d+)?/.test(line)) {
      flushQA();
      currentQuestion = "";
      collectingAnswer = false;
      continue;
    }

    // Detect answer marker: **Answer:**
    if (/^\*\*Answer:\*\*/.test(line)) {
      // Anything after **Answer:** on the same line
      const inline = line.replace(/^\*\*Answer:\*\*/, "").trim();
      collectingAnswer = true;
      answerLines = inline ? [inline] : [];
      continue;
    }

    if (currentQuestion !== null && !collectingAnswer) {
      // Collecting question text (strip blockquote prefix)
      const stripped = line.replace(/^>\s?/, "");
      if (currentQuestion) {
        currentQuestion += `\n${stripped}`;
      } else {
        currentQuestion = stripped;
      }
    } else if (collectingAnswer) {
      answerLines.push(line);
    }
  }

  // Flush last Q&A
  flushQA();

  return result;
}

/**
 * Parse a questions file and extract ALL Q&A pairs per phase key,
 * including unanswered questions (empty answer string).
 */
export function parseQuestionsFileAll(content: string): Record<string, QAPair[]> {
  const result: Record<string, QAPair[]> = {};
  let currentPhaseKey: string | null = null;
  let currentQuestion: string | null = null;
  let collectingAnswer = false;
  let answerLines: string[] = [];

  const flushQA = () => {
    if (currentPhaseKey && currentQuestion !== null) {
      const answer = answerLines.join("\n").trim();
      if (!result[currentPhaseKey]) result[currentPhaseKey] = [];
      result[currentPhaseKey].push({ question: currentQuestion.trim(), answer });
    }
    currentQuestion = null;
    collectingAnswer = false;
    answerLines = [];
  };

  for (const line of content.split("\n")) {
    const sectionMatch = line.match(/^## .+\(`([^`]+)`\)/);
    if (sectionMatch) {
      flushQA();
      currentPhaseKey = sectionMatch[1];
      continue;
    }

    if (/^### Q\d+(\.\d+)?/.test(line)) {
      flushQA();
      currentQuestion = "";
      collectingAnswer = false;
      continue;
    }

    if (/^\*\*Answer:\*\*/.test(line)) {
      const inline = line.replace(/^\*\*Answer:\*\*/, "").trim();
      collectingAnswer = true;
      answerLines = inline ? [inline] : [];
      continue;
    }

    if (currentQuestion !== null && !collectingAnswer) {
      const stripped = line.replace(/^>\s?/, "");
      if (currentQuestion) {
        currentQuestion += `\n${stripped}`;
      } else {
        currentQuestion = stripped;
      }
    } else if (collectingAnswer) {
      answerLines.push(line);
    }
  }

  flushQA();
  return result;
}

/**
 * Split raw agent output (numbered questions) into individual question strings.
 * Handles patterns like "1. question", "1) question", "1: question".
 */
export function splitNumberedQuestions(raw: string): string[] {
  const lines = raw.split("\n");
  const questions: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^\d+[.):\s]/.test(line.trim())) {
      if (current.length > 0) {
        questions.push(current.join("\n").trim());
      }
      // Strip the number prefix
      current = [line.trim().replace(/^\d+[.):\s]+/, "")];
    } else if (current.length > 0 && line.trim()) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    questions.push(current.join("\n").trim());
  }

  return questions.filter((q) => q.length > 0);
}

const KNOWN_PHASE_KEYS = new Set(HARVEST_ROLES.map((r) => r.phaseKey));

/**
 * Parse the consolidation agent's output back into a roleQuestions map.
 * Expects sections delimited by `## phase-key` headers with numbered questions.
 */
export function parseConsolidatedQuestions(raw: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKey) {
      const questions = splitNumberedQuestions(currentLines.join("\n"));
      if (questions.length > 0) {
        result[currentKey] = questions;
      }
    }
    currentLines = [];
  };

  for (const line of raw.split("\n")) {
    const sectionMatch = line.match(/^##\s+([\w-]+)/);
    if (sectionMatch) {
      flush();
      currentKey = KNOWN_PHASE_KEYS.has(sectionMatch[1]) ? sectionMatch[1] : null;
      continue;
    }
    if (currentKey) {
      currentLines.push(line);
    }
  }
  flush();

  return result;
}

/**
 * Parse the verify-consolidation agent's output into Q&A pairs per phase key.
 * Expects `## phase-key` headers, numbered questions, and `**Answer:**` markers.
 */
export function parseConsolidatedQAPairs(raw: string): Record<string, QAPair[]> {
  const result: Record<string, QAPair[]> = {};
  let currentKey: string | null = null;
  let currentQuestion: string | null = null;
  let collectingAnswer = false;
  let answerLines: string[] = [];

  const flush = () => {
    if (currentKey && currentQuestion !== null) {
      const answer = answerLines.join("\n").trim();
      if (!result[currentKey]) result[currentKey] = [];
      result[currentKey].push({ question: currentQuestion.trim(), answer });
    }
    currentQuestion = null;
    collectingAnswer = false;
    answerLines = [];
  };

  for (const line of raw.split("\n")) {
    const sectionMatch = line.match(/^##\s+([\w-]+)/);
    if (sectionMatch) {
      flush();
      currentKey = KNOWN_PHASE_KEYS.has(sectionMatch[1]) ? sectionMatch[1] : null;
      continue;
    }

    if (!currentKey) continue;

    // Detect answer marker
    if (/^\*\*Answer:\*\*/.test(line)) {
      const inline = line.replace(/^\*\*Answer:\*\*/, "").trim();
      collectingAnswer = true;
      answerLines = inline ? [inline] : [];
      continue;
    }

    // Detect numbered question start
    if (/^\d+[.):\s]/.test(line.trim())) {
      flush();
      currentQuestion = line.trim().replace(/^\d+[.):\s]+/, "");
      collectingAnswer = false;
      continue;
    }

    if (collectingAnswer) {
      answerLines.push(line);
    } else if (currentQuestion !== null && line.trim()) {
      currentQuestion += `\n${line}`;
    }
  }

  flush();
  return result;
}
