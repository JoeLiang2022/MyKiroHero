---
name: spec-methodology
description: >
  Spec-Driven Development methodology — standard approach when Worker executes spec tasks.
  Requirement analysis techniques, User Story writing, Design Doc structure, Task breakdown principles.
  Triggers: spec, requirements, user story, design, requirement analysis, design doc, acceptance criteria, verification, tasks.md, requirements.md, design.md
version: 1.0.0
allowed-tools: []
---

# Spec-Driven Development Methodology

## Why Spec?

Problems with writing code directly:
- Starting without thinking → discover wrong direction halfway through
- No acceptance criteria → don't know when it's "done"
- No design document → next person doesn't know why it was built this way

Spec's value: thinking first saves far more time than writing the spec costs.

---

## Phase 1: Requirement Analysis (requirements.md)

### How to Break Down Vague Requirements

User requirements are usually one sentence, e.g.: "Add a user login feature"

Breakdown steps:
1. Who is the user of this feature? (Admin? WA user? System?)
2. What's the trigger condition? (When is login needed?)
3. What's the success outcome? (What can they do after login?)
4. Failure scenarios? (Wrong password? Account doesn't exist?)
5. How does it integrate with the existing system? (Which modules are affected?)

### User Story Format

Format:
```
As a [role]
I want [feature]
So that [value/purpose]
```

Good example:
```
As a user
I want to receive a daily summary via WhatsApp at 9am
So that I know what happened overnight without opening the dashboard
```

Bad example:
```
As a user
I want login
So that I can login
```
→ Too vague, no value statement

### Acceptance Criteria

Every User Story must have clear acceptance criteria. Use Given/When/Then format:

```
Given: User has configured daily summary schedule
When: Every day at 9:00 AM
Then: 
  - Auto-generate yesterday's session summary
  - Send via WhatsApp to user
  - Include: completed task count, pending tasks, important events
```

### Uncertain Areas

Mark with ⚠️ and list questions that need confirmation:
```
⚠️ To confirm:
- What should the daily summary include? Sessions only or journals too?
- If there are no sessions, should we send "Nothing today"?
```

If the requirement is too vague to break down, state what information is needed in report_task_result — don't guess.

---

## Phase 2: Design (design.md)

### Structure Template

```markdown
# Design: [Feature Name]

## Overview
One paragraph explaining what to build and why this design was chosen.

## Impact Scope
- New files: list files to create
- Modified files: list files to change + what changes
- Unchanged files: explicitly list files not to touch (avoid accidental changes)

## Architecture Design
- Data flow diagram (text description is fine)
- New class / function signatures
- API endpoints (if applicable)

## Data Model
- DB schema changes (if applicable)
- New data structures

## Edge Cases
- Error handling strategy
- Concurrency issues
- Performance considerations

## Test Strategy
- What tests to write
- How to verify correctness
```

### Design Principles

1. Minimal change principle — if one file suffices, don't change three
2. Backward compatibility — don't break existing functionality
3. Follow existing patterns — see how the codebase does it, follow suit
4. Confirm impact scope first — search all callers before making changes

---

## Phase 3: Task Breakdown (tasks.md)

### Breakdown Principles

1. Each task is independently verifiable — can test after completing each one
2. Appropriate granularity — too large is hard to track, too small wastes time
3. Dependency order — build foundation first, then upper layers
4. Include tests — don't write tests last, each task includes its tests

### Format

```markdown
# Tasks

## Task 1: [Title]
- [ ] Specific step 1
- [ ] Specific step 2
- [ ] Write tests
- [ ] Verify passing

## Task 2: [Title]
- [ ] ...
```

Mark completed with ✅:
```
## Task 1: Create DB schema ✅
- [x] Create migration file
- [x] Write seed data
- [x] Test CRUD
```

---

## Common Pitfalls

1. Skipping requirement analysis and writing code directly → discover misunderstanding halfway, start over
2. Starting design with vague requirements → design doesn't match what user wants
3. Over-engineering the design → too much time on design, not enough for implementation
4. No acceptance criteria → don't know when it's done, keep changing
5. Task granularity too large → one task takes 2 hours and still not done, can't track progress
6. Forgetting to run tests → discover breakage after commit, need to fix again

## Golden Rules

**When in doubt, ask — don't guess.** Writing it in the report for Commander to relay to the user is a hundred times better than guessing wrong and redoing.

**All DB / Dashboard content must be in English.** Plan titles, task titles, strategy, report messages — all in English. Spec files (requirements.md etc.) can use Chinese since they're not stored in DB.
