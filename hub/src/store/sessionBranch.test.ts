import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { branchSession } from './sessionBranch'
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

describe('branchSession', () => {
    it('creates a new session with parent_session_id and branched_from_seq', () => {
        const parent = createSession(db, 'parent')
        addMessage(db, parent.id, { role: 'user', content: 'hello' })
        addMessage(db, parent.id, { role: 'assistant', content: 'hi' })

        const child = branchSession(db, {
            parentSessionId: parent.id,
            branchedFromSeq: 2,
            newName: 'branch of parent',
        })

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

        const child = branchSession(db, { parentSessionId: parent.id, branchedFromSeq: 2 })

        const childMsgs = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq').all(child.id)
        expect(childMsgs.length).toBe(2)
    })

    it('does NOT modify the parent session', () => {
        const parent = createSession(db, 'p')
        addMessage(db, parent.id, { role: 'user', content: 'hello' })

        branchSession(db, { parentSessionId: parent.id, branchedFromSeq: 1 })

        const cnt = db.prepare('SELECT count(*) as c FROM messages WHERE session_id = ?').get(parent.id) as { c: number }
        expect(cnt.c).toBe(1)
    })

    it('throws when parent does not exist', () => {
        expect(() => branchSession(db, { parentSessionId: 'nonexistent', branchedFromSeq: 0 })).toThrow()
    })
})
