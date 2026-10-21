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
\* look at one race on its own). MaxCrashes: how many passes may throw and
\* fail to fail their run (failEarly throwing too), leaving it running.
CONSTANTS NRuns, NStops, NDecides, MaxPauses, MaxCrashes, AnyAnchor,
          StopTargets

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
         cancel |-> {"queued", "awaiting_approval"},
         abort |-> {"running"}]
Target == [start |-> "running",
           await_approval |-> "awaiting_approval",
           resume |-> "running",
           succeed |-> "succeeded",
           fail |-> "failed",
           cancel |-> "cancelled",
           abort |-> "cancelled"]

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
  crashes = 0,                             \* passes that crashed (bounded)
  \* Ghosts, for the properties only.
  ansAbove = [r \in Runs |-> {}],          \* answers above this turn's message
  settled = [r \in Runs |-> 0],            \* onSettled calls per run
  begun = {},                              \* controllers whose agent loop began
  stoppedEarly = {};                       \* aborted before their loop began

\* execute()'s `finally` (release: active.delete if it is still this pass's
\* controller) and track()'s (running.delete if it is still this pass), and
\* the pass's promise settling.
macro passFinally(run, c) begin
  active[run] := IF active[run] = c THEN NoCtl ELSE active[run];
  running[run] := IF running[run] = c THEN NoCtl ELSE running[run];
  ended := ended \cup {c};
end macro;

\* startRun(run) in executor.ts.
procedure startRun(sr)
variables srAfter = NoRun, srMoved = <<>>, srNext = NoRun;
begin
S_Read:
  \* `getRun(db, run.runId)`, then `row.status !== "queued"` -> already_started
  if status[sr] # "queued" then
    return;
  elsif after[sr] # NoRun then
    srAfter := after[sr];
    goto S_Ahead;
  else
    goto S_Claim;
  end if;
S_Ahead:
  \* `getRun(db, row.afterRunId)`: still waiting its turn -> ok, the run
  \* ahead starts it when it ends. Ended before it ran (no answer) -> its
  \* place passes on. Else claim(run, new controller).
  if status[srAfter] \notin Terminal then
    return;
  elsif ~hasAnswer[srAfter] then
    goto S_Requeue;
  else
    goto S_Claim;
  end if;
S_Requeue:
  \* `requeueAfter(db, ahead.id, ahead.afterRunId)`: the runs queued
  \* behind it now wait on the run it waited on.
  srMoved := ByCreated({x \in Runs : after[x] = srAfter /\ status[x] = "queued"},
                       createdAt);
  after := [x \in Runs |->
              IF after[x] = srAfter /\ status[x] = "queued" THEN after[srAfter]
              ELSE after[x]];
S_Each:
  \* startEach(moved): `startRun` for each in order, then return. Taking
  \* the next run touches only this call's locals; it is its own step
  \* because the call below re-initialises them.
  if srMoved = <<>> then
    return;
  else
    srNext := Head(srMoved);
    srMoved := Tail(srMoved);
  end if;
S_Next:
  call startRun(srNext);
  goto S_Each;
S_Claim:
  \* claim(run, controller): one transaction inserts the empty answer and
  \* runs transitionRun(start); won -> `active.set(run.runId, controller)`
  \* before COMMIT, then `track(run.runId, execute(..., controller))`. Lost
  \* -> rolled back, `active` untouched.
  await ~locked[sr];
  if status[sr] \in From.start then
    status[sr] := Target.start;
    hasAnswer[sr] := TRUE;
    active[sr] := <<sr, nextCtl[sr]>>;
    spawned[sr] := spawned[sr] \cup {<<sr, nextCtl[sr]>>};
    running[sr] := <<sr, nextCtl[sr]>>;
    nextCtl[sr] := nextCtl[sr] + 1;
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
  if tail = NoRun /\ parent # Root then
    goto W_Held;
  else
    goto W_Insert;
  end if;
