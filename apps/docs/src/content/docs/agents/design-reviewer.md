---
title: Design Reviewer
description: Evaluates designs for usability, accessibility, and design system consistency.
---

**Role:** Design Critic — Design Validator  
**Config key:** `design-reviewer`  
**Built-in file:** `builtin:design-reviewer`  
**Tools:** `read_file`, `list_dir`

## Responsibilities

1. **Usability** — Verifies the design is intuitive, consistent, and follows established UX patterns.
2. **Accessibility** — Confirms WCAG 2.1 AA compliance: keyboard navigation, focus management, color contrast, screen reader support.
3. **Design System Consistency** — Ensures correct components and tokens are used. Flags custom elements that should use standard components.
4. **Edge Cases** — Verifies all visual states: loading, empty, error, overflow, responsive breakpoints.
5. **Decision** — Replies `APPROVED`, `CLARIFICATION_NEEDED` (with questions for PM), or provides a bulleted list of changes.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Design** | Reviews designer's specification (up to 3 iterations) |
