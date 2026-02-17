#!/usr/bin/env npx tsx
/**
 * Local test script for the textarea components.
 *
 * Usage:
 *   npx tsx apps/core/scripts/test-textarea.ts          # single-pane editor
 *   npx tsx apps/core/scripts/test-textarea.ts --split   # split-pane with sample context
 */

import { openSplitEditor, openTextarea } from "../src/textarea.js";

const SAMPLE_QUESTIONS = `## PM Questions — Round 1

Thank you for the feature request. I have a few clarifying questions before we proceed:

1. **Scope of the dark mode toggle:**
   Should this apply to the entire application, or only specific sections? For example, should the settings page, modals, and tooltips all respect the dark mode preference?

2. **Persistence:**
   Should the dark mode preference be persisted across sessions? If so, where — localStorage, a user profile setting in the database, or both?

3. **System preference detection:**
   Should the application automatically detect the user's OS-level dark mode preference (via \`prefers-color-scheme\`) and default to that?

4. **Transition behavior:**
   When the user toggles dark mode, should there be an animated transition between themes, or should it switch instantly?

5. **Component library considerations:**
   You're using Carbon Design System — are you aware that Carbon provides built-in theming support? Should we leverage \`@carbon/themes\` for the dark mode tokens, or do you have a custom design palette in mind?

Please answer these questions so I can produce a complete specification.

---

*Note: If any of these questions aren't relevant, feel free to skip them and I'll use my best judgment.*`;

const useSplit = process.argv.includes("--split");

if (useSplit) {
  console.log("Opening split-pane editor...\n");
  const result = await openSplitEditor(SAMPLE_QUESTIONS, {
    editorTitle: "Your Answer",
    contextTitle: "PM Questions",
  });

  if (result === undefined) {
    console.log("\n❌ Cancelled");
  } else if (result === "") {
    console.log("\n⏭️  Skipped (AI will use its judgment)");
  } else {
    console.log("\n✅ Submitted:");
    console.log(result);
  }
} else {
  console.log("Opening single-pane editor...\n");
  const result = await openTextarea();

  if (result === undefined) {
    console.log("\n❌ Cancelled");
  } else {
    console.log("\n✅ Submitted:");
    console.log(result);
  }
}