W_Held:
  \* placeRun: nothing active there, so `stoppedRunAt(tx, conversationId,
  \* anchor)`: the run whose question the anchor is, if it ended before it
  \* ran. The turn waits on it, under that question.
  if parent[1] = "u" /\ status[parent[2]] \in Terminal
     /\ ~hasAnswer[parent[2]] then
    tail := parent[2];
  end if;
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
\* when track() is called (`spawned`), begins its agent loop at P_Begin, and
\* leaves it at P_Loop.
process Pass \in PassIds
variables ctl = NoCtl, outcome = "none";
begin
P_Begin:
  \* execute(): loadBranch, resolveTurn, setRunResolvedModel,
  \* attachmentsForModel; then `controller.signal.aborted` -> settle as
  \* cancelled without calling runAgent. Else runAgent: the agent loop
  \* begins (model calls, and the calls a decision approved). One step:
  \* until the SDK executes approved calls it awaits only local work, so
  \* no other request runs between the check and them (SKILL.md, Bounds).
  await spawned[R(self)] # {};
  with c \in spawned[R(self)] do
    ctl := c;
  end with;
  if ctl \in aborted then
    spawned[R(self)] := spawned[R(self)] \ {ctl};
    outcome := "abort";
    goto P_Settle;
  else
    begun := begun \cup {ctl};
  end if;
P_Loop:
  \* runAgent's loop, pipeToStream, outcomeOf. An aborted signal may end it
  \* cancelled. (A failed pass lands like a succeeded one here, so it is
  \* left out.)
  spawned[R(self)] := spawned[R(self)] \ {ctl};
  either
    outcome := "succeed";
  or
    await pauses < MaxPauses;
    pauses := pauses + 1;
    outcome := "await_approval";
  or
    await ctl \in aborted;
    outcome := "abort";
  or
    \* The pass throws, and execute's catch can't fail the run either
    \* (failEarly throws): the finally runs with the run still running.
    await crashes < MaxCrashes;
    crashes := crashes + 1;
    passFinally(R(self), ctl);
    goto P_Begin;
  end either;
P_Settle:
  \* settle(): `transition(run.runId, landing(...))`. Awaiting approval:
  \* return, and execute's finally runs in the same tick. Terminal:
  \* finishTerminal. Lost the compare-and-set: `report`, then the finally.
  await ~locked[R(self)];
  if status[R(self)] \in From[outcome] then
    status[R(self)] := Target[outcome];
    if outcome = "await_approval" then
      passFinally(R(self), ctl);
      goto P_Begin;
    else
      call finishTerminal(R(self), ctl);
      goto P_Begin;
    end if;
  else
    passFinally(R(self), ctl);
    goto P_Begin;
  end if;
end process;

