# ChatGPT's Dots engine and sidebar: what to roll in (Oct 2026)

Research for "a more impressive Dots engine" and "a sidebar like ChatGPT's". It
builds on the earlier pass (`dots-and-scheduled-agents.md` in the
`.context/research/chatgpt/` notes from the t3code worktree, build 26.930) and
on our current Dots design in PR #133 (`docs/dots.md`, ticket 172). Findings
lands here, in `.context/research/`, as `.wayfinder/README.md` asks; the tickets
at the end are proposals with provisional ids.

## Method and evidence

- **Target:** `/Applications/ChatGPT.app` **26.1007.71326** (the merged
  ChatGPT + Codex Electron app). This is the user's own install, studied for
  design only. No code or assets are copied here; we describe behaviour and
  structure.
- **REA:** `analyze_javascript_application` bound `app.asar` (sha256
  `2f231a64…08ded`, 16,240 files, integrity contradictions only on native
  `.node` addons) and confirmed a static, never-executed inventory.
  `open_binary` bound the Mach-O (`239db1b9…b552a`, arm64).
  `observe_native_ui` on the running app (pid 86569, window 18145) **failed**:
  REA's Swift helper timed out in `xcrun`, the same CommandLineTools problem
  the earlier pass hit. So there's no runtime accessibility tree or screenshot.
  Everything below is static.
- **Static extraction:** a read-only `asar extract` to
  `/tmp/rea-chatgpt-1007/out`, then a scrape of `id` and `defaultMessage` pairs
  from 14,634 non-locale chunks. That gave **51,594 English strings, keyed by
  message id and chunk** (`/tmp/rea-chatgpt-1007/en.tsv`). Evidence below is
  cited as `chunk › message.id`. Keybindings come from the command registry in
  `app-initial` (`{id, defaultKeybindings}` literals). CSS custom properties
  come from `app-initial-*.css` and `app-shared-*.css`.
- **Confidence:** strings and registries prove what ships. Behaviour (ordering,
  timing, what a server does) is inferred from them and marked *inferred*.
  Some strings may sit behind flags that aren't on for this account.

## A. Dots (always-on agents) and scheduled tasks

### A1. Identity and the "monothread"

