import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { attachBranchToSession } from './sessionBranch'
import { addMessage } from './messages'
import { getOrCreateSession } from './sessions'

let db: Database

beforeEach(() => {
    db = new Database(':memory:', { create: true, readwrite: true, strict: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    // Inline V10 schema — mirrors createSchema() in Store but isolated for unit tests.
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            tag TEXT,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            agent_state TEXT,
            agent_state_version INTEGER DEFAULT 1,
            model TEXT,
            model_reasoning_effort TEXT,
            effort TEXT,
            todos TEXT,
            todos_updated_at INTEGER,
            team_state TEXT,
            team_state_updated_at INTEGER,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0,
            parent_session_id TEXT NULL,
            branched_from_seq INTEGER NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
        CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            local_id TEXT,
            invoked_at INTEGER,
            scheduled_at INTEGER,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;
    `)
})

function createSession(db: Database, name: string) {
    return getOrCreateSession(db, name, { name }, null, 'default', 'opus')
}

/**
 * Simulate what the runner does when spawning a fresh session: insert a row
 * with its own fresh agent-session-id metadata, no parent linkage yet.
 */
function spawnFakeRunnerSession(db: Database, opts: { tag?: string } = {}): { id: string } {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            active, active_at, seq
        ) VALUES (
            @id, @tag, 'default', NULL, @created_at, @updated_at,
            @metadata, 1,
            NULL, 1,
            1, @updated_at, 0
        )
    `).run({
        id,
        tag: opts.tag ?? id,
        created_at: now,
        updated_at: now,
        metadata: JSON.stringify({
            path: '/tmp/project',
            host: 'localhost',
            claudeSessionId: 'fresh-claude-session-' + id.slice(0, 8)
        })
    })
    return { id }
}

describe('attachBranchToSession', () => {
    it('stamps parent_session_id and branched_from_seq onto the spawned row', () => {
        const parent = createSession(db, 'parent')
        addMessage(db, parent.id, { role: 'user', content: 'hello' })
        addMessage(db, parent.id, { role: 'assistant', content: 'hi' })

        const spawned = spawnFakeRunnerSession(db)
        const child = attachBranchToSession(db, {
            sessionId: spawned.id,
            parentSessionId: parent.id,
            branchedFromSeq: 2,
            newName: 'branch of parent',
        })

        expect(child.id).toBe(spawned.id)
        expect(child.id).not.toBe(parent.id)
        expect(child.parentSessionId).toBe(parent.id)
        expect(child.branchedFromSeq).toBe(2)
        expect(child.tag).toBe('branch of parent')
    })

    it('copies messages up to and including branchedFromSeq', () => {
        const parent = createSession(db, 'p')
        addMessage(db, parent.id, { role: 'user', content: 'q1' })
        addMessage(db, parent.id, { role: 'assistant', content: 'a1' })
        addMessage(db, parent.id, { role: 'user', content: 'q2' })

        const spawned = spawnFakeRunnerSession(db)
        const child = attachBranchToSession(db, {
            sessionId: spawned.id,
            parentSessionId: parent.id,
            branchedFromSeq: 2,
        })

        const childMsgs = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq').all(child.id)
        expect(childMsgs.length).toBe(2)
    })

    it('does NOT modify the parent session messages', () => {
        const parent = createSession(db, 'p')
        addMessage(db, parent.id, { role: 'user', content: 'hello' })

        const spawned = spawnFakeRunnerSession(db)
        attachBranchToSession(db, {
            sessionId: spawned.id,
            parentSessionId: parent.id,
            branchedFromSeq: 1,
        })

        const cnt = db.prepare('SELECT count(*) as c FROM messages WHERE session_id = ?').get(parent.id) as { c: number }
        expect(cnt.c).toBe(1)
    })

    it('preserves spawned session metadata (does not overwrite agent-session-id)', () => {
        const parent = createSession(db, 'p')
        const spawned = spawnFakeRunnerSession(db)

        const child = attachBranchToSession(db, {
            sessionId: spawned.id,
            parentSessionId: parent.id,
            branchedFromSeq: 0,
        })

        // The spawn's claudeSessionId must survive — that's how the runner's
        // process is keyed and how dedup avoids merging the branch into the parent.
        const meta = child.metadata as Record<string, unknown>
        expect(typeof meta.claudeSessionId).toBe('string')
        expect(meta.claudeSessionId).toMatch(/^fresh-claude-session-/)
    })

    it('throws when parent does not exist', () => {
        const spawned = spawnFakeRunnerSession(db)
        expect(() => attachBranchToSession(db, {
            sessionId: spawned.id,
            parentSessionId: 'nonexistent',
            branchedFromSeq: 0,
        })).toThrow()
    })

    it('throws when spawned session does not exist', () => {
        const parent = createSession(db, 'p')
        expect(() => attachBranchToSession(db, {
            sessionId: 'never-spawned',
            parentSessionId: parent.id,
            branchedFromSeq: 0,
        })).toThrow()
    })
})
