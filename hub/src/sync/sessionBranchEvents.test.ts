import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

describe('branchSession SSE wiring', () => {
    it('emits a session-added event for the child session when branching', () => {
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

            const child = engine.branchSession({
                parentSessionId: parent.id,
                branchedFromSeq: 0,
                newName: 'my-branch'
            })

            // The StoredSession returned from branchSession must carry the parent link
            // so downstream consumers (UI, /sessions endpoint) can render the branch context.
            expect(child.parentSessionId).toBe(parent.id)
            expect(child.branchedFromSeq).toBe(0)

            // Exactly one session-added event for the new child session, so other tabs'
            // useSSE handlers upsert the branched session into their lists with no polling.
            const addedEvents = events.filter(
                (event) => event.type === 'session-added' && event.sessionId === child.id
            )
            expect(addedEvents.length).toBe(1)

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
