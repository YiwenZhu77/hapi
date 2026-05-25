import { useEffect, useState, useCallback } from 'react'

/**
 * Cap on simultaneous pinned cells in the grid view.
 * Matches the historical `slice(-5) + new` behavior in GridView.tsx.
 */
export const MAX_PINNED_CELLS = 6

const PINNED_KEY = 'hapi.grid.pinnedIds'
const LAST_VIEWED_KEY = 'hapi.grid.lastViewed'

/** Fired (same-tab/window) whenever pinnedIds is written.
 *
 * We deliberately do NOT subscribe to the native 'storage' event: HAPI runs
 * as a PWA where each window is its own scratchpad, and users expect
 * independent grid layouts across windows. Native 'storage' fires in OTHER
 * windows of the same origin — listening to it would force every window to
 * mirror the same pinned list.
 *
 * Iframe ↔ parent propagation (e.g. MessageBranchMenu in a chat iframe
 * calling addSessionToGrid, which the /grid page in the parent window
 * should pick up) is handled via postMessage in `notifyGridUpdate`. The
 * postMessage stays within the window's frame tree and doesn't leak to
 * other windows. */
export const GRID_UPDATE_EVENT = 'hapi:grid:update'
const GRID_UPDATE_MESSAGE = 'hapi.grid.update'

function safeGet(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
}

function safeSet(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch { /* storage full / disabled */ }
}

export function readPinnedIds(): string[] {
    const raw = safeGet(PINNED_KEY)
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((x): x is string => typeof x === 'string')
    } catch { return [] }
}

function notifyGridUpdate(): void {
    // Same-window listeners (the /grid route's useGridPinned)
    try { window.dispatchEvent(new Event(GRID_UPDATE_EVENT)) } catch { /* SSR */ }
    // If this write happened inside an iframe, hop up the frame tree so the
    // parent /grid view re-reads localStorage. Walk all ancestors in case
    // we're nested deeper than one level.
    try {
        let w: Window = window
        while (w.parent && w.parent !== w) {
            w = w.parent
            w.postMessage({ type: GRID_UPDATE_MESSAGE }, '*')
        }
    } catch { /* cross-origin parent — shouldn't happen here */ }
}

export function writePinnedIds(ids: string[]): void {
    safeSet(PINNED_KEY, JSON.stringify(ids))
    notifyGridUpdate()
}

export function readLastViewed(): Record<string, number> {
    const raw = safeGet(LAST_VIEWED_KEY)
    if (!raw) return {}
    try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const out: Record<string, number> = {}
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'number') out[k] = v
        }
        return out
    } catch { return {} }
}

export function writeLastViewed(map: Record<string, number>): void {
    safeSet(LAST_VIEWED_KEY, JSON.stringify(map))
}

export function noteCellViewed(sessionId: string): void {
    if (!sessionId) return
    const m = readLastViewed()
    m[sessionId] = Date.now()
    writeLastViewed(m)
}

/**
 * Add a session to the grid's pinned list. If the list is already at
 * MAX_PINNED_CELLS, evict the least-recently-viewed pinned session
 * (sessions never viewed default to timestamp 0 = oldest). Returns the
 * slot index where the session landed.
 *
 * Idempotent: if the session is already pinned, returns its existing
 * index without re-ordering.
 */
export function addSessionToGrid(sessionId: string): number {
    const current = readPinnedIds()
    const existingIdx = current.indexOf(sessionId)
    if (existingIdx >= 0) return existingIdx

    if (current.length < MAX_PINNED_CELLS) {
        const next = [...current, sessionId]
        writePinnedIds(next)
        return next.length - 1
    }

    // Evict LRU
    const lastViewed = readLastViewed()
    let lruIdx = 0
    let lruTime = Infinity
    for (let i = 0; i < current.length; i++) {
        const t = lastViewed[current[i]] ?? 0
        if (t < lruTime) { lruTime = t; lruIdx = i }
    }
    const next = current.slice()
    next[lruIdx] = sessionId
    writePinnedIds(next)
    return lruIdx
}

/**
 * React hook returning the current pinnedIds, auto-syncing on:
 *  - same-tab writes via GRID_UPDATE_EVENT
 *  - cross-tab writes via native 'storage' event
 */
export function useGridPinned(): [string[], (ids: string[] | ((prev: string[]) => string[])) => void] {
    const [pinnedIds, setPinnedIdsState] = useState<string[]>(() => readPinnedIds())

    useEffect(() => {
        const sync = () => setPinnedIdsState(readPinnedIds())
        const onMessage = (e: MessageEvent) => {
            if (e.data && typeof e.data === 'object' && e.data.type === GRID_UPDATE_MESSAGE) {
                sync()
            }
        }
        window.addEventListener(GRID_UPDATE_EVENT, sync)
        window.addEventListener('message', onMessage)
        return () => {
            window.removeEventListener(GRID_UPDATE_EVENT, sync)
            window.removeEventListener('message', onMessage)
        }
    }, [])

    const setPinnedIds = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
        setPinnedIdsState(prev => {
            const next = typeof updater === 'function' ? (updater as (p: string[]) => string[])(prev) : updater
            writePinnedIds(next)
            return next
        })
    }, [])

    return [pinnedIds, setPinnedIds]
}
