# Gateway CHANGELOG

Append change records here after Worker completes a task. Commander merges into SKILL.md during heartbeat.

---

## 2026-02-21 [task-20260221-114357-c35]
- Modified src/gateway/dashboard/app.js — Added mobile responsive support: isMobileViewport(), initMobileSwipeDismiss() (swipe-down gesture to dismiss overlay), mobileCloseAndNavigate() (close overlay before navigation on mobile), disabled drag resize on mobile, auto-collapse on ≤1024px, mobile-aware expandActivityDrawer
- Modified src/gateway/dashboard/style.css — Added @media 768px rules: full-screen overlay (.activity-drawer.expanded fixed positioning), sticky header, hidden drag handle, touch-friendly targets (44px min), date bar scroll snap, summary bar truncation, slide-up animation; added @media 1024px: reduced expanded height (250px)
- Created tests/dashboard-mobile.test.js — 42 tests for mobile overlay, touch targets, swipe dismiss, navigation, drag handle, summary bar, auto-collapse, date bar scroll snap

## 2026-02-21 [task-20260221-112341-216]
- Modified src/gateway/dashboard/app.js — Added bidirectional timeline navigation: initTimelineNavigation (click delegation), navigateTimelineToPlan, navigateTimelineToTask, autoShrinkDrawer, highlightTimelineItem (reverse nav); added data-plan-id to mcRenderTlTaskItem; added data-task-id to task cards in renderPlanDetail; added reverse nav hook in selectPlan
- Modified src/gateway/dashboard/style.css — Added tl-highlight-pulse and task-card-flash keyframe animations, .tl-item.highlight and .task-card.flash classes
- Created tests/dashboard-timeline-nav.test.js — 38 tests for timeline navigation logic

## 2026-02-21 [task-20260221-110331-c94]
- Modified src/gateway/dashboard/app.js — Refactored mcRenderTimeline() to render into #activity-drawer-body; added collapsible day sections (toggleDaySection, collapsedDays), date filter (clearDateFilter), vertical timeline connectors; mcLoadTimeline now uses drawer date range; auto-fetch on drawer expand
- Modified src/gateway/dashboard/index.html — Removed old #mc-timeline-view element
- Modified src/gateway/dashboard/style.css — Added tl-* activity list styles (tl-connector, tl-item, tl-day-group, tl-day-header, tl-section-label, tl-empty, tl-date-filter-bar); replaced .mc-timeline-view with display:none stub
- Added tests/dashboard-activity-list.test.js — 40 tests for activity list rendering, day grouping, collapsible sections, date filter, connectors, section ordering, data attributes

## 2026-02-21 [task-20260221-022928-87b]
- Modified src/gateway/mission-control-routes.js — Added POST /plans/:id/clone endpoint for plan cloning
- Modified src/gateway/dashboard/app.js — Added retryAllFailed(), cancelAllRunning(), clonePlan() functions + updated renderPlanDetail() with new bulk action buttons
- Modified src/gateway/dashboard/style.css — Added styles for .retry-all, .cancel-all, .clone button variants

## 2026-02-21 [task-20260221-020915-4f6]
- Modified src/gateway/mission-control-routes.js — Added BugTracker proxy routes (GET /issues, GET /issues/stats) with graceful offline handling
- Modified src/gateway/dashboard/index.html — Added collapsible issue summary widget HTML
- Modified src/gateway/dashboard/app.js — Added issue panel state, fetchIssueStats/fetchIssues/renderIssueCounts/renderIssueList functions, auto-refresh on init/visibility/reconnect
- Modified src/gateway/dashboard/style.css — Added issue panel styles (collapsible, priority emojis, status tags)

## 2026-02-21 [task-20260221-013057-52b]
- Modified src/gateway/dashboard/app.js — Added reusable showConfirm() dialog, setBtnLoading() utility, executeSingleTask(), wired confirm to delete plan + cancel task, enhanced retry to auto-execute
- Modified src/gateway/dashboard/style.css — Added confirm dialog and button loading state styles
- Modified src/gateway/mission-control-routes.js — Added ?taskId query param to POST /plans/:id/execute for single-task execution

## 2026-02-20 [task-20260220-183122-2d2]
- Added POST /api/workers/:id/ops-report endpoint in src/gateway/server.js — stateless ops result reporting from workers
- Modified POST /api/workers/:id/ops in src/gateway/server.js — conditional session handling (skip newSession for busy workers)
- Added tests/gateway/ops-report.test.js — 14 tests for ops-report and session handling

## 2026-02-20 [task-20260220-054359-44e]
- Modified src/gateway/session-logger.js — Added triggerAutoSummary() method, called from notifyMemoryEngine() on session end

## 2026-02-16 [task-20260216-130317-45e]
- Modified src/gateway/server.js — Added POST /api/workers/:id/reset endpoint to force-reset stuck workers to idle
- Added src/gateway/server-worker-reset.test.js — Unit tests for the new reset endpoint

## 2026-02-17 [task-20260217-022231-4e7]
- Modified src/gateway/mission-control-db.js — Added searchPlans() method for keyword + layer search
- Modified src/gateway/mission-control-routes.js — Added GET /api/mc/search endpoint

## 2026-02-17 [task-20260217-022231-823]
- Modified src/gateway/dashboard/app.js — Added sidebar search with keyword highlighting in plan/task titles
- Modified src/gateway/dashboard/index.html — Added search input to sidebar
- Modified src/gateway/dashboard/style.css — Added search input, highlight, and matched-task styles

## 2026-02-21 [task-20260221-010150-7b6]
- Modified dashboard/app.js — Added toast notification system (showToast), fixed api() with error handling (HTTP status, non-JSON, network failure), wired WS events to toasts (task done/failed, worker offline, plan completed, connection lost/reconnected)
- Modified dashboard/index.html — Added toast container div
- Modified dashboard/style.css — Added toast notification styles (slide-in animation, 4 levels)

## 2026-02-21 [task-20260221-015718-4d8]
- Modified src/gateway/dashboard/index.html — Added marked CDN for markdown rendering
- Modified src/gateway/dashboard/app.js — Strategy rendered with marked.parse(), task output now collapsible (collapsed default, auto-expand running), separated progress log from final result, added copyOutputText() with clipboard fallback, WS handler auto-expands details on streaming output
- Modified src/gateway/dashboard/style.css — Added collapsible output details/summary styles, copy button, strategy markdown rendering styles

## 2026-02-21 [task-20260221-024655-3f3]
- Modified src/gateway/dashboard/app.js — Added keyboard shortcuts (/, Ctrl+K, ↑/↓, E, N, W, ?, Esc) with sidebar navigation state
- Modified src/gateway/dashboard/index.html — Added shortcut help overlay HTML
- Modified src/gateway/dashboard/style.css — Added shortcut overlay styles and .keyboard-active sidebar highlight

## 2026-02-21 [task-20260221-112341-348]
- Modified src/gateway/dashboard/app.js — Added real-time WS updates for Activity Drawer: debouncedActivityRefresh() with 2s debounce, collectItemKeys() for new-item detection, _renderNewKeys for fade-in animation on new items; WS events mc:plan_created/mc:plan_updated/mc:task_status now trigger debounced refresh; state-aware optimization (hidden=skip, collapsed=summary only, expanded=both); timer cleanup on hideActivityDrawer
- Modified src/gateway/dashboard/style.css — Added tl-fade-in keyframe animation and .tl-item.new-item class for fade-in effect on new activity items
- Created tests/dashboard-ws-updates.test.js — 24 tests covering WS event triggers, debounce behavior, state-aware optimization, timer cleanup, new-item detection, fade-in animation class
