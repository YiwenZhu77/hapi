# Branch-from-message — manual e2e checklist

Implemented across commits `b8f50ef` → `f3a92f9` on `feat/branch-from-message`.
No Playwright infra in this repo, so verification is manual.

## Setup

1. Rebuild the hub binary (already done if you ran `bun run build:exe` after this branch):
   ```bash
   cd /glade/work/yizhu/hapi/hub && bun src/index.ts
   ```
2. Open the HAPI web UI in a browser, log in.
3. Confirm the DB has the new columns (one-time, after first hub start on this branch):
   ```bash
   sqlite3 ~/.hapi/hapi.db ".schema sessions" | grep -E "parent_session_id|branched_from_seq"
   ```
   Expect both columns present.

## Checklist

- [ ] **Branch from a finished user prompt.**
  Send a prompt, wait for the AI response to complete, hover the user bubble → click `↗ branch`.
  Expect: toast "Branched: branch of …"; new session appears in the session list AND in the grid view's first available slot.

- [ ] **Branch from a finished AI response.**
  Same as above but click `↗ branch` on the assistant message.
  Expect: same behavior. `parent_session_id` in DB points to the parent, `branched_from_seq` matches the AI message's seq.

- [ ] **Branch from a streaming AI response (mid-stream).**
  Ask for a long answer; while the response is still streaming, click `↗ branch` on the partial assistant card.
  Expect:
  - Toast appears.
  - Original session keeps streaming uninterrupted.
  - New session's `branched_from_seq` matches the highest committed seq at the time of click (typically the user prompt that triggered the stream — see `computeLastCommittedSeq` in `web/src/lib/assistant-runtime.ts`).

- [ ] **Grid full + branch triggers LRU eviction.**
  Pin 6 sessions in the grid. Note which one you've focused least recently (the others' iframes should have been clicked / keyboard-focused after).
  Branch from any message.
  Expect: the least-recently-viewed pinned cell gets replaced by the new branched session. Confirm via:
  ```bash
  cat ~/.config/localStorage/... 2>/dev/null  # or DevTools localStorage panel
  ```
  Look at `hapi.grid.pinnedIds` — the LRU id should be gone, the new branch id present.

- [ ] **Hard refresh preserves the branched session in its slot.**
  After branching, hard-refresh the browser (Cmd-Shift-R / Ctrl-Shift-R).
  Expect: grid restores with the branched session still pinned (because `hapi.grid.pinnedIds` is persisted).

- [ ] **Two browser tabs — branch in tab A appears in tab B's session list.**
  Open two tabs to HAPI. In tab A, branch from a message. Switch to tab B.
  Expect: tab B's session list shows the new branched session within a few seconds (SSE `session-added` event handled by `useSSE.ts:442`). Tab B's grid view does NOT auto-add it (grid placement is per-tab, intentional — the user driving tab B may have their own pinned layout).

- [ ] **DB row sanity check.**
  ```bash
  sqlite3 ~/.hapi/hapi.db \
    "SELECT id, parent_session_id, branched_from_seq, tag FROM sessions WHERE parent_session_id IS NOT NULL ORDER BY created_at DESC LIMIT 5"
  ```
  Expect: branched rows with non-null `parent_session_id` pointing to parents, non-null `branched_from_seq` matching the message seq you branched from, and a `tag` like `branch of <parent>` (or the custom `newName` if supplied).

- [ ] **Branched session inherits parent's config.**
  Compare metadata between parent and child:
  ```bash
  sqlite3 ~/.hapi/hapi.db \
    "SELECT id, json_extract(metadata,'$.path'), model, effort FROM sessions WHERE id IN ('<parent-id>','<child-id>')"
  ```
  Expect: same `path`, `model`, `effort`. `metadata.name` may differ (child gets `branch of …`).

## Failure modes worth probing

- **Branch button hidden on streaming card** — means `lastCommittedSeq` resolved to `undefined`. Should only happen on a session with zero settled messages. Verify with a fresh empty session.
- **Toast says "Branch failed: 500"** — backend bug. Check hub logs for the stack from `sessionBranch.ts` or `sessions.ts:613-643`.
- **Grid doesn't update in same tab** — `useGridPinned`'s `hapi:grid:update` event isn't firing. Inspect `addSessionToGrid` call path in DevTools.
- **Cross-tab session list doesn't update** — SSE connection dropped. Check `useSSE`'s reconnect logic and the EventSource state in DevTools.

## Backing tests already in place

Automated coverage (run before manual sweep):

| Layer | Test file | Covers |
|---|---|---|
| Hub DB op | `hub/src/store/sessionBranch.test.ts` | branchSession copies messages, parent linkage, parent unchanged |
| Hub REST | `hub/src/web/routes/sessions.test.ts` | POST /sessions/:id/branch — 201 / 400 / 404 paths |
| Hub SSE | `hub/src/sync/sessionBranchEvents.test.ts` | `session-added` event published on branch |
| Web seq plumbing | `web/src/chat/normalize.test.ts` | seq passthrough in normalize, null → undefined collapse |
| Web seq selector | `web/src/lib/assistant-runtime.test.ts` | `computeLastCommittedSeq` MAX semantics + tool-group drill-down |
| Web UI | `web/src/components/AssistantChat/messages/MessageBranchMenu.test.tsx` | click success / error / context fallback / grid auto-add / LRU evict |
| Web grid | `web/src/hooks/useGridPinned.test.ts` | append, idempotent, LRU eviction, noteCellViewed |

Run all hub + web tests before promoting this branch to PR:
```bash
cd /glade/work/yizhu/hapi/hub && bun test 2>&1 | tail -5
cd /glade/work/yizhu/hapi/web && ./node_modules/.bin/vitest run 2>&1 | tail -5
```
