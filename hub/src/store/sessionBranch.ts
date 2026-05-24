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

export type AttachBranchOptions = {
    /** ID of the already-spawned child session row (created by the runner) */
    sessionId: string
    /** Parent session to link to */
    parentSessionId: string
    /** Cutoff seq on the parent — messages with seq <= this value are copied */
    branchedFromSeq: number
    /** Optional explicit tag/name for the child. If omitted, computed from parent name. */
    newName?: string
}

/**
 * Attach branch-provenance to an already-spawned session.
 *
 * Used by the syncEngine.branchSession flow: the runner has already spawned a
 * fresh agent process and inserted the session row. This helper:
 *   - Stamps parent_session_id + branched_from_seq onto the spawned row.
 *   - Copies parent messages with seq <= branchedFromSeq into the spawned session
 *     (assigning fresh UUIDs + sequential seq numbers starting at 1). local_id is
 *     NULL on copied rows to avoid UNIQUE collisions.
 *   - Sets the human-readable tag to `${parentName}_${N+2}` where N is the
 *     existing branch count for this parent (or to `newName` if provided).
 *
 * Does NOT touch the parent session or its messages. Does NOT modify the
 * spawned session's metadata, agent_state, model, etc. — those came from the
 * runner's spawn and reflect the new fresh process.
 *
 * Throws if the parent or spawned session is missing.
 */
export function attachBranchToSession(
    db: Database,
    { sessionId, parentSessionId, branchedFromSeq, newName }: AttachBranchOptions
): StoredSession {
    const parent = getSession(db, parentSessionId)
    if (!parent) {
        throw new Error(`attachBranchToSession: parent session '${parentSessionId}' not found`)
    }
    const child = getSession(db, sessionId)
    if (!child) {
        throw new Error(`attachBranchToSession: spawned session '${sessionId}' not found`)
    }

    const now = Date.now()

    // Prefer the human-readable name from metadata over `tag` (which often
    // stores an opaque agent-session UUID). Fall back to tag, then parent id prefix.
    const parentDisplayName = (() => {
        const meta = parent.metadata
        if (meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>).name === 'string') {
            const name = ((meta as Record<string, unknown>).name as string).trim()
            if (name) return name
        }
        if (parent.tag && parent.tag.trim()) return parent.tag
        return parentSessionId.slice(0, 8)
    })()

    // Sequential numbering: parent is implicitly _1, first branch is _2, etc.
    // Excludes the just-spawned child itself (it has no parent_session_id yet).
    const existingBranchCount = (db.prepare(
        'SELECT COUNT(*) AS n FROM sessions WHERE parent_session_id = ?'
    ).get(parentSessionId) as { n: number } | undefined)?.n ?? 0
    const childTag = newName ?? `${parentDisplayName}_${existingBranchCount + 2}`

    db.transaction(() => {
        // 1. Stamp parent linkage + tag onto the spawned session row.
        db.prepare(`
            UPDATE sessions
            SET parent_session_id = @parent_session_id,
                branched_from_seq = @branched_from_seq,
                tag = @tag,
                updated_at = @updated_at
            WHERE id = @id
        `).run({
            id: sessionId,
            parent_session_id: parentSessionId,
            branched_from_seq: branchedFromSeq,
            tag: childTag,
            updated_at: now
        })

        // 2. Copy parent messages with seq <= branchedFromSeq.
        const parentMsgs = db.prepare(
            'SELECT * FROM messages WHERE session_id = ? AND seq <= ? ORDER BY seq ASC'
        ).all(parentSessionId, branchedFromSeq) as DbMessageRow[]

        // Find current max seq on the spawned session (the runner may have already
        // recorded a message or two during spawn). We insert copied messages
        // starting at max+1 so we never collide with whatever the runner created.
        const existingMax = (db.prepare(
            'SELECT COALESCE(MAX(seq), 0) AS m FROM messages WHERE session_id = ?'
        ).get(sessionId) as { m: number } | undefined)?.m ?? 0

        for (let i = 0; i < parentMsgs.length; i++) {
            const msg = parentMsgs[i]
            const childSeq = existingMax + i + 1
            // Messages without local_id were invoked at insert time in the original;
            // preserve that. Messages with local_id had an ack path — in the branch
            // they have no local_id so treat as already-invoked.
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
                session_id: sessionId,
                content: msg.content,
                created_at: msg.created_at,
                seq: childSeq,
                invoked_at: invokedAt
            })
        }
    })()

    const updated = getSession(db, sessionId)
    if (!updated) {
        throw new Error('attachBranchToSession: failed to re-read updated child session')
    }
    return updated
}