\* Stop: executor.cancel(runId, by) in executor.ts (POST /api/runs/:id/cancel,
\* and createRun's moveOnFromWaiting).
process Stop \in StopIds
variables tgt = NoRun, rowSt = "none", waitFor = NoCtl, behind = <<>>,
          nextRun = NoRun;
begin
K_Read:
  \* `getRun(db, runId)`, then the first look. (A Stop on a run that has
  \* ended or doesn't exist changes nothing, so the model lets it not come
  \* at all.)
  either
    with r \in {x \in Runs : status[x] \in ActiveSt \cap StopTargets} do
      tgt := r;
      rowSt := status[r];
    end with;
    if active[tgt] # NoCtl then
      \* abortPass(): `active.get(runId)` -> `controller.abort()`, then
      \* `await running.get(runId)`.
      aborted := aborted \cup {active[tgt]};
      stoppedEarly := stoppedEarly \cup ({active[tgt]} \ begun);
      waitFor := running[tgt];
      goto K_Wait;
    else
      goto K_Idle;
    end if;
  or
    goto Done;
  end either;
K_Wait:
  \* abortPass returned true; then `active.get(runId)?.signal.aborted`: a
  \* pass Stop aborted before it started holds the run -> return.
  await waitFor = NoCtl \/ waitFor \in ended;
  if active[tgt] \in aborted then
    goto Done;
  else
    goto K_Again;
  end if;
K_Idle:
  \* cancelIdle(row, by): one transaction locks the run (lockRun), runs
  \* transitionRun(abort) if it is running with nothing in `active` (its
  \* pass crashed), else transitionRun(cancel), and stores the interrupted
  \* parts. `!moved.ok` -> returns false; then the `signal.aborted` check.
  await ~locked[tgt];
  if status[tgt] = "running" /\ active[tgt] = NoCtl then
    status[tgt] := Target.abort;
    call finishTerminal(tgt, NoCtl);
    goto Done;
  elsif status[tgt] \in From.cancel then
    status[tgt] := Target.cancel;
    if rowSt = "queued" /\ after[tgt] # NoRun then
      goto K_Requeue;
    else
      call finishTerminal(tgt, NoCtl);
      goto Done;
    end if;
  elsif active[tgt] \in aborted then
    goto Done;
  else
    goto K_Again;
  end if;
K_Requeue:
  \* cancelIdle: `requeueAfter(db, cancelled.id, cancelled.afterRunId)`:
  \* the runs queued behind it now wait on the run ahead.
  \* Then finishTerminal(cancelled).
  behind := ByCreated({x \in Runs : after[x] = tgt /\ status[x] = "queued"},
                     createdAt);
  after := [x \in Runs |->
              IF after[x] = tgt /\ status[x] = "queued" THEN after[tgt]
              ELSE after[x]];
  call finishTerminal(tgt, NoCtl);
  goto K_Promote;
K_Promote:
  \* cancelIdle: startEach(moved): `startRun` for each in order, which
  \* claims one whose run ahead has ended.
  if behind = <<>> then
    goto Done;
  else
    nextRun := Head(behind);
    behind := Tail(behind);
    call startRun(nextRun);
    goto K_Promote;
  end if;
K_Again:
  \* The look lost: `getRun(db, runId)` again; ended -> return. Else the
  \* next look, as in K_Read.
  if status[tgt] \in Terminal then
    goto Done;
  else
    rowSt := status[tgt];
    if active[tgt] # NoCtl then
      aborted := aborted \cup {active[tgt]};
      stoppedEarly := stoppedEarly \cup ({active[tgt]} \ begun);
      waitFor := running[tgt];
      goto K_Wait;
    else
      goto K_Idle;
    end if;
  end if;
end process;

\* An approval decision: submitApprovals(runId, decisions, by) in executor.ts.
\* One decision answers every pending call of the pause.
process Decide \in DecideIds
variables dtgt = NoRun, dctl = NoCtl, resumed = FALSE;
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
D_Resume:
  \* storeDecisions: updateMessage, every call decided -> transitionRun
  \* (resume); resumed -> `active.set(row.id, controller)`, the request's
  \* own. COMMIT releases the row lock.
  if status[dtgt] \in From.resume then
    status[dtgt] := Target.resume;
    dctl := <<dtgt, nextCtl[dtgt]>>;
    active[dtgt] := <<dtgt, nextCtl[dtgt]>>;
    nextCtl[dtgt] := nextCtl[dtgt] + 1;
    resumed := TRUE;
  end if;
  locked[dtgt] := FALSE;
D_Spawn:
  \* submitApprovals, after announce: resumed ->
  \* track(runId, execute(..., controller))
  if resumed then
    spawned[dtgt] := spawned[dtgt] \cup {dctl};
    running[dtgt] := dctl;
  end if;
end process;

end algorithm; *)
\* BEGIN TRANSLATION
\* END TRANSLATION

-----------------------------------------------------------------------------
(* Properties. Each is one sentence in SKILL.md, with the harm it guards.  *)

\* A pass is executing (calling the model, running tools) from track()
\* until its agent loop finishes.
InLoop(r) == spawned[r] # {}

\* Once a run has ended (or paused), nothing is still running the model or
\* its tools for it.
EndedRunsAreIdle == \A r \in Runs : InLoop(r) => status[r] = "running"

\* While a pass is in its agent loop, `active` holds that pass's controller,
\* so Stop (abortPass) can abort it.
StopReachesPass == \A r \in Runs : \A c \in spawned[r] : active[r] = c

\* A pass Stop aborted before its agent loop began never begins it: no model
\* call, and no call a decision approved runs.
NoLoopAfterStop == begun \cap stoppedEarly = {}

