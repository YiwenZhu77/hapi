import { describe, it, expect, beforeEach } from 'vitest'
import {
    MAX_PINNED_CELLS,
    readPinnedIds,
    writePinnedIds,
    readLastViewed,
    writeLastViewed,
    noteCellViewed,
    addSessionToGrid,
} from './useGridPinned'

beforeEach(() => {
    localStorage.clear()
})

describe('readPinnedIds / writePinnedIds', () => {
    it('returns [] when storage is empty', () => {
        expect(readPinnedIds()).toEqual([])
    })

    it('round-trips a string[]', () => {
        writePinnedIds(['a', 'b', 'c'])
        expect(readPinnedIds()).toEqual(['a', 'b', 'c'])
    })

    it('ignores garbage values in storage', () => {
        localStorage.setItem('hapi.grid.pinnedIds', '{"not":"array"}')
        expect(readPinnedIds()).toEqual([])
    })

    it('filters non-string entries', () => {
        localStorage.setItem('hapi.grid.pinnedIds', JSON.stringify(['a', 1, null, 'b']))
        expect(readPinnedIds()).toEqual(['a', 'b'])
    })
})

describe('noteCellViewed / readLastViewed', () => {
    it('records a timestamp for the session', () => {
        const before = Date.now()
        noteCellViewed('s1')
        const map = readLastViewed()
        expect(map.s1).toBeGreaterThanOrEqual(before)
    })

    it('updates timestamp on second view', async () => {
        noteCellViewed('s1')
        const t1 = readLastViewed().s1
        await new Promise(r => setTimeout(r, 5))
        noteCellViewed('s1')
        const t2 = readLastViewed().s1
        expect(t2).toBeGreaterThan(t1)
    })
})

describe('addSessionToGrid', () => {
    it('returns index 0 when adding to empty list', () => {
        expect(addSessionToGrid('s1')).toBe(0)
        expect(readPinnedIds()).toEqual(['s1'])
    })

    it('appends when below MAX_PINNED_CELLS', () => {
        writePinnedIds(['a', 'b'])
        const idx = addSessionToGrid('c')
        expect(idx).toBe(2)
        expect(readPinnedIds()).toEqual(['a', 'b', 'c'])
    })

    it('is idempotent: returns existing index without changing order', () => {
        writePinnedIds(['a', 'b', 'c'])
        const idx = addSessionToGrid('b')
        expect(idx).toBe(1)
        expect(readPinnedIds()).toEqual(['a', 'b', 'c'])
    })

    it('evicts least-recently-viewed when at MAX_PINNED_CELLS', () => {
        const ids = Array.from({ length: MAX_PINNED_CELLS }, (_, i) => `s${i}`)
        writePinnedIds(ids)
        // Build a lastViewed map directly to avoid same-millisecond timestamp ties.
        const map: Record<string, number> = {}
        for (let i = 0; i < MAX_PINNED_CELLS; i++) {
            map[`s${i}`] = 1000 + i * 10
        }
        map['s2'] = 1 // force s2 to be the LRU
        writeLastViewed(map)

        const idx = addSessionToGrid('new')
        expect(idx).toBe(2)
        const after = readPinnedIds()
        expect(after).toHaveLength(MAX_PINNED_CELLS)
        expect(after[2]).toBe('new')
        expect(after).not.toContain('s2')
    })

    it('treats unviewed sessions as oldest (timestamp 0) for eviction', () => {
        const ids = Array.from({ length: MAX_PINNED_CELLS }, (_, i) => `s${i}`)
        writePinnedIds(ids)
        // Mark everything except s3 as viewed; s3 should be evicted as LRU
        for (let i = 0; i < MAX_PINNED_CELLS; i++) {
            if (i !== 3) noteCellViewed(`s${i}`)
        }
        const idx = addSessionToGrid('new')
        expect(idx).toBe(3)
        expect(readPinnedIds()[3]).toBe('new')
    })

    it('dispatches an update event on write so listeners can react', () => {
        const listener = (() => {
            let calls = 0
            const fn = () => { calls++ }
            ;(fn as any).count = () => calls
            return fn
        })()
        window.addEventListener('hapi:grid:update', listener)
        addSessionToGrid('s1')
        window.removeEventListener('hapi:grid:update', listener)
        expect((listener as any).count()).toBeGreaterThanOrEqual(1)
    })
})
