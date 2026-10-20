------------------------------ MODULE RunQueue ------------------------------
(***************************************************************************)
(* The branch run queue and Stop (PLAN.md D4, D25), as the in-process     *)
(* executor implements them. How to read, run and update this model:      *)
(* .claude/skills/verify-run-queue/SKILL.md                                *)
(*                                                                         *)
(* One conversation, NRuns turns sent by concurrent POST /api/runs        *)
(* requests, NStops Stop requests and NDecides approval decisions, all    *)
(* against one in-process executor and one Postgres (READ COMMITTED).     *)
(*                                                                         *)
(* A step (label) is one await boundary in the code: a database           *)
(* statement or transaction takes effect, and the synchronous JavaScript  *)
(* that handles its result runs, up to the next await. Each label's       *)
(* comment names the code it stands for.                                  *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, Sequences, TLC

\* AnyAnchor: TRUE lets a turn follow any run's last message or none of
\* them (a new branch); FALSE makes every turn a reply at the end of the
\* branch, after the newest run's last message. StopTargets: the statuses a
\* run may be in when Stop reads it (every unfinished status, or fewer to
\* look at one race on its own).
CONSTANTS NRuns, NStops, NDecides, MaxPauses, AnyAnchor, StopTargets

Runs == 1..NRuns
NoRun == 0
\* An AbortController, numbered per run: <<run, n>>. Numbering per run keeps
\* interleavings that differ only in who allocated first from counting twice.
NoCtl == <<0, 0>>

Terminal == {"succeeded", "failed", "cancelled"}
ActiveSt == {"queued", "running", "awaiting_approval"}   \* ACTIVE_RUN_STATUSES

\* `FROM` and `TARGET` in packages/db/src/queries/runs.ts: transitionRun is a
\* compare-and-set that moves a run only out of these statuses.
From == [start |-> {"queued"},
         await_approval |-> {"running"},
         resume |-> {"awaiting_approval"},
         succeed |-> {"running"},
         fail |-> {"queued", "running", "awaiting_approval"},
         cancel |-> {"queued", "running", "awaiting_approval"}]
Target == [start |-> "running",
           await_approval |-> "awaiting_approval",
           resume |-> "running",
           succeed |-> "succeeded",
           fail |-> "failed",
           cancel |-> "cancelled"]

SendIds == {<<"send", r>> : r \in Runs}
PassIds == {<<"pass", r>> : r \in Runs}
StopIds == {<<"stop", k>> : k \in 1..NStops}
DecideIds == {<<"decide", d>> : d \in 1..NDecides}
R(id) == id[2]

\* Message-tree nodes, for the ghost only.
Root == <<"root", NoRun>>
U(x) == <<"u", x>>   \* run x's user message
A(x) == <<"a", x>>   \* run x's answer (inserted by claim)

\* listActiveRuns orders by createdAt; `find` takes the first match.
Oldest(S, created) == CHOOSE x \in S : \A y \in S : created[x] <= created[y]

\* The messages a client may send after (its parentId): a run's last
\* message, its answer once claimed, else its user message.
LastOf(x, has) == IF has[x] THEN A(x) ELSE U(x)
AnchorsOf(st, has, created) ==
  LET made == {x \in Runs : st[x] # "none"}
  IN IF AnyAnchor THEN {Root} \cup {LastOf(x, has) : x \in made}
     ELSE IF made = {} THEN {Root}
     ELSE {LastOf(CHOOSE x \in made :
                     \A y \in made : created[y] <= created[x], has)}

\* busyTail(active, anchor) in packages/server/src/runs/create-run.ts: the
\* active run whose user message or answer is the anchor, then forward along
\* afterRunId to the last run queued behind it.
RECURSIVE Walk(_, _, _, _, _)
Walk(t, seen, st, aft, created) ==
  LET next == {x \in Runs : st[x] \in ActiveSt /\ aft[x] = t}
      nx == Oldest(next, created)
  IN IF next = {} THEN t
     ELSE IF nx \in seen \cup {t} THEN nx
     ELSE Walk(nx, seen \cup {t}, st, aft, created)

BusyTailOf(anchorRun, st, aft, created) ==
  IF anchorRun = NoRun \/ st[anchorRun] \notin ActiveSt THEN NoRun
  ELSE Walk(anchorRun, {}, st, aft, created)

\* listQueuedAfter(db, runId), oldest first.
RECURSIVE ByCreated(_, _)
ByCreated(S, created) ==
  IF S = {} THEN <<>>
  ELSE LET m == Oldest(S, created) IN <<m>> \o ByCreated(S \ {m}, created)

\* Ghost: the runs whose answers lie above a message in the message tree.
AnswersAbove(node, above) ==
  CASE node[1] = "root" -> {}
    [] node[1] = "a" -> {node[2]} \cup above[node[2]]
    [] node[1] = "u" -> above[node[2]]

(* --algorithm RunQueue

variables
  \* The run rows (packages/db/src/schema/chat.ts, `run`).
  status = [r \in Runs |-> "none"],        \* "none": not inserted yet
  after = [r \in Runs |-> NoRun],          \* run.afterRunId
  createdAt = [r \in Runs |-> 0],          \* run.createdAt
  clock = 1,
  hasAnswer = [r \in Runs |-> FALSE],      \* run.assistantMessageId is set
  locked = [r \in Runs |-> FALSE],         \* row lock held by recordDecisions
  \* The executor's memory (createInProcessExecutor in executor.ts).
  active = [r \in Runs |-> NoCtl],         \* `active`: run -> AbortController
  running = [r \in Runs |-> NoCtl],        \* `running`: run -> tracked pass
  nextCtl = [r \in Runs |-> 1],
  aborted = {},                            \* controllers abort() was called on
  spawned = [r \in Runs |-> {}],           \* passes started, loop not finished
  ended = {},                              \* passes whose tracked promise settled
  pauses = 0,                              \* approval pauses so far (bounded)
  \* Ghosts, for the properties only.
  ansAbove = [r \in Runs |-> {}],          \* answers above this turn's message
  settled = [r \in Runs |-> 0];            \* onSettled calls per run

\* execute()'s `finally` (active.delete) and track()'s (running.delete if it
\* is still this pass), and the pass's promise settling.
macro passFinally(run, c) begin
  active[run] := NoCtl;
  running[run] := IF running[run] = c THEN NoCtl ELSE running[run];
  ended := ended \cup {c};
end macro;

\* startRun(run) in executor.ts.
procedure startRun(sr)
variables srAfter = NoRun, srCtl = NoCtl;
begin
S_Read:
  \* `getRun(db, run.runId)`, then
  \* `row.status !== "queued" || active.has(run.runId)` -> already_started
  if status[sr] # "queued" \/ active[sr] # NoCtl then
    return;
  elsif after[sr] # NoRun then
    srAfter := after[sr];
    goto S_Ahead;
  else
    \* `active.set(run.runId, controller)`, then claim(run)
    srCtl := <<sr, nextCtl[sr]>>;
    active[sr] := <<sr, nextCtl[sr]>>;
    nextCtl[sr] := nextCtl[sr] + 1;
    goto S_Claim;
  end if;
S_Ahead:
  \* `getRun(db, row.afterRunId)`: still waiting its turn -> ok, the run
  \* ahead starts it when it ends. Else `active.set`, then claim(run).
  if status[srAfter] \notin Terminal then
    return;
  else
    srCtl := <<sr, nextCtl[sr]>>;
    active[sr] := <<sr, nextCtl[sr]>>;
    nextCtl[sr] := nextCtl[sr] + 1;
  end if;
S_Claim:
  \* claim(run): one transaction inserts the empty answer and runs
  \* transitionRun(start). Lost -> `active.delete(run.runId)`.
  \* Won -> `track(run.runId, execute(..., controller))`.
  await ~locked[sr];
  if status[sr] \in From.start then
    status[sr] := Target.start;
    hasAnswer[sr] := TRUE;
    spawned[sr] := spawned[sr] \cup {srCtl};
    running[sr] := srCtl;
  else
    active[sr] := NoCtl;
  end if;
  return;
end procedure;

\* finishTerminal(row, ...) in executor.ts, then promoteAfter(row.id). When a
\* pass calls it (fctl is the pass's controller), execute()'s finally runs as
\* it returns.
procedure finishTerminal(fr, fctl)
variables queue = <<>>, cur = NoRun;
begin
F_List:
  \* `writer.close(row.id, row.status)`, settledHook -> onSettled, then
  \* promoteAfter: `listQueuedAfter(db, runId)`
  settled[fr] := settled[fr] + 1;
  queue := ByCreated({x \in Runs : after[x] = fr /\ status[x] = "queued"},
                     createdAt);
F_Loop:
  \* promoteAfter: `startRun(runStartFromRow(next))` for each, in order
  if queue = <<>> then
    if fctl # NoCtl then
      passFinally(fr, fctl);
    end if;
    return;
  else
    cur := Head(queue);
    queue := Tail(queue);
    call startRun(cur);
    goto F_Loop;
  end if;
end procedure;

\* POST /api/runs: createRun in packages/server/src/runs/create-run.ts.
\* (moveOnFromWaiting calls executor.cancel: a Stop process stands for it.)
process Send \in SendIds
variables tail = NoRun, parent = Root;
begin
W_Read:
  \* placeRun: `listActiveRuns(tx, conversationId)`, then
  \* `busyTail(active, anchor)`. The anchor is the client's parentId.
  with a \in AnchorsOf(status, hasAnswer, createdAt),
       t = BusyTailOf(a[2], status, after, createdAt) do
    tail := t;
    \* `tail ? (tail.assistantMessageId ?? tail.userMessageId) : turn.parentId`
    parent := IF t = NoRun THEN a ELSE IF hasAnswer[t] THEN A(t) ELSE U(t);
  end with;
W_Insert:
  \* placeRun: insertMessage + insertRun(queued, afterRunId: tail?.id),
  \* committed together; then `deps.executor.start(runStartFromRow(run))`.
  status[R(self)] := "queued";
  after[R(self)] := tail;
  createdAt[R(self)] := clock;
  clock := clock + 1;
  ansAbove[R(self)] := AnswersAbove(parent, ansAbove);
  call startRun(R(self));
  goto Done;
end process;

\* One pass of a run: execute() then settle() in executor.ts. A pass starts
\* when track() is called (`spawned`) and is in its agent loop until P_Loop.
process Pass \in PassIds
variables ctl = NoCtl, outcome = "none";
begin
P_Loop:
  \* execute(): loadBranch, resolveTurn, runAgent (model and tool calls),
  \* pipeToStream, outcomeOf. An aborted signal may end it cancelled.
  \* (A failed pass lands like a succeeded one here, so it is left out.)
  await spawned[R(self)] # {};
  with c \in spawned[R(self)] do
    ctl := c;
    spawned[R(self)] := spawned[R(self)] \ {c};
    either
      outcome := "succeed";
    or
      await pauses < MaxPauses;
      pauses := pauses + 1;
      outcome := "await_approval";
    or
      await c \in aborted;
      outcome := "cancel";
    end either;
  end with;
P_Settle:
  \* settle(): `transition(run.runId, landing(...))`. Awaiting approval:
  \* return, and execute's finally runs in the same tick. Terminal:
  \* finishTerminal. Lost the compare-and-set: settleLostRace.
  await ~locked[R(self)];
  if status[R(self)] \in From[outcome] then
    status[R(self)] := Target[outcome];
    if outcome = "await_approval" then
      passFinally(R(self), ctl);
      goto P_Loop;
    else
      call finishTerminal(R(self), ctl);
      goto P_Loop;
    end if;
  else
    goto P_Lost;
  end if;
P_Lost:
  \* settleLostRace: `getRun(db, runId)`, then finishTerminal(current),
  \* which returns at once unless the run is terminal.
  if status[R(self)] \in Terminal then
    call finishTerminal(R(self), ctl);
    goto P_Loop;
  else
    passFinally(R(self), ctl);
    goto P_Loop;
  end if;
end process;

\* Stop: executor.cancel(runId, by) in executor.ts (POST /api/runs/:id/cancel,
\* and createRun's moveOnFromWaiting).
process Stop \in StopIds
variables tgt = NoRun, rowSt = "none", rowAfter = NoRun, waitFor = NoCtl;
begin
K_Read:
  \* `getRun(db, runId)`. Then abortPass(): `active.get(runId)` ->
  \* `controller.abort()`, `await running.get(runId)`. No controller ->
  \* cancelIdle(row, by). (A Stop on a run that has ended or doesn't exist
  \* changes nothing, so the model lets it not come at all.)
  either
    with r \in {x \in Runs : status[x] \in ActiveSt \cap StopTargets} do
      tgt := r;
      rowSt := status[r];
      rowAfter := after[r];
    end with;
    if active[tgt] # NoCtl then
      aborted := aborted \cup {active[tgt]};
      waitFor := running[tgt];
      goto K_After;
    else
      goto K_Idle;
    end if;
  or
    goto Done;
  end either;
K_After:
  \* abortPass returned true: `after = getRun(db, runId)`; still awaiting
  \* approval with nothing in `active` -> cancelIdle(after.value, by).
  await waitFor = NoCtl \/ waitFor \in ended;
  if status[tgt] = "awaiting_approval" /\ active[tgt] = NoCtl then
    rowSt := status[tgt];
    rowAfter := after[tgt];
    goto K_Idle;
  else
    goto Done;
  end if;
K_Idle:
  \* cancelIdle(row, by): one transaction runs transitionRun(cancel) and
  \* stores the interrupted parts. `!moved.ok` -> returns false.
  await ~locked[tgt];
  if status[tgt] \in From.cancel then
    status[tgt] := Target.cancel;
    if rowSt = "queued" /\ rowAfter # NoRun then
      goto K_Ahead;
    else
      call finishTerminal(tgt, NoCtl);
      goto Done;
    end if;
  else
    goto K_Abort2;
  end if;
K_Ahead:
  \* cancelIdle: `getRun(db, row.afterRunId)`; not terminal -> requeueAfter
  if status[rowAfter] \notin Terminal then
    goto K_Requeue;
  else
    call finishTerminal(tgt, NoCtl);
    goto Done;
  end if;
K_Requeue:
  \* cancelIdle: `requeueAfter(db, row.id, ahead.value.id)`, then
  \* finishTerminal(cancelled)
  after := [x \in Runs |->
              IF after[x] = tgt /\ status[x] = "queued" THEN rowAfter
              ELSE after[x]];
  call finishTerminal(tgt, NoCtl);
  goto Done;
K_Abort2:
  \* cancelIdle returned false: `abortPass()` again ("a decision resumed it
  \* between the two looks")
  if active[tgt] # NoCtl then
    aborted := aborted \cup {active[tgt]};
    waitFor := running[tgt];
  else
    goto Done;
  end if;
K_Wait2:
  await waitFor = NoCtl \/ waitFor \in ended;
end process;

\* An approval decision: submitApprovals(runId, decisions, by) in executor.ts.
\* One decision answers every pending call of the pause.
process Decide \in DecideIds
variables dtgt = NoRun, resumed = FALSE;
begin
D_Lock:
  \* recordDecisions: `lockRun(tx, runId)` (SELECT ... FOR UPDATE) on a run
  \* awaiting approval. (A decision on any other run is refused and changes
  \* nothing, so the model lets it not come at all.)
  either
    with r \in {x \in Runs : status[x] = "awaiting_approval" /\ ~locked[x]} do
      dtgt := r;
      locked[r] := TRUE;
    end with;
  or
    goto Done;
  end either;
D_Store:
  \* storeDecisions: updateMessage, every call decided ->
  \* `active.set(row.id, new AbortController())`, then transitionRun(resume)
  active[dtgt] := <<dtgt, nextCtl[dtgt]>>;
  nextCtl[dtgt] := nextCtl[dtgt] + 1;
D_Resume:
  \* transitionRun(resume) (`!resumed.ok` -> active.delete); COMMIT
  \* releases the row lock
  if status[dtgt] \in From.resume then
    status[dtgt] := Target.resume;
    resumed := TRUE;
  else
    active[dtgt] := NoCtl;
  end if;
  locked[dtgt] := FALSE;
D_Spawn:
  \* submitApprovals, after announce: `controller = active.get(runId)`;
  \* resumed and a controller -> track(runId, execute(..., controller))
  if resumed /\ active[dtgt] # NoCtl then
    spawned[dtgt] := spawned[dtgt] \cup {active[dtgt]};
    running[dtgt] := active[dtgt];
  end if;
end process;

end algorithm; *)
\* BEGIN TRANSLATION
\* END TRANSLATION

-----------------------------------------------------------------------------
(* Properties. Each is one sentence in SKILL.md, with the harm it guards.  *)

\* A pass is in its agent loop (calling the model, running tools) from
\* track() until its loop finishes.
InLoop(r) == spawned[r] # {}

\* Once a run has ended (or paused), nothing is still running the model or
\* its tools for it.
EndedRunsAreIdle == \A r \in Runs : InLoop(r) => status[r] = "running"

\* While a pass is in its agent loop, `active` holds that pass's controller,
\* so Stop (abortPass) can abort it.
StopReachesPass == \A r \in Runs : \A c \in spawned[r] : active[r] = c

\* No turn runs while an answer above it on its branch is still being written.
OneRunPerBranch ==
  \A x, y \in Runs : (x # y /\ InLoop(x) /\ InLoop(y)) => x \notin ansAbove[y]

\* Once every request has returned and no pass is executing, no run is stuck:
\* each has ended, is paused for approval, or is queued behind a run that
\* has not ended. (A request that can never return shows up as a TLC
\* deadlock: CheckedSpec lets only these settled states stutter.)
Requests == SendIds \cup StopIds \cup DecideIds
Quiet ==
  /\ \A p \in Requests : pc[p] = "Done"
  /\ \A r \in Runs : spawned[r] = {} /\ pc[<<"pass", r>>] = "P_Loop"
NoStuckRun ==
  Quiet =>
    \A r \in Runs :
      \/ status[r] \in Terminal \cup {"awaiting_approval"}
      \/ /\ status[r] = "queued"
         /\ after[r] # NoRun
         /\ status[after[r]] \notin Terminal

CheckedSpec == Init /\ [][Next \/ (Quiet /\ UNCHANGED vars)]_vars

-----------------------------------------------------------------------------
(* Views. TLC treats two states with the same view as one. These views     *)
(* leave out only data that no later step reads: a finished request's or   *)
(* an idle pass's locals, controllers that can no longer be aborted or     *)
(* waited on, and the controller counter (ids are only compared, and a     *)
(* fresh id is fresh either way). Ghosts are left out unless the property  *)
(* being checked reads them.                                                *)

LiveCtls == UNION {spawned[r] : r \in Runs}
              \cup {active[r] : r \in Runs}
              \cup {srCtl[p] : p \in ProcSet}
Locals ==
  << [p \in SendIds |-> IF pc[p] = "Done" THEN <<>> ELSE tail[p]],
     [p \in PassIds |->
        IF pc[p] = "P_Loop" THEN <<>> ELSE <<ctl[p], outcome[p]>>],
     [p \in StopIds |->
        IF pc[p] = "Done" THEN <<>>
        ELSE <<tgt[p], rowSt[p], rowAfter[p], waitFor[p]>>],
     [p \in DecideIds |->
        IF pc[p] = "Done" THEN <<>> ELSE <<dtgt[p], resumed[p]>>] >>
View ==
  << status, after, createdAt, hasAnswer, locked, active, running,
     aborted \cap LiveCtls, ended \cap {waitFor[p] : p \in StopIds},
     spawned, pauses, pc, stack, sr, srAfter, srCtl, fr, fctl, queue, cur,
     Locals >>
\* OneRunPerBranch reads the message-tree ghost.
ViewBranch ==
  << View, ansAbove,
     [p \in SendIds |-> IF pc[p] = "Done" THEN <<>> ELSE parent[p]] >>
\* SettledOnce reads the end-hook ghost.
ViewSettled == << View, settled >>
\* Every property at once.
ViewAll == << ViewBranch, settled >>

\* Each run's end hook (usage, title and prune jobs) fires at most once.
SettledOnce == \A r \in Runs : settled[r] <= 1

\* At most one pass of a run executes at a time.
OnePassPerRun ==
  \A r \in Runs :
    Cardinality(spawned[r]) + (IF pc[<<"pass", r>>] = "P_Loop" THEN 0 ELSE 1)
      <= 1

=============================================================================
