import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredSession } from './types'
import { getSession } from './sessions'

type DbMessageRow = {
    id: string
    session_id: string
    content: string
    created_at: number
    seq: number
    local_id: string | null
    invoked_at: number | null
    scheduled_at: number | null
}

export type BranchSessionOptions = {
    parentSessionId: string
    branchedFromSeq: number
    newName?: string
}

/**
 * Create a new session branched from an existing parent session.
 *
 * - Copies the parent row (namespace, model, metadata, etc.) into a new session
 *   with a fresh UUID, recording parent_session_id + branched_from_seq.
 * - Copies all messages with seq <= branchedFromSeq into the child session,
 *   assigning fresh UUIDs and sequential seq numbers starting at 1.
 * - local_id is set to NULL on copied messages to avoid UNIQUE constraint
 *   collisions with the parent's local_id index.
 * - Does NOT modify the parent session or its messages.
 *
 * Throws if the parent session does not exist.
 */
export function branchSession(
    db: Database,
    { parentSessionId, branchedFromSeq, newName }: BranchSessionOptions
): StoredSession {
    const parent = getSession(db, parentSessionId)
    if (!parent) {
        throw new Error(`branchSession: parent session '${parentSessionId}' not found`)
    }

    const now = Date.now()
    const childId = randomUUID()
    const childTag = newName ?? `branch of ${parent.tag ?? parentSessionId}`

    // Strip agent-session-id fields from copied metadata. The branched session is a
    // new conversation; the hub's deduplicateByAgentSessionId treats sessions sharing
    // a claudeSessionId / codexSessionId / etc. as duplicates and merges them — which
    // would delete the new branch. The agent-session-ids will be re-assigned when the
    // branch is resumed/started for the first time.
    const metadataJson = (() => {
        if (parent.metadata === null || parent.metadata === undefined) return null
        if (typeof parent.metadata !== 'object') return JSON.stringify(parent.metadata)
        const stripped = { ...(parent.metadata as Record<string, unknown>) }
        delete stripped.claudeSessionId
        delete stripped.codexSessionId
        delete stripped.geminiSessionId
        delete stripped.opencodeSessionId
        delete stripped.cursorSessionId
        return JSON.stringify(stripped)
    })()
    const agentStateJson = parent.agentState !== null && parent.agentState !== undefined
        ? JSON.stringify(parent.agentState)
        : null
    const todosJson = parent.todos !== null && parent.todos !== undefined
        ? JSON.stringify(parent.todos)
        : null
    const teamStateJson = parent.teamState !== null && parent.teamState !== undefined
        ? JSON.stringify(parent.teamState)
        : null

    db.transaction(() => {
        // 1. Insert new child session row
        db.prepare(`
            INSERT INTO sessions (
                id, tag, namespace, machine_id,
                created_at, updated_at,
                metadata, metadata_version,
                agent_state, agent_state_version,
                model, model_reasoning_effort, effort,
                todos, todos_updated_at,
                team_state, team_state_updated_at,
                active, active_at, seq,
                parent_session_id, branched_from_seq
            ) VALUES (
                @id, @tag, @namespace, NULL,
                @created_at, @updated_at,
                @metadata, @metadata_version,
                @agent_state, @agent_state_version,
                @model, @model_reasoning_effort, @effort,
                @todos, @todos_updated_at,
                @team_state, @team_state_updated_at,
                0, NULL, 0,
                @parent_session_id, @branched_from_seq
            )
        `).run({
            id: childId,
            tag: childTag,
            namespace: parent.namespace,
            created_at: now,
            updated_at: now,
            metadata: metadataJson,
            metadata_version: parent.metadataVersion,
            agent_state: agentStateJson,
            agent_state_version: parent.agentStateVersion,
            model: parent.model ?? null,
            model_reasoning_effort: parent.modelReasoningEffort ?? null,
            effort: parent.effort ?? null,
            todos: todosJson,
            todos_updated_at: parent.todosUpdatedAt ?? null,
            team_state: teamStateJson,
            team_state_updated_at: parent.teamStateUpdatedAt ?? null,
            parent_session_id: parentSessionId,
            branched_from_seq: branchedFromSeq
        })

        // 2. Copy messages with seq <= branchedFromSeq, ordered by seq ASC
        const parentMsgs = db.prepare(
            'SELECT * FROM messages WHERE session_id = ? AND seq <= ? ORDER BY seq ASC'
        ).all(parentSessionId, branchedFromSeq) as DbMessageRow[]

        for (let i = 0; i < parentMsgs.length; i++) {
            const msg = parentMsgs[i]
            const childSeq = i + 1
            // Stamp invoked_at: messages without local_id were invoked at insert time
            // in the original; preserve that. Messages with local_id had an ack path —
            // in the branch they have no local_id so treat as already-invoked.
            const invokedAt = msg.invoked_at ?? now

            db.prepare(`
                INSERT INTO messages (
                    id, session_id, content, created_at, seq,
                    local_id, invoked_at, scheduled_at
                ) VALUES (
                    @id, @session_id, @content, @created_at, @seq,
                    NULL, @invoked_at, NULL
                )
            `).run({
                id: randomUUID(),
                session_id: childId,
                content: msg.content,
                created_at: msg.created_at,
                seq: childSeq,
                invoked_at: invokedAt
            })
        }
    })()

    const child = getSession(db, childId)
    if (!child) {
        throw new Error('branchSession: failed to retrieve newly created child session')
    }
    return child
}