- **One primary Dot, and it is a thread.** `app-initial ›
  sidebarElectron.monothread.chatGpt` ("ChatGPT"), `monothread.loadFailed`
  ("Couldn't open your ChatGPT conversation"), `monothread.unavailable` ("No
  ongoing ChatGPT conversation is available yet"). Also `orbit.primary.*`:
  "Your primary {dot} opens from the sidebar and receives your texts", "Choose
  your primary {dot} **[internal only]**". The multi-Dot picker is
  internal-only in this build. What ships to users is **one Dot = one ongoing
  conversation**, which matches our "one Dot, a Dot is a thread" decision.
- **Opened by a global command:** `openOrbit` is bound to **⌘.**, and it is
  exempt from the "don't fire while typing" guard (it's on the same allow-list
  as `toggleSidebar`).
- **Its chats are kept out of Recents:** `sidebarElectron.recents.showYourDot`
  ("Your {dot}'s chats") and `recents.hideYourDotChats` ("Hide all chats from
  your {dot}"), with a saved preference (`recents.yourDotSaveError`). The
  Dot's side-conversations are filtered out of the main chat list by default.
- **Reply chains:** `aeon.replyChain.*` ("Reply chain", "{count} replies",
  "View replies", "Follow up", "Load earlier messages", "Replies currently
  support text only"). Inside the one Dot thread, an individual result (a run's
  output) can grow its own threaded replies, Slack-style, so the main thread
  stays a readable timeline. `orbit.subthread.goToChat` and
  `aeonSubtasks.toggle` ("{count} subtasks", "…unread updates") show work fanning
  out into sub-tasks that roll up into the parent message.
- **Activity, tasks and outputs** as views on the thread:
  `orbit.activity.liveTask.status` (`in_progress → Working`, `failed → Needs
  attention`, `interrupted`), `orbit.tasks.heading`, and `orbit.outputs.*` ("No
  outputs yet": the files and artifacts the Dot produced).
- **Lifecycle and safety** (unchanged from 26.930): reboot keeps
  conversations, memories and schedules (`orbit.primary.reboot.description`);
  auto-review pauses it (`orbit.safety.guardianExplanation`); a paused control
  (`orbit.pausedControl`); "I understand / I want to proceed" confirmation
  before resuming.
- **Plan gating:** `orbit.availability.planIneligible`, plus "Your
  conversations and past activity are still here" when a plan lapses.
- **Channels:** iMessage-style effects (`aeon.imessage.action.*`), Slack,
  Teams, email, phone, voice call with a draggable call panel
  (`orbit.voiceCall.movePanelHelp`), and a desktop notification prompt
  (`orbit.notificationPrompt.*`). `aeon.messaging.browserAuth.*` is a
  **sign-in hand-off**: when the Dot's browser needs a login, it posts a
  "Sign in to {site}" card, the user enters details in a secure view, then
  "Continue task".
- **Onboarding** (`orbit.onboarding.*`): name, colour, then connect Calendar,
  Email, Drive, Contacts and Teams ("Be prepared for every meeting"), then
  "Setting up… Getting plugins ready… Preparing skills". It's
  context-first: the Dot is useful because it's connected.

### A2. Scheduled tasks ("automations"): a separate object that can target a thread

This is the most useful finding for our design.

- **Heartbeat = a schedule attached to an existing chat.** `automation-row-summary
  › inbox.automations.rowSummary.heartbeat` ("Heartbeat • {thread}"),
  `sidebarTaskRow.heartbeatAutomation.nextRun` ("Next run: {nextRunLabel}")
  on the **chat's sidebar row**, `codex.localTaskRow.attachedHeartbeatAutomation`
  ("Scheduled task attached"), and the message itself is labelled
  `localConversation.heartbeatUserMessage.automation` ("**Sent by scheduled
  task**"). Schedules are their own objects; the target is a thread. That is
  exactly our "schedules are separate from the Dot but can target it".
- **Destination:** `automation-notification-policy-dropdown ›
  settings.automations.destination.*`: "New chat each run", "New chat for this
  task", or a chosen chat through a `threadPicker` (Pinned chats, Other chats,
  search). It is required when that mode is picked
  (`inbox.automations.targetThread.required`). Also
  `automations.configuration.replies`: "Listen to replies in the threads".
- **Archive coupling:** archiving a chat that has a heartbeat asks first
  ("Archive chat and remove scheduled task?", `threadHeader.archiveConfirmHeartbeat*`).
  The same applies to bulk and project archive
  (`archiveSelectedThreads.confirmScheduled*`,
  `archiveProjectThreads.confirmRunningScheduledSubtitle`).
- **Triggers beyond time** (`automations.configuration.*`,
  `automations.polling.*`, `inbox.automations.cloud.webhook.*`):
  - **schedule:** Interval / Daily / Weekdays / Weekly / Monthly / Custom, a
    one-time date, "End repeat: Never / On date", and an "Edit schedule rule"
    RRULE editor. The fallback summary is "Custom schedule".
  - **app event:** "Trigger on {app} event", "GitHub event", and Slack
    "new messages or thread replies matching your filters".
  - **webhook:** a Trigger, a Condition and a Prompt, with a queue of
    "{count} events waiting". A paused task holds events ("Resume to process
    pending events"). "Automations triggered by events can't be run manually".
  - **polling / "Monitoring":** "Describe the event to watch for", with a
    natural-language condition checked "Every {n} minutes/hours".
- **Runs:** status union `in_progress | failed | no_update | completed`
  (`automations.runs.status`). **`no_update` ("No update from this run")** is
  the quiet outcome: the run found nothing worth saying.
- **Notifications:** All runs / Failed runs only / Important updates (plus
  None in the older build). "Important" relies on the run classifying itself;
  `no_update` is the other half of that.
- **Cost and limit controls:**
  - a minimum interval per account and per team
    (`automations.cloudSchedule.personalIntervalLimit`: "Your account allows
    runs every {minutes} minutes or longer"; `teamIntervalLimit`;
    `polling.noIntervals`: "This team cannot schedule checks at its current
    limit");
  - a cap on instruction length (`instructionsCharacterLimit`);
  - a per-task Model and Reasoning choice;
  - cloud vs device (`executionLocation`): cloud runs lose chat, project,
    model and reasoning overrides;
  - a read-only default sandbox;
  - a usage meter in the sidebar (`lunaReserve.*`: "Advanced models reset
    {time}", "% remaining") and `sidebarElectron.usageAlert.*`.
- **Templates and suggestions:** "Recommended" suggested routines, each
  dismissable. Empty-state suggestions are Daily brief, Follow-up monitor and
  Weekly review, with exact prompts (`inbox.automations.emptySuggestion.*`).
  Plugin templates: "Set up {name} scheduled task", with "Reset to defaults".
- **Sharing and teams:** `automations.sharing.*` (publish or share a task) and
  team-owned tasks (`scheduled.sidebar.ownership`: Personal / Team).
- **UI surfaces:** a **Scheduled** nav destination (`inboxRouteNavLink`) and a
  scheduled sidebar with search, filters (status, ownership, team), Upcoming,
  Inactive, "No runs yet" and "Show older". There's an automation **side-panel
  tab** (`automation-side-panel-tab`, "Apply changes" / "Create scheduled
  task", so the model proposes a task and the user applies it), Run now,
  Pause/Resume, and "Mark all as read".

## B. The sidebar

### B1. Structure (top to bottom; *inferred* order from the nav registry and copy)

1. **Mode switch:** ChatGPT / Work / Codex (`productMode.*`, "Switch mode,
   current mode: {mode}").
2. **Primary nav:** New chat, Search (⌘K), Library, Images, Projects,
   Scheduled, Plugins/Skills, GPTs, plus pinned destinations.
   `sidebarCustomization.*` lets you **pin destinations** ("Pin to sidebar",
   "Up to {limit} pins allowed"), reorder them by keyboard (Space to pick up,
   arrows to move, Space to drop, Esc to cancel, with live-region
   announcements: "{destination} moved to position {p} of {n}"), "Reset
   customization", and an "Explore" overflow for the rest.
3. **Your dot** (the primary Dot, `orbitNavLink`), with an unread dot and a
   preview hover ("No recent replies", `orbitPreview.*`).
4. **Priority / Activity:** chats that are **unread, active, or awaiting a
   response** (`priorityThreads.coachmark.description`). Its empty state is
   "Nothing needs attention". It has Mark all as read, "Clear read chats",
   "Archive chats" (recent threads excluded), and a filter toggle
   `togglePriorityFilter` (⌥⌘U). `nextThreadNeedingAttention` (⌥⌘A) jumps to
   the next one.
5. **Pinned:** reorderable ("Couldn't save pinned order"), with Pinned
   options.
6. **Projects:** folder rows that expand and collapse, with a hover card
   ("{n} tasks · {n} active · {n} unread · {n} waiting", Edit, Pin project,
   inline rename). "New chat in {projectName}" and "Mark all as read" are on
   the row's menu. Creating a project sets name, icon and colour, plus a
   **memory scope** (Default vs Project-only, *can't be changed later*),
   custom instructions (with a character count), and sources (files, Drive,
   Linear, Slack, websites).
7. **Custom sections:** user-made groups of chats and projects ("Group chats
   and projects however you like"), each with New chat, Mark read, Archive
   chats, Edit and Remove.
8. **Chats (Recents):** a **flat list with no date headings.** It sorts by
   Last updated / Created / Manual order (`sortMenu.*`), offers "Organize
   sidebar: By project / In one list" (`flatProjectSidebar.*`), filters to All /
   Chat / Work, and pages with **"Show more" / "Show less"** instead of an
   endless scroll. Date words appear only inside the Priority section
   (`priorityThreads.recent.today/yesterday`) and in thread timestamps.
9. **Footer:** account, settings, an update banner, the usage meter, and a
   "Getting started" checklist ("{n} of {m}", Hide setup).

### B2. Row interactions

- **Menu:** Rename (a dialog: "Keep it short and recognizable", with a
  **thread emoji**), Pin/Unpin, Mark as read/unread, Move to project / Remove
  from project, Share, Archive, and Delete (a confirmation dialog;
  "Permanently delete").
- **Hover card** on a thread: Chat vs Work, Runs in the cloud vs on your
  computer, and a shared-with-team icon. A PR status badge for code tasks.
- **Multi-select and bulk:** archive the selection, with partial-failure
  toasts ("Archived {n}; {m} failed"), and remove the selection from projects.
- **Archive suggestion:** after you archive several chats in a group, it
  offers "Archive all remaining {count} chats in {groupName}?"
  (`sidebar-archive-suggestion`).
- **Archive view** in the sidebar itself (`archivedTasks.*`, "Back to
  sidebar"): search, filters (Project, Type), Unarchive, and "No matches yet.
  Show more to keep searching".
- **Undo:** `undoAppAction` (⌘Z) at app level, so an archive or move can be
  undone *(inferred)*.
- **Errors are per action:** "Failed to archive conversation", "Couldn't move
  chat", "Your title is saved, but the emoji couldn't be saved". Optimistic
  updates with rollback *(inferred)*.

### B3. Keyboard (from the command registry, `defaultKeybindings`)

| Command | Keys |
|---|---|
| toggleSidebar | ⇧⌘S (also ⌘B) |
| searchChats | ⌘K |
| newTask (new chat) | ⇧⌘O |
| temporaryChat | ⇧⌘N |
| archiveThread | ⇧⌘A |
| deleteChat | ⇧⌘⌫ |
| markThreadUnread | ⇧⌘U |
| toggleThreadPin | ⌥⌘P |
| previousThread / nextThread | ⇧⌘[ / ⇧⌘] |
| previous/nextRecentThread | ⌃⇧Tab / ⌃Tab (MRU order) |
| nextThreadNeedingAttention | ⌥⌘A |
| togglePriorityFilter | ⌥⌘U |
| clearAllUnreads / focusMainChat | ⇧Esc |
| openOrbit (your Dot) | ⌘. |
| showKeyboardShortcuts | ⌘/ |
| undoAppAction | ⌘Z |

### B4. Collapse, scrolling, performance and motion

- **Collapse to a rail.** `sidebarElectron.rail.*` (Chats/Home, Plugins,
  Settings, plus pinned destinations you can drag to reorder). Collapsed isn't
  hidden: it becomes an icon rail.
- **No list virtualiser.** No TanStack Virtual or Virtuoso signatures appear in
  the shell chunks. Rows use **`content-visibility: auto` with
  `contain-intrinsic-block-size: auto var(--height-token-row)`**, so off-screen
  rows skip layout and paint, and "Show more" paging keeps the DOM bounded.
- **Scroll-edge fades:** `--sidebar-scroll-mask-image`, header and footer fade
  distances. The list fades under a sticky header and footer instead of
  showing a hard line.
- **Quiet row actions:** `--sidebar-row-action-opacity: 0 → 1` and
  `--sidebar-row-action-width: 0 → 5 spacing`, so the action slot reserves no
  title width until hover or focus.
- **Loading and empty states are text, per section:** "Loading chats",
  "Loading projects…", "Checking unread chats…", "No chats", "Nothing needs
  attention", "Projects couldn't be loaded / Retry". There's a "Loading
  sidebar…" fallback for lazy sections.
- `prefers-reduced-motion` is honoured in the shell CSS (3 hits). No
  framer-motion in the shell.

## Schedules: a deep dive

Same target and method. A second live capture with `observe_native_ui` timed
out the same way (`xcrun`, 60 s), so this is static again. This pass also
read the **main-process bundles** (`.vite/build/main-*.js`,
`src-DCNiwad_.js`, `worker.js`), where the local scheduler lives. Evidence
`main › …` and `src › …` names the minified function or the literal.

### S1. Data model

- **Local store (SQLite, `src › CREATE TABLE automations`):** `id`, `name`,
  `prompt`, `status` (default `'ACTIVE'`; the bundle also has `PAUSED` and
  `DELETED`), `next_run_at`, `last_run_at`, `cwds` (JSON), `target_type`,
  `project_id`, **`rrule`** (default `FREQ=HOURLY;INTERVAL=24;BYMINUTE=0`),
  `model`, `reasoning_effort`, `created_at` and `updated_at`.
- **`automation_runs`:** **keyed by `thread_id`**, so every run is a thread.
  It also has `automation_id`, `status`, **`read_at`**, `thread_title`,
  `source_cwd`, **`inbox_title`**, **`inbox_summary`**, `created_at` and
  `updated_at`. A run carries its own unread state and a short inbox
  title and summary for list rows.
- **The in-memory shape is a discriminated union** (`main › R_e/z_e`):
  - `kind: "cron"`: `projectId`, `executionEnvironment` (`local | cloud`),
    `model`, `reasoningEffort`, `pluginTemplateId`, and `autoArchive` (it
    archives its own run chats);
  - `kind: "heartbeat"`: **`targetThreadId`**, with `model` and
    `reasoningEffort` forced to `null` (it inherits the thread's settings).

  Both kinds carry `name`, `prompt`, `status`, `rrule`, `notificationPolicy`,
  `nextRunAt`, **`nextRunNominalAt`** and `lastRunAt`. A cloud row without a
  `target_thread_id` can't be a heartbeat.
- **Cloud tasks** are a separate, server-held store (`inbox.automations.cloud.*`,
  "Cloud scheduled task"). The "Sync your local automations" migration moves
  local definitions to the account, keeps execution on the device, and
  encrypts titles, prompts and paths (`habitatMigration.privacyDisclosure`).

### S2. Recurrence, time zones and DST

- **RRULE everywhere,** parsed with the bundled `rrule` library (`RRule`,
  `DTSTART;TZID=…`). The UI presets compile to RRULE: Once (date and time,
  within two years, and not in the past: `editor.dateInPast`,
  `dateTooFar`), Interval in minutes or hours, Hourly, Daily, Weekdays,
  Weekly, Monthly (day N), Yearly, and Custom (days of the week or month, an
  "End repeat" date). "Edit schedule rule" is the raw editor. A one-time rule
  is `COUNT=1` (`src › qF`); once it fires, the next is `null` and the task
  shows **Completed**.
- **Time zone:** a searchable picker ("Search time zones…") with friendly
  names (Pacific, CET, IST…), stored as the TZID. DST is handled by
  rrule's zone-aware expansion *(inferred)*: a "9:00 daily" stays 9:00 wall
  time across the change. Interval schedules count elapsed time instead
  (`ql`: `scheduleKind: wall_clock | interval`).
- **Deterministic jitter** (`src › KF/YF/XF`): hourly, daily and weekly runs
  on a round minute get a **±300 s** offset (±119 s if the rule has several
  minutes). The offset is `sha256(salt:id:nominalTime)` with a per-install
  salt file `.run-jitter-salt`. `nextRunNominalAt` keeps the true time for
  display while `nextRunAt` is the jittered fire time, which avoids
  thundering herds at :00.
- **Natural language:** there's no parser in the UI. The conversational path
  is the model itself: "Ask ChatGPT to schedule tasks, set reminders, or
  monitor for updates", and "Create with ChatGPT" seeds the prompt *"Let's set
  up a scheduled task together… interview me… what I need scheduled and when
  it should run"*. The model then emits an `automation_update` directive.

### S3. Where schedules are created and edited

- **From chat:** the `automation_update` directive has modes **`create |
  edit | delete | view | design`** (`main › mode` literals). It renders in
  the transcript as **Proposed / Proposed update / Deleted** cards
  (`automation.updateDirective.*`), plus an automation side-panel tab with
  "**Create scheduled task**" / "**Apply changes**". The model proposes and
  the user applies. The plan card is `chatgptConversations.automationPlan.*`
  ("Open plan: {title}").
- **Composer tips** suggest turning a repeated request into a task
  (`composerTips.recurringWork`, "Schedule task"). The scheduled page has its
  own composer ("Schedule a task", `automations.scheduled.composer.placeholder`).
- **From a chat:** the thread header shows the attached task ("Loading
  scheduled task…", "Scheduled task unavailable"), and the sidebar row shows
  "Next run: …".
- **Schedules page** ("Scheduled" in the nav): a list with search, filters
  (Active / Paused / Completed, Personal / Team), Recommended suggestions,
  templates, and a detail panel (Prompt, Schedule, Time zone, Model,
  Reasoning, Runs on, Notifications, Project, Destination), with **Save** and
  **Save and run now**.

### S4. Lifecycle actions and run history

- **Run now** ("Run the saved instructions once"). It's disabled for
  event-triggered tasks, and it records `runTrigger: run_now` vs
  `scheduled`.
- **Pause/Resume** per row (`row.toggle`).
- **Delete** asks first ("Delete {name}?… permanently delete the scheduled
  task and stop future runs"). Archiving the target thread removes the
  heartbeat (§A2).
- **Run history:** in the detail panel and the scheduled sidebar ("No runs
  yet", "Show older", "Run history is unavailable"). Each run has a status
  (`in_progress | failed | no_update | completed`) and opens its thread. The
  row reads "Last ran {time} · Next {time}" (`detailRunTiming`). "Mark all as
  read" clears run unreads.

### S5. Destinations and how runs post

- **Cron** runs start a new thread each run (`automation_runs.thread_id`),
  optionally in a project. "New chat for this task" reuses one dedicated
  thread. `autoArchive` tidies them.
- **Heartbeat** runs post the prompt into the target thread as a user turn
  labelled "**Sent by scheduled task**", using that thread's model,
  permissions and collaboration mode (`heartbeatThreadPermissions`,
  `heartbeatThreadCollaborationModes`).
- **A busy thread defers, it doesn't skip** (`main › xu/Kl`): if the target
  thread is active (a turn in flight, or awaiting the user), the heartbeat
  is "blocked by thread state" and retried every **60 s** (`Rl=6e4`) until it
  can run or its next scheduled time arrives, whichever is first.

### S6. Failure, missed runs and where execution happens

- **Local ("This device") runs need the app running.** The scheduler is a
  `setInterval` tick in the Electron main process (`unref`'d, aborted on
  dispose), and it listens to `powerMonitor` suspend and resume. On start it
  "settles interrupted automation runs", marking runs that were in flight
  when the app quit.
- **Missed runs collapse to one** (`src › KF`): the next time is computed from
  `max(now, lastNominal)`. After sleep or a closed app, an overdue task fires
  **once** on the next tick, then resumes its normal cadence. There's no
  backfill of every missed slot. A one-time task that was missed still fires
  once, late.
- **Cloud runs** are server-side: they run "even when this device is offline".
  The trade-off is stated in the UI: "Chat, project, model, and reasoning
  settings aren't available for cloud tasks". One-time schedules, end dates
  and event triggers require cloud (`configuration.localDateUnavailable`,
  `localEventUnavailable`).
- **Failure:** the run status is `failed`, the row shows "Last run failed ·
  Retry", and there are save and status errors. **No automatic retry** shows
  up in the scheduler path *(bounded negative)*. A failure notifies under
  every policy except None.
- **Restart safety:** the app won't restart for an update while
  `automation.tick` or `automation.heartbeat` is running
  (`getRestartBlockers`).

### S7. Notifications: the model decides

- **Policies:** All runs / Failed runs only / Important updates (`all |
  failed_runs_only | …`).
- **Decision protocol** (`src › AS/Po/Fo`):
  - a cron run's last agent message ends with
    `<decision>NOTIFY|DONT_NOTIFY</decision>`, plus an optional notification
    text;
  - a heartbeat reply of exactly `DONT_NOTIFY`, or an empty reply after a
    successful turn, counts as **silent**;
  - `failed_runs_only` overrides: it notifies only if the run didn't
    complete.
- **Silent heartbeats leave no trace:** `latestTurnIsSilentHeartbeat` means
  the turn doesn't mark the thread unread and doesn't notify. The thread stays
  quiet unless there's something to say.
- **Channels:** desktop notifications (with an enable prompt), plus the Dot's
  messaging channels for Dot-owned tasks.

### S8. Limits, quotas and gating

- **A minimum interval per account and per team,** fetched from the server:
  "Your account allows runs every {minutes} minutes or longer", "This team
  allows…", "Choose an interval of {minutes} minutes or longer". Polling
  monitors: "This team cannot schedule checks at its current limit".
- **Caps:** an instructions character limit (`instructionsCharacterLimit`),
  one-time dates no more than 2 years out, and "Too many tasks to load" when
  listing team scopes.
- **Cost control by default:** local scheduled runs get a **read-only
  sandbox** and `approvalPolicy: never` (`src › Nn`: `permissions:
  ":read-only"`), so an unattended run can't ask and can't write. There's a
  per-task model and reasoning choice, and the sidebar usage meter covers
  everything.
- **Plan gating:** Dots are plan-gated (`orbit.availability.planIneligible`).
  No schedule-specific tier strings were found *(bounded negative)*. Interval
  floors differ by account and team, which is the lever plans use
  *(inferred)*.

### S9. Mapping to our design and PR #133

| ChatGPT | PR #133 today | Proposal |
|---|---|---|
| Union `cron \| heartbeat(targetThreadId)` | `dot_schedule.dot_id`; runs always post to the Dot's conversation | Schedules become their own object with `target: dot \| conversation` (decision: separate, can target the Dot). 173a/173. |
| RRULE + TZID, Once, End repeat, `COUNT=1` → Completed | 5-field cron + IANA tz (`policy.ts › nextRunAt`, `cron-parser`); presets daily/weekdays/weekly | Keep cron as storage for now (cron-parser is DST-correct). Add `runOnceAt` and `endsAt` columns, and a `completed` status. RRULE only if monthly-by-weekday is needed. 173. |
| `nextRunNominalAt` + deterministic ±300 s jitter | none | Add jitter to `nextFor` for round-minute schedules, deterministic per schedule id (pure, testable), and show the nominal time. 173. |
| Missed runs collapse to one | the claim moves `next_run_at` from now: also collapses (server-side, so only server downtime misses) | Keep. Document it, and add a `missedSlots` count on the run for transparency. |
| A busy thread defers every 60 s | skips if the last run is still going | **Defer** (re-claim next tick) up to the next slot instead of skipping, and skip if a human is mid-turn in the target thread. 173. |
| `<decision>NOTIFY\|DONT_NOTIFY</decision>`, silent heartbeat | no notify policy; every run posts | Our `report` tool (175) is the structured equivalent. `no_update` = silent: no unread, collapsed in the thread. |
| Read-only, `approvalPolicy: never` unattended | `withDotPolicy` withholds approval tools; `autoApproveTools` | Same idea, already done. Add **read-only by default** for heartbeats on non-Dot chats. 175. |
| Minimum interval per account/team | none | `dots.minIntervalMinutes` in config, per user, with an org override later (D17). 175. |
| Model proposes `automation_update` (create/edit/delete/view); user applies | `schedule_task` (asks approval when present) / `manage_scheduled_tasks` | Render the tool call as a **Proposed schedule card** with Apply/Edit (one component for create and update). New ticket 181. |
| Run history per task, `read_at` and inbox summary per run | `dot_run` (trigger, run) + `dot.lastViewedAt` | Add `outcome`, `summary`, `readAt` to `dot_run` (renamed `schedule_run`). 173a/175. |
| Cloud vs device | always server-side (pg-boss) | Nothing to copy. We're cloud-only by design (D4). Desktop "this device" runs are out of scope. |
| Archive the thread → remove its task | not handled | Pause, and ask in the archive dialog. 173. |


- **Sidebar** (`packages/chat-ui/src/sidebar/`, tickets 009 and 071): it has
  pinned, Today / Yesterday / Previous 7 days / Older groups
  (`model/date-groups.ts`), inline rename, archive, a 200–420px drag resize,
  `[` to toggle, edge peek, and IndexedDB-persisted cache (D28). It has no
  projects, unread state, sort options, Show-more paging, bulk actions,
  archive view or rail.
- **Dots** (#133): tables `dot`, `dot_schedule` (cron + tz) and `dot_run`. A
  one-minute `dot.tick` claims due rows with `SKIP LOCKED` and an idempotency
  key per occurrence. Unattended runs withhold approval tools. It auto-pauses
  after 3 failures, keeps an unread marker, and has "While you were away",
  the profile tabs, voice, a computer, and the `schedule_task` tool. Gaps it
  lists: **no notify policy**, and multiple Dots, each with one conversation.

## Worth rolling in (ranked by impact ÷ effort)

| # | Idea | Impact | Effort | Maps to | Conflict with the user's decisions? |
|---|---|---|---|---|---|
| 1 | **Schedules target a thread ("heartbeat")**: move the schedule's FK from `dot` to a target `conversation` (Dot thread or any chat), with destination `thread \| new_chat_each_run`. Show "Next run" on the sidebar row and label messages "Sent by scheduled task". Archiving asks "and remove scheduled task?" | High | M | D4 (the `schedule` table the user edits), #133 `dot_schedule` | **Aligns.** It is the decision "schedules separate, can target the Dot", made literal. `new chat each run` is optional; default to the target thread. |
| 2 | **One Dot per user**: drop the multi-Dot list and primary picker. The Dot is a pinned thread at the top of the sidebar, opened with ⌘., and hidden from Recents | High | S | #133 identity, D10 | **Aligns.** ChatGPT itself keeps the multi-Dot picker internal-only. The #133 multi-Dot UI conflicts and should shrink. |
| 3 | **Run outcome `no_update` + notify policy** (`all \| failures \| important \| none`). The run ends with a structured `report` tool call (`{ outcome: update \| no_update \| needs_attention, summary }`). `no_update` posts a collapsed line, not a message, and never notifies | High | S–M | D4 run states, D15 Decider (classify "important"), #133 gap "no notify policy" | Aligns, and it **saves tokens**: there are no follow-up turns on quiet runs. |
| 4 | **Cost guardrails on schedules**: a minimum interval from config (`dots.minIntervalMinutes`, default 60), a per-run token/step budget, a daily run cap per user, a cheap model by default (#133 already uses `fast`), and a usage line on the schedule row | High | S | D18 config, D21 usage rollups, memory "token spend guardrails" | **Required** by the cost decision. Make every limit config-driven, defaulting conservative. |
| 5 | **Priority / Activity section in the sidebar**: unread, running and awaiting-approval chats in one section, with ⌥⌘A "next needing attention" and ⇧Esc "clear unreads". Needs a per-user `last_read_at` on conversations | High | M | D4 run states, D28 optimistic cache, D10 registry | None. It generalises #133's unread marker to every chat. |
| 6 | **Flat Recents + sort menu + "Show more" paging**, keeping date groups as an option (sort by Last updated shows the groups; Manual and Created don't) | Med | S | ticket 071, `date-groups.ts` | None. The user asked for ChatGPT's sidebar, and ChatGPT drops date headings in the desktop app. Recommend **keeping** the groups as the default for the web, since they help scanning; flag this for Connor. |
| 7 | **Row polish**: `content-visibility:auto` rows, scroll-edge fade masks, an action slot that takes no width until hover, an emoji in rename, Mark unread | Med | S | D28 motion and perf, D5 tokens | None. Masks use opacity gradients, which are allowed. |
| 8 | **Keyboard set**: ⇧⌘O new chat, ⇧⌘A archive, ⌥⌘P pin, ⇧⌘U mark unread, ⇧⌘[ / ⇧⌘] previous and next chat, ⌃Tab MRU, ⌘. Dot, ⌘/ help, ⌘Z undo archive/move. Note that ChatGPT uses ⇧⌘S for the sidebar where we use `[`; keep `[` and add ⇧⌘S | Med | S | D10 registry (`packages/shortcuts`) | None. |
| 9 | **Bulk select + archive view in the sidebar + "archive the rest of this group?" suggestion** | Med | M | D28 optimistic | None. |
| 10 | **Collapsed rail** (icons for New chat, Search, Dot, Library, Scheduled) instead of fully hidden, plus pinnable and reorderable nav destinations | Med | M | ticket 071 collapse and peek, D14 header | Minor: it changes 071's collapse model. Keep peek on the rail's edge. |
| 11 | **Reply chains in the Dot thread**: each scheduled run's message can carry threaded replies, so the Dot's single thread stays a timeline | Med | M–L | D25 messages, branching | **Aligns** with "a Dot is a thread": it keeps one thread readable without spawning chats. Needs a contract change (`parentMessageId`/`replyTo`). |
| 12 | **Event and monitor triggers**: webhook (with a pending-events queue held while paused) and "Monitoring" (an NL condition checked every N minutes) | Med–High | L | D4 pg-boss, D18 MCP | It **costs money**: a monitor is a polling LLM call. Gate it behind 4, with a cheap Decider (D15) precheck, and default it off. |
| 13 | **Projects** (folders with instructions, sources and a memory scope) | High | L | D17 spaces, D20 memory, D13 | Out of scope for this study. It overlaps D17 spaces and needs its own grilling. List it, don't plan it. |
| 14 | **Sign-in hand-off card** for the Dot's computer ("Sign in to {site}" → Take over → Continue task) | Med | S | #133 computer take-over | None. It's a message part over the existing take-over. |
| 15 | Channels (SMS, email, Slack), pets/avatars, iMessage effects | Low for now | L | — | Skip. |

**Top five to do first:** 1, 2, 3+4 (one engine PR pair), 5, then 6–8 as one
sidebar polish PR.

## Proposed tickets (PR-sized; ids provisional, after 172)

Contract changes are their own PRs (AGENTS.md § Contract changes), owned and
merged by Connor.

### 173a: Contract, schedules target a conversation; run outcome; notify policy
- **Labels:** `wayfinder:build` (contract-only PR). **Blocked by:** #133.
- **Owns:** `packages/contract/src/{schemas,routes}/dots.ts`, `packages/contract/openapi.json`.
- **Change** (revised after the schedules deep dive):
  - **`Schedule`** (renamed from `DotSchedule`; the `dots.schedules.*` routes stay as aliases for one release) is a discriminated union on `target`:
    - `{ kind: "dot" }`;
    - `{ kind: "conversation", conversationId }`, a heartbeat that inherits the thread's model;
    - `{ kind: "new_chat_each_run", agentRef?, model? }`.
  - Common fields:
    - `status: "active" | "paused" | "completed"`;
    - `recurrence: { kind: "cron", cron, timezone, endsAt? } | { kind: "once", at, timezone }`;
    - `notify: "all" | "failures" | "important" | "none"`;
    - `nextRunAt` (jittered) and `nextRunNominalAt`;
    - `lastRunAt`, `lastOutcome`.
  - **`ScheduleRun`:** `trigger: "scheduled" | "run_now" | "chat"`, `outcome: "update" | "no_update" | "needs_attention" | "failed" | "skipped"`, `skipReason?: "cap" | "budget" | "target_archived"`, `summary?`, `readAt?`, `missedSlots`.
  - **`Conversation`** gains `schedule?: { id, nextRunNominalAt, status }` for the sidebar row and thread header.
  - **Routes:** `schedules.list/get/create/update/delete/pause/resume/runNow/runs` and `schedules.markRunsRead`.
- **Who needs it:** 173, 175, 181. **Breaks:** clients of `dots.schedules.*` (web only, behind the alias), the input shape, and the OpenAPI.
- **Done when:** the zod schemas, the OpenAPI regeneration and contract tests (union round-trips, `once` in the past refused at the schema level) pass.

### 173: Heartbeat schedules (engine)
- **Blocked by:** 173a. **Owns:** `packages/db/src/schema/dots.ts` (additive migration), `packages/db/src/queries/dots.ts`, `packages/server/src/dots/**`, `packages/server/src/api/dots.ts`.
- **Done when:**
  - a schedule can target any conversation the owner can write, and its runs post there;
  - the posted message is attributed "Sent by scheduled task" (message metadata);
  - archiving or deleting the target conversation pauses the schedule, and the archive API reports the count it affected;
  - `new_chat_each_run` creates a chat titled `<task> · <date>`;
  - existing Dot schedules migrate to `target = dot` (table renamed `schedule`, with `owner_id` and a nullable `dot_id`);
  - `once` schedules fire one time and become `completed`, and `endsAt` stops a cron;
  - **jitter:** round-minute hourly, daily and weekly schedules get a deterministic ±300 s offset from `hash(scheduleId, nominal)`, stored as `next_run_at` with `next_run_nominal_at` kept for display;
  - **a busy target defers:** if the target conversation has an active run or a pending approval, the claim leaves the row due and re-checks next tick until the next nominal slot, then records `skipped` with `missedSlots`;
  - missed slots after downtime collapse into one run (the current behaviour, now tested and documented in `docs/dots.md`).
- **Tests:** pure tests (Vitest) for:
  - `resolveScheduleTarget`;
  - `nextFor` with `once`, `endsAt` and jitter (deterministic, within bounds, none for non-round minutes);
  - DST spring-forward and fall-back for `0 9 * * *` in `Europe/London` and `America/New_York`;
  - `deferOrSkip(targetState, now, nextNominal)`.

  PGlite tests for the migration, claim-with-target and defer. A service test for archive coupling.

### 174: One Dot per user
- **Blocked by:** #133. **Owns:** `apps/web/app/(app)/(pages)/dots/**`, `packages/server/src/dots/service.ts`, `packages/db` (a unique index on `dot.owner_id`, additive migration with merge-down of extras to archived).
- **Done when:**
  - creating a second Dot is refused with a typed error;
  - the list and primary picker are gone, and `/dots` redirects to the Dot's thread or to onboarding;
  - the sidebar's top slot shows the Dot with an unread dot and a preview tooltip;
  - ⌘. opens it (registry entry, allowed while typing);
  - the Dot's conversation is excluded from Recents (a `hideDotFromRecents` user preference, default on).
- **Tests:** a service test for the uniqueness error, a browser-mode sidebar test, and a shortcut registry test.

### 175: Run outcomes, notify policy and cost guardrails
- **Blocked by:** 173a. **Owns:** `packages/server/src/dots/{policy,turn,jobs}.ts`, `packages/config/src/schema.ts` (an additive `dots:` block: `minIntervalMinutes` (60), `maxRunsPerUserPerDay` (24), `runStepBudget` (8), `runTokenBudget` (20k), `defaultModel: fast`), `app.config.example.yaml`.
- **Done when:**
  - every unattended run gets a `report` tool, and its outcome is stored;
  - `no_update` renders as a collapsed one-line system part;
  - notifications follow `notify` (in-app now; the push channel is later);
  - schedules below the minimum interval are refused at create and update;
  - a run over its step or token budget ends `failed` with a budget reason;
  - the daily cap skips claims and records `skipped: cap`;
  - **silent runs leave no trace:** `no_update` doesn't set unread, doesn't notify and isn't counted in "While you were away" (like ChatGPT's `DONT_NOTIFY` heartbeat);
  - `failures` notifies only for `failed`, `important` only for `needs_attention`, and `all` for everything except `no_update`;
  - **heartbeats on a non-Dot conversation run read-only by default:** write tools are withheld unless listed on the schedule;
  - if the model never calls `report`, the outcome falls back to `update` when the run succeeded with text, and `no_update` when it was empty.
- **Tests:** pure tests of `shouldNotify(outcome, policy, status)` and the budget checks; a mock-model (`MockLanguageModelV4`) turn test asserting `no_update` ends after one step; a config schema test. **No live model calls.**

### 176: Sidebar "Needs attention" section and unread
- **Owns:** `packages/chat-ui/src/sidebar/**`, `packages/chat-ui/src/model/attention.ts` (new, pure), `packages/db` (additive `conversation_member.last_read_at`), `packages/server` (mark read/unread handlers). **Needs contract PR 176a:** `Conversation.unread`, `markRead`/`markUnread`, and `attention: running | awaiting_approval | unread`.
- **Done when:**
  - the section lists running, awaiting-approval and unread chats, and hides when empty;
  - Mark unread works from the row menu and ⇧⌘U;
  - ⌥⌘A jumps to the next chat that needs attention, and ⇧Esc clears unreads;
  - read state updates optimistically (D28).
- **Tests:** pure `attentionFor(chat, runs, lastReadAt)`, browser-mode section tests, and a PGlite test for the read marker.

### 177: Sidebar list polish (sort, paging, rows, keyboard)
- **Owns:** `packages/chat-ui/src/sidebar/**`, `packages/chat-ui/src/model/date-groups.ts`, `packages/shortcuts/src/ids.ts`.
- **Done when:**
  - a sort menu offers Last updated (with date groups) and Created, persisted per user in localStorage;
  - the list renders 50 rows, then a "Show more" button;
  - rows use `content-visibility:auto` with an intrinsic block size;
  - the scroll area has top and bottom fade masks (an opacity gradient);
  - the row action slot takes no width until hover or focus-within;
  - the shortcuts ⇧⌘O, ⇧⌘A, ⌥⌘P, ⇧⌘[ / ⇧⌘], ⌃Tab (MRU), ⇧⌘S (alias for `[`) and ⌘/ are registered and shown in the `?` dialog;
  - ⌘Z undoes the last archive (a toast with Undo).
- **Tests:** browser-mode tests for sort, paging and the keyboard paths; registry conflict tests; an axe check on the row menu.

### 178: Bulk select, the archive view and the archive suggestion
- **Blocked by:** 177. **Owns:** `packages/chat-ui/src/sidebar/**` (new `archive-view.tsx`, `selection.ts`).
- **Done when:**
  - ⇧/⌘-click selects rows, and archive or delete applies to the selection with a partial-failure toast;
  - the sidebar's "Archived" view searches and unarchives;
  - after 3 archives within one date group, it offers "Archive the remaining N?".
- **Tests:** a pure selection reducer, and browser-mode tests.

### 179: Collapsed rail
- **Blocked by:** 177. **Owns:** `packages/chat-ui/src/sidebar/**`, `apps/web` shell layout.
- **Done when:**
  - collapsing leaves a 48px icon rail (New chat, Search, Dot, Library, Scheduled, account);
  - peek still opens the full sidebar from the rail's edge;
  - the inline pre-paint script restores rail vs open;
  - the rail has no animation on keyboard toggle (motion rule).
- **Tests:** browser-mode tests for collapse, peek and restore, plus an e2e check for no layout shift on reload.

### 181: Schedules UI: a proposed-schedule card, a schedules page, run history
- **Blocked by:** 173a, 173. **Owns:** `apps/web/app/(app)/(pages)/schedules/**` (new; `/dots` keeps its Scheduled tab as a filtered view), `packages/chat-ui/src/parts/schedule-card.tsx` (new), `packages/server/src/dots/schedule-tool.ts`.
- **Done when:**
  - `schedule_task` / `manage_scheduled_tasks` render as a **Proposed schedule** card (name, prompt, a plain-English recurrence, timezone, target, notify) with Apply / Edit / Dismiss. Apply creates or updates the schedule, and in an unattended run the card is refused as today;
  - one card component covers create, update and delete ("Proposed update", "Deleted");
  - a `/schedules` page lists every schedule the user owns with search, filters (Active / Paused / Completed, target) and empty-state templates (Daily brief, Follow-up monitor, Weekly review);
  - each row has Run now, Pause/Resume and Delete (with confirmation), and reads "Last ran … · Next …";
  - a detail sheet shows the run history (status and outcome, opens the run's message), with "Show older" paging;
  - the recurrence editor offers Once / Daily / Weekdays / Weekly / Monthly / Custom cron, a searchable IANA time zone and End repeat;
  - "Create with chat" opens the Dot's thread with a seeded interview prompt;
  - the sidebar row and thread header show "Next run …" for conversations with a schedule.
- **Tests:** pure tests for `describeRecurrence` and `recurrenceToCron` (round-trip with the presets); browser-mode tests for the card's Apply path, the page filters and the editor validation (past dates, intervals below the minimum); e2e covering create from the card, then pause, run now (mock model) and delete.

### 180 (later): Reply chains in the Dot thread
- Needs a contract PR (`Message.replyTo`) and grilling with Connor on how it
  interacts with branching (D25). Not planned in detail here.

### Not planned here
- Event, webhook and monitor triggers (idea 12): they wait until 175's
  guardrails exist and have been running.
- Projects (idea 13): they need a D17 grilling ticket.

## Open questions for Connor
1. Keep the date groups as the default (recommended for the web) or go flat
   like ChatGPT?
2. Should a heartbeat be allowed to target *any* chat, or only the Dot's
   thread, for now?
3. Are the default budgets right (60-minute minimum interval, 24 runs a day,
   20k tokens a run)?