\* Once a Stop has returned, its run has ended, or the controller in
\* `active` for it is one Stop aborted.
StopTakesEffect ==
  \A k \in StopIds :
    (pc[k] = "Done" /\ tgt[k] # NoRun) =>
      \/ status[tgt[k]] \in Terminal
      \/ active[tgt[k]] \in aborted

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
  /\ \A r \in Runs : spawned[r] = {} /\ pc[<<"pass", r>>] = "P_Begin"
NoStuckRun ==
  Quiet =>
    \A r \in Runs :
      \/ status[r] \in Terminal \cup {"awaiting_approval"}
      \/ /\ status[r] = "queued"
         /\ after[r] # NoRun
         /\ status[after[r]] \notin Terminal

\* Weak fairness per process: a request or pass that can take its next step
\* eventually takes it. Only StopReturns reads it; TLC ignores fairness when
\* it checks invariants.
Fairness ==
  \A self \in ProcSet :
    WF_vars(startRun(self) \/ finishTerminal(self) \/ Send(self)
              \/ Pass(self) \/ Stop(self) \/ Decide(self))

CheckedSpec ==
  Init /\ [][Next \/ (Quiet /\ UNCHANGED vars)]_vars /\ Fairness

\* Every Stop returns. The invariants can't see a Stop that looks again
\* forever, because it never reaches Done for StopTakesEffect to judge.
StopReturns == \A k \in StopIds : <>(pc[k] = "Done")

-----------------------------------------------------------------------------
(* Views. TLC treats two states with the same view as one. These views     *)
(* leave out only data that no later step reads: a finished request's or   *)
(* an idle pass's locals, controllers that can no longer be aborted or     *)
(* waited on, and the controller counter (ids are only compared, and a     *)
(* fresh id is fresh either way). Ghosts are left out unless the property  *)
(* being checked reads them.                                                *)

LiveCtls == UNION {spawned[r] : r \in Runs}
              \cup {active[r] : r \in Runs}
              \cup {dctl[p] : p \in {q \in DecideIds : pc[q] # "Done"}}
Locals ==
  << [p \in SendIds |->
        CASE pc[p] = "Done" -> <<>>
          [] pc[p] = "W_Held" -> <<tail[p], parent[p]>>
          [] OTHER -> tail[p]],
     [p \in PassIds |->
        IF pc[p] = "P_Begin" THEN <<>> ELSE <<ctl[p], outcome[p]>>],
     [p \in StopIds |->
        IF pc[p] = "Done" THEN <<>>
        ELSE <<tgt[p], rowSt[p], waitFor[p], behind[p], nextRun[p]>>],
     [p \in DecideIds |->
        IF pc[p] = "Done" THEN <<>> ELSE <<dtgt[p], dctl[p], resumed[p]>>] >>
View ==
  << status, after, createdAt, hasAnswer, locked, active, running,
     aborted \cap LiveCtls, ended \cap {waitFor[p] : p \in StopIds},
     spawned, pauses, crashes, pc, stack, sr, srAfter, srMoved, srNext, fr, fctl,
     queue, cur,
     begun \cap LiveCtls, stoppedEarly \cap LiveCtls, Locals >>
\* OneRunPerBranch reads the message-tree ghost.
ViewBranch ==
  << View, ansAbove,
     [p \in SendIds |-> IF pc[p] = "Done" THEN <<>> ELSE parent[p]] >>
\* SettledOnce reads the end-hook ghost.
ViewSettled == << View, settled >>
\* StopTakesEffect reads which run each finished Stop was for.
ViewStopped == << View, [p \in StopIds |-> tgt[p]] >>
\* Every property at once.
ViewAll == << ViewBranch, settled >>

\* Each run's end hook (usage, title and prune jobs) fires at most once.
SettledOnce == \A r \in Runs : settled[r] <= 1

\* At most one pass of a run executes at a time. (A pass in P_Loop still
\* has its controller in `spawned`.)
OnePassPerRun ==
  \A r \in Runs :
    Cardinality(spawned[r])
      + (IF pc[<<"pass", r>>] \in {"P_Begin", "P_Loop"} THEN 0 ELSE 1)
      <= 1

=============================================================================
