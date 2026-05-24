import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

describe('branchSession SSE wiring', () => {
    it('emits a session-added event for the child session when branching', async () => {
        const store = new Store(':memory:')
        const io = {
            of: () => ({
                to: () => ({
                    emit: () => {}
                })
            })
        }
        const engine = new SyncEngine(
            store,
            io as never,
            new RpcRegistry(),
            { broadcast() {} } as never
        )

        // The branchSession flow goes through the runner via rpcGateway.spawnSession
        // and waits for the spawned session to become active. With no real runner
        // attached, we mock both: spawn inserts a fresh session row directly, and
        // mark it active in the cache so waitForSessionActive returns true.
        const engineAny = engine as unknown as {
            rpcGateway: { spawnSession: (...args: unknown[]) => Promise<unknown> }
            machineCache: {
                getOnlineMachinesByNamespace: (ns: string) => Array<{ id: string; metadata?: { host?: string } }>
            }
            sessionCache: {
                refreshSession: (id: string) => unknown
                getSession: (id: string) => { active: boolean } | undefined
            }
        }

        engineAny.machineCache.getOnlineMachinesByNamespace = () => [
            { id: 'fake-machine', metadata: { host: 'localhost' } }
        ]

        engineAny.rpcGateway.spawnSession = async () => {
            // Simulate what the runner does: insert a new session row with fresh
            // metadata + mark it active.
            const spawnedId = crypto.randomUUID()
            const now = Date.now()
            // Direct DB insert — bypasses the normal getOrCreateSession path
            // because we want full control over the spawned row shape.
            ;(store as unknown as { db: { prepare: (q: string) => { run: (p: unknown) => void } } }).db.prepare(`
                INSERT INTO sessions (
                    id, tag, namespace, machine_id, created_at, updated_at,
                    metadata, metadata_version,
                    agent_state, agent_state_version,
                    active, active_at, seq
                ) VALUES (
                    @id, @tag, 'default', 'fake-machine', @ts, @ts,
                    @metadata, 1, NULL, 1,
                    1, @ts, 0
                )
            `).run({
                id: spawnedId,
                tag: spawnedId,
                ts: now,
                metadata: JSON.stringify({
                    path: '/tmp/project',
                    host: 'localhost',
                    claudeSessionId: 'fresh-' + spawnedId.slice(0, 8)
                })
            })
            engineAny.sessionCache.refreshSession(spawnedId)
            return { type: 'success', sessionId: spawnedId }
        }

        const events: SyncEvent[] = []
        const unsubscribe = engine.subscribe((event) => {
            events.push(event)
        })

        try {
            const parent = engine.getOrCreateSession(
                'session-branch-parent',
                { path: '/tmp/project', host: 'localhost' },
                { requests: {}, completedRequests: {} },
                'default'
            )

            // Clear initial 'session-added' for the parent so we only see the branch event.
            events.length = 0

            const child = await engine.branchSession({
                parentSessionId: parent.id,
                branchedFromSeq: 0,
                newName: 'my-branch'
            })

            // The StoredSession returned from branchSession must carry the parent link
            // so downstream consumers (UI, /sessions endpoint) can render the branch context.
            expect(child.parentSessionId).toBe(parent.id)
            expect(child.branchedFromSeq).toBe(0)

            // At least one session-added event for the new child session, so other tabs'
            // useSSE handlers upsert the branched session into their lists with no polling.
            const addedEvents = events.filter(
                (event) => event.type === 'session-added' && event.sessionId === child.id
            )
            expect(addedEvents.length).toBeGreaterThanOrEqual(1)

            const added = addedEvents[0]
            if (added.type !== 'session-added') return
            expect(added.data).toEqual(
                expect.objectContaining({
                    id: child.id,
                    namespace: parent.namespace
                })
            )
        } finally {
            unsubscribe()
            engine.stop()
        }
    })
})
