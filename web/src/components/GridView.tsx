import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard'
import { SessionSearchModal } from '@/components/SessionSearchModal'
import { KBD, isPrimaryMod, isDigitFocusMod } from '@/lib/platform'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { NewSessionModal } from '@/components/NewSessionModal'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useGridPinned, noteCellViewed, MAX_PINNED_CELLS } from '@/hooks/useGridPinned'
import type { SessionSummary } from '@/types/api'

function getSessionTitle(session: SessionSummary): string {
    if (session.metadata?.name) return session.metadata.name
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function getSessionFolder(session: SessionSummary): string {
    const path = (session.metadata as any)?.worktree?.basePath ?? session.metadata?.path ?? ''
    if (!path) return ''
    const parts = path.split('/').filter(Boolean)
    if (parts.length <= 1) return parts[0] ?? ''
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function GridIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
    )
}

function BackIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function CloseIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

type Props = {
    sessions: SessionSummary[]
    baseUrl: string
    token: string
}

export function GridView({ sessions, baseUrl, token }: Props) {
    const navigate = useNavigate()
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    // Persist grid layout across navigation. pinnedIds + lastViewed live in
    // localStorage via useGridPinned so other routes (e.g. MessageBranchMenu
    // calling addSessionToGrid) can stage cells before the user navigates here.
    // stripMode is persisted separately below.
    const STRIP_KEY = 'hapi.grid.stripMode'
    const [pinnedIds, setPinnedIds] = useGridPinned()
    const initializedPinnedRef = useRef(false)

    // First-time fallback: if storage was empty AND we now have sessions,
    // seed with the 4 most-recent active sessions.
    //
    // Only runs once. Do NOT prune pinnedIds against the live sessions list
    // here — `sessions` lags behind localStorage when MessageBranchMenu (or
    // any cross-route source) just added a new session, and it goes empty
    // briefly during React Query refetches. Both cases used to drop the
    // newly-added id and shuffle visual cell order, which broke Alt+digit
    // focus and made branched sessions never appear in the grid. Pinned
    // entries that no longer exist render as empty slots via the `pinned`
    // filter below; stale ids get removed only when the hub explicitly
    // emits session-removed via SSE (see useSSE.ts).
    useEffect(() => {
        if (initializedPinnedRef.current || sessions.length === 0) return
        initializedPinnedRef.current = true
        if (pinnedIds.length === 0) {
            setPinnedIds(sessions.filter(s => s.active).slice(0, 4).map(s => s.id))
        }
    }, [sessions, pinnedIds, setPinnedIds])
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
    // Track LRU for grid eviction: whenever a cell becomes focused, stamp its
    // sessionId in localStorage so addSessionToGrid (called from other routes)
    // knows which cell is the staleist to replace when the grid is full.
    useEffect(() => {
        if (focusedIdx === null) return
        const id = pinnedIds[focusedIdx]
        if (id) noteCellViewed(id)
    }, [focusedIdx, pinnedIds])
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [isNewSessionOpen, setIsNewSessionOpen] = useState(false)
    const [isReplaceOpen, setIsReplaceOpen] = useState(false)
    const [replaceTargetIdx, setReplaceTargetIdx] = useState<number | null>(null)
    const [stripMode, setStripMode] = useState<boolean>(() => {
        try { return localStorage.getItem(STRIP_KEY) === '1' } catch { return false }
    })
    useEffect(() => {
        try { localStorage.setItem(STRIP_KEY, stripMode ? '1' : '0') } catch { /* ignore */ }
    }, [stripMode])
    const [renameTargetId, setRenameTargetId] = useState<string | null>(null)
    const [isRenaming, setIsRenaming] = useState(false)
    const iframeRefs = useRef<(HTMLIFrameElement | null)[]>([])

    const handleRename = useCallback(async (newName: string) => {
        if (!api || !renameTargetId) return
        setIsRenaming(true)
        try {
            await api.renameSession(renameTargetId, newName)
            await queryClient.invalidateQueries({ queryKey: queryKeys.session(renameTargetId) })
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        } finally {
            setIsRenaming(false)
        }
    }, [api, renameTargetId, queryClient])

    // ── notification dot tracking ────────────────────────────────────────────
    // notifiedIds: sessions with a pending notification (dot turns orange)
    // flashingIds: currently playing the 3-flash animation
    const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set())
    const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set())

    // Track thinking→idle transitions to trigger orange flash when a session finishes
    const prevThinkingRef = useRef<Map<string, boolean>>(new Map())
    useEffect(() => {
        const prev = prevThinkingRef.current
        const next = new Map<string, boolean>()
        for (const s of sessions) {
            const wasThinking = prev.get(s.id) ?? false
            next.set(s.id, s.thinking)
            // transition: thinking → not thinking on an active session
            if (wasThinking && !s.thinking && s.active) {
                setNotifiedIds(n => new Set([...n, s.id]))
                setFlashingIds(f => new Set([...f, s.id]))
            }
        }
        prevThinkingRef.current = next
    }, [sessions])

    useEffect(() => {
        const customHandler = (e: Event) => {
            const sessionId: string | undefined = (e as CustomEvent).detail?.sessionId
            if (!sessionId) return
            setNotifiedIds(prev => new Set([...prev, sessionId]))
            setFlashingIds(prev => new Set([...prev, sessionId]))
        }
        // postMessage from iframes (most reliable path)
        const msgHandler = (e: MessageEvent) => {
            const sessionId: string | undefined = e.data?.sessionId
            if (!sessionId) return
            if (e.data?.type === 'grid-cell-toast') {
                setNotifiedIds(prev => new Set([...prev, sessionId]))
                setFlashingIds(prev => new Set([...prev, sessionId]))
            } else if (e.data?.type === 'grid-cell-typing') {
                setNotifiedIds(prev => { const s = new Set(prev); s.delete(sessionId); return s })
                setFlashingIds(prev => { const s = new Set(prev); s.delete(sessionId); return s })
            }
        }
        window.addEventListener('grid-toast', customHandler)
        window.addEventListener('message', msgHandler)
        return () => {
            window.removeEventListener('grid-toast', customHandler)
            window.removeEventListener('message', msgHandler)
        }
    }, [])

    // ── mutable ref holding latest actions ──────────────────────────────────
    // setupIframeKeyboard is registered once per iframe (onLoad); it would
    // capture stale closures if we used callbacks directly. Instead we read
    // actionsRef.current so the handler always sees fresh state.
    const actionsRef = useRef({
        focusIframe: (_n: number) => {},
        moveFocus: (_dir: 'h' | 'j' | 'k' | 'l', _fromIdx?: number) => {},
        toggleStrip: () => {},
        goBack: () => {},
        openAddModal: () => {},
        openReplaceModal: (_idx?: number) => {},
        closeCell: (_idx?: number) => {},
    })

    // Rebuild actionsRef on every render so it always closes over current state
    actionsRef.current = {
        focusIframe(n: number) {
            const idx = n - 1
            const iframe = iframeRefs.current[idx]
            if (!iframe) return
            setFocusedIdx(idx)
            try { iframe.focus() } catch { /* ignore */ }
            try { iframe.contentWindow?.focus() } catch { /* ignore */ }
            try {
                const textarea = iframe.contentDocument?.querySelector('textarea')
                textarea?.focus()
            } catch { /* cross-origin or not-yet-loaded */ }
        },
        toggleStrip() { setStripMode(prev => !prev) },
        goBack() { navigate({ to: '/sessions' }) },
        moveFocus(dir: 'h' | 'j' | 'k' | 'l', fromIdx?: number) {
            const total = pinnedIds.length
            if (total === 0) return
            // Prefer the caller's explicit position (iframe handler knows which
            // cell sent the event) over the React state, which may lag if the
            // user clicked a cell with the mouse without going through
            // focusIframe.
            const current = fromIdx !== undefined && fromIdx >= 0 ? fromIdx : (focusedIdx ?? 0)
            // Effective cols for navigation: treat 5-panel as 3-col
            const navCols = total <= 1 ? 1 : total === 3 ? 3 : total <= 4 ? 2 : total === 5 ? 3 : 3
            let next = current
            if (dir === 'h') next = current % navCols > 0 ? current - 1 : current
            else if (dir === 'l') next = current % navCols < navCols - 1 && current + 1 < total ? current + 1 : current
            else if (dir === 'k') next = current - navCols >= 0 ? current - navCols : (current - 1 + total) % total
            else if (dir === 'j') next = current + navCols < total ? current + navCols : (current + 1) % total
            if (next !== current) actionsRef.current.focusIframe(next + 1)
        },
        openAddModal() {
            setIsAddOpen(true)
        },
        // idx: explicit index from iframe handler (-1 = unknown, fall back to focusedIdx)
        openReplaceModal(idx?: number) {
            const target = idx !== undefined && idx >= 0 ? idx : focusedIdx
            setReplaceTargetIdx(target)
            setIsReplaceOpen(true)
        },
        closeCell(idx?: number) {
            // Priority: explicit idx → focused cell → first pinned (so Cmd+Shift+X
            // works even before the user has clicked any cell)
            let target: number | null | undefined = (idx !== undefined && idx >= 0) ? idx : focusedIdx
            if (target === null || target === undefined) target = pinnedIds.length > 0 ? 0 : null
            if (target === null) return
            const id = pinnedIds[target]
            if (!id) return
            setPinnedIds(prev => prev.filter(p => p !== id))
            setExpandedId(prev => prev === id ? null : prev)
            setFocusedIdx(null)
        },
    }
    // ────────────────────────────────────────────────────────────────────────

    const addSession = useCallback((id: string) => {
        setPinnedIds(prev => prev.includes(id) ? prev : [...prev.slice(-(MAX_PINNED_CELLS - 1)), id])
    }, [setPinnedIds])

    const removeSession = useCallback((id: string) => {
        setPinnedIds(prev => prev.filter(p => p !== id))
        setExpandedId(prev => prev === id ? null : prev)
        setFocusedIdx(null)
    }, [])

    const replaceCell = useCallback((session: SessionSummary) => {
        if (replaceTargetIdx === null) {
            addSession(session.id)
            return
        }
        setPinnedIds(prev => {
            const next = [...prev]
            next[replaceTargetIdx] = session.id
            return next
        })
        setFocusedIdx(replaceTargetIdx)
        setReplaceTargetIdx(null)
    }, [replaceTargetIdx, addSession])

    // Inject keyboard listener into iframe — uses actionsRef so no stale closures.
    // setupIframeKeyboard itself has no deps and is stable forever.
    const setupIframeKeyboard = useCallback((iframe: HTMLIFrameElement) => {
        const win = iframe.contentWindow
        if (!win) return

        const handler = (e: KeyboardEvent) => {
            // Digit focus first — widened (Cmd on Mac, Alt OR Ctrl on Win/Linux).
            if (e.code.startsWith('Digit') && isDigitFocusMod(e) && !e.shiftKey) {
                const n = parseInt(e.code.slice(5))
                if (n >= 1 && n <= 9) {
                    e.preventDefault(); e.stopPropagation()
                    actionsRef.current.focusIframe(n)
                    return
                }
            }
            // Primary modifier: Cmd on Mac, Alt on Win/Linux.
            if (!isPrimaryMod(e)) return

            if (e.code === 'KeyP' && !e.shiftKey) {
                e.preventDefault(); e.stopPropagation()
                actionsRef.current.openAddModal()
                return
            }
            if (e.code === 'KeyF' && e.shiftKey) {
                e.preventDefault(); e.stopPropagation()
                const myIdx = iframeRefs.current.findIndex(ref => ref?.contentWindow === win)
                actionsRef.current.openReplaceModal(myIdx)
                return
            }
            if (e.code === 'KeyX' && !e.shiftKey) {
                e.preventDefault(); e.stopPropagation()
                const myIdx = iframeRefs.current.findIndex(ref => ref?.contentWindow === win)
                actionsRef.current.closeCell(myIdx)
                return
            }
        }

        win.addEventListener('keydown', handler, true)

        // Same modifier for H/L (+ [/] alias) cycle, J/K 2D motion, ; back,
        // ' toggle strip/grid (kept here to share key/scope behavior with the
        // main handler).
        const scrollModHandler = (e: KeyboardEvent) => {
            if (!isPrimaryMod(e) || e.shiftKey) return
            const isPrevKey = e.code === 'KeyH' || e.code === 'BracketLeft'
            const isNextKey = e.code === 'KeyL' || e.code === 'BracketRight'
            if (isPrevKey || isNextKey) {
                e.preventDefault(); e.stopPropagation()
                const myIdx = iframeRefs.current.findIndex(ref => ref?.contentWindow === win)
                const total = iframeRefs.current.filter(Boolean).length
                if (total === 0) return
                const delta = isNextKey ? 1 : -1
                const next = ((myIdx < 0 ? 0 : myIdx) + delta + total) % total
                actionsRef.current.focusIframe(next + 1)
                return
            }
            if (e.code === 'KeyJ' || e.code === 'KeyK') {
                e.preventDefault(); e.stopPropagation()
                const myIdx = iframeRefs.current.findIndex(ref => ref?.contentWindow === win)
                actionsRef.current.moveFocus(e.code === 'KeyJ' ? 'j' : 'k', myIdx)
                return
            }
            if (e.code === 'Semicolon') {
                e.preventDefault(); e.stopPropagation()
                actionsRef.current.goBack()
                return
            }
            if (e.code === 'Quote') {
                e.preventDefault(); e.stopPropagation()
                actionsRef.current.toggleStrip()
                return
            }
        }
        win.addEventListener('keydown', scrollModHandler, true)

        return () => {
            win.removeEventListener('keydown', handler, true)
            win.removeEventListener('keydown', scrollModHandler, true)
        }
    }, []) // stable — reads actionsRef.current at call time

    // Parent-frame shortcuts (fires when parent has focus, not inside an iframe)
    useGlobalKeyboard(sessions, {
        onSelectIndex: (n) => actionsRef.current.focusIframe(n),
        onCyclePinned: (delta) => {
            const total = pinnedIds.length
            if (total === 0) return
            const cur = focusedIdx ?? 0
            const next = ((cur + delta) % total + total) % total
            actionsRef.current.focusIframe(next + 1)
        },
        onMoveFocus: (dir) => actionsRef.current.moveFocus(dir),
        onOpenSearch: () => actionsRef.current.openAddModal(),
        onReplaceCell: () => actionsRef.current.openReplaceModal(),
        onCloseCell: () => actionsRef.current.closeCell(),
        onToggleStrip: () => actionsRef.current.toggleStrip(),
    })

    // Positional alignment with pinnedIds: each slot keeps its index even when
    // the SessionSummary hasn't arrived yet (e.g. a freshly branched session
    // before the sessions query refetches). Missing slots render as a
    // placeholder so Alt+digit / iframeRefs stay 1:1 with pinnedIds.
    const pinnedEntries: (SessionSummary | undefined)[] =
        pinnedIds.map(id => sessions.find(s => s.id === id))
    const pinned = pinnedEntries.filter((s): s is SessionSummary => Boolean(s))
    const unpinned = sessions.filter(s => !pinnedIds.includes(s.id))

    // Strip mode: all panels in one row; otherwise adaptive grid.
    // Layout sizes by pinnedIds.length (positional slot count) so a slot
    // still in flight (session not yet in `sessions`) keeps its place.
    const slotCount = pinnedIds.length
    const isFiveLayout = !stripMode && slotCount === 5
    const cols = stripMode
        ? slotCount || 1
        : slotCount <= 1 ? 1 : slotCount === 3 ? 3 : slotCount <= 4 ? 2 : isFiveLayout ? 6 : 3
    const rows = stripMode ? 1 : isFiveLayout ? 2 : Math.ceil(slotCount / cols)

    // Column span per item index for the 5-panel layout (not used in strip mode)
    const getColSpan = (i: number) => isFiveLayout ? (i < 3 ? 2 : 3) : 1

    const iframeUrl = (sessionId: string) => `/sessions/${sessionId}`

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--app-bg)', position: 'relative' }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                borderBottom: '1px solid var(--app-border)', flexShrink: 0,
                paddingTop: 'calc(6px + env(safe-area-inset-top))'
            }}>
                <button
                    onClick={() => navigate({ to: '/sessions' })}
                    style={{ display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6,
                        color: 'var(--app-hint)', background: 'none', border: 'none', cursor: 'pointer' }}
                    title={`Back (${KBD.primary};)`}
                >
                    <BackIcon />
                </button>
                <GridIcon />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--app-fg)' }}>Grid View</span>
                <span style={{ fontSize: 11, color: 'var(--app-hint)', marginLeft: 2 }}>
                    {KBD.primary}; back · {KBD.primary}P add · {KBD.shift}{KBD.primary}F replace · {KBD.primary}X close · {KBD.primary}1-{Math.min(pinned.length || 9, 9)} focus · {KBD.primary}HL cycle · {KBD.primary}JK scroll · {KBD.primary}' {stripMode ? 'grid' : 'strip'}
                </span>

                {pinnedIds.length < MAX_PINNED_CELLS && (
                    <select
                        onChange={e => {
                            const v = e.target.value
                            if (!v) return
                            if (v === '__new__') setIsNewSessionOpen(true)
                            else addSession(v)
                            e.target.value = ''
                        }}
                        style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 8px',
                            background: 'var(--app-secondary-bg)', border: '1px solid var(--app-border)',
                            borderRadius: 6, color: 'var(--app-fg)', cursor: 'pointer', maxWidth: 200 }}
                        defaultValue=""
                    >
                        <option value="" disabled>+ Add session</option>
                        <option value="__new__">+ New session…</option>
                        {unpinned.map(s => (
                            <option key={s.id} value={s.id}>
                                {getSessionTitle(s)}{getSessionFolder(s) ? ` — ${getSessionFolder(s)}` : ''}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* Grid body */}
            {pinned.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 12, color: 'var(--app-hint)', fontSize: 14 }}>
                    <GridIcon />
                    <span>No sessions pinned.</span>
                    {sessions.length > 0 && (
                        <span style={{ fontSize: 12 }}>Use "+ Add session" or {KBD.primary}P to pin sessions to the grid.</span>
                    )}
                </div>
            ) : expandedId ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px',
                        background: 'var(--app-secondary-bg)', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
                        <button onClick={() => setExpandedId(null)}
                            style={{ fontSize: 12, padding: '2px 10px', borderRadius: 4,
                                background: 'none', border: '1px solid var(--app-border)',
                                color: 'var(--app-fg)', cursor: 'pointer' }}>
                            ← Grid
                        </button>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--app-fg)' }}>
                            {getSessionTitle(sessions.find(s => s.id === expandedId)!)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--app-hint)' }}>
                            {getSessionFolder(sessions.find(s => s.id === expandedId)!)}
                        </span>
                    </div>
                    <iframe
                        src={iframeUrl(expandedId)}
                        style={{ flex: 1, border: 'none', minHeight: 0 }}
                        allow="microphone"
                    />
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                    gap: 4, flex: 1, minHeight: 0, padding: 4
                }}>
                    {pinnedEntries.map((session, i) => {
                        const isFocused = focusedIdx === i
                        if (!session) {
                            // Placeholder: pinnedId is set but the SessionSummary
                            // hasn't arrived yet (e.g. just-branched session
                            // before queryClient refetch finishes). Keep the
                            // slot so positional indexing (Alt+digit, LRU) holds.
                            const id = pinnedIds[i]
                            return (
                                <div key={`pending:${id}`}
                                    onClick={() => actionsRef.current.focusIframe(i + 1)}
                                    style={{ position: 'relative', overflow: 'hidden', minHeight: 0,
                                        gridColumn: getColSpan(i) > 1 ? `span ${getColSpan(i)}` : undefined,
                                        border: isFocused ? '2px solid var(--app-link)' : '1px dashed var(--app-border)',
                                        borderRadius: 8, display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', color: 'var(--app-hint)',
                                        fontSize: 12, fontStyle: 'italic' }}>
                                    Loading session…
                                </div>
                            )
                        }
                        return (
                        <div key={session.id}
                            onClick={() => actionsRef.current.focusIframe(i + 1)}
                            style={{ position: 'relative', overflow: 'hidden', minHeight: 0,
                                gridColumn: getColSpan(i) > 1 ? `span ${getColSpan(i)}` : undefined,
                                border: isFocused ? '2px solid var(--app-link)' : '1px solid var(--app-border)',
                                borderRadius: 8, transition: 'border-color 0.15s' }}>

                            {/* Floating pill — right-aligned */}
                            {(() => {
                                const isNotified = notifiedIds.has(session.id)
                                const isFlashing = flashingIds.has(session.id)
                                const isThinking = session.active && session.thinking
                                const dotColor = isNotified ? '#f97316' : isThinking ? '#3b82f6' : '#34c759'
                                const dotSize = 8
                                const titleColor = isThinking ? '#93c5fd' : '#fff'
                                const subColor = isThinking ? 'rgba(147,197,253,0.7)' : 'rgba(255,255,255,0.6)'
                                const closeColor = isThinking ? 'rgba(147,197,253,0.5)' : 'rgba(255,255,255,0.4)'
                                return (
                                <div className="grid-cell-overlay" style={{
                                    position: 'absolute', top: 5, right: 5, zIndex: 10,
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    maxWidth: 'calc(100% - 10px)',
                                    padding: '3px 6px 3px 8px',
                                    background: 'rgba(0,0,0,0.5)',
                                    backdropFilter: 'blur(8px)',
                                    WebkitBackdropFilter: 'blur(8px)',
                                    borderRadius: 8,
                                    border: '1px solid rgba(255,255,255,0.06)',
                                }}>
                                    {session.active && (
                                        <div
                                            className={isFlashing ? 'animate-toast-alert' : ''}
                                            onAnimationEnd={() => setFlashingIds(prev => { const s = new Set(prev); s.delete(session.id); return s })}
                                            style={{
                                                width: dotSize,
                                                height: dotSize,
                                                borderRadius: '50%',
                                                background: dotColor,
                                                flexShrink: 0,
                                                transition: 'width 0.2s, height 0.2s, background 0.3s',
                                            }}
                                        />
                                    )}
                                    <div style={{ minWidth: 0 }}>
                                        <div
                                            onDoubleClick={(e) => { e.stopPropagation(); setRenameTargetId(session.id) }}
                                            title="Double-click to rename"
                                            style={{ fontSize: 11, fontWeight: 700, color: titleColor,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            transition: 'color 0.3s', cursor: 'text' }}>
                                            {getSessionTitle(session)}
                                        </div>
                                        <div style={{ fontSize: 10, color: subColor,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            transition: 'color 0.3s' }}>
                                            {[session.metadata?.flavor, getSessionFolder(session)].filter(Boolean).join(' · ')}
                                        </div>
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); removeSession(session.id) }}
                                        title={`Remove (${KBD.primary}X)`}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer',
                                            color: closeColor, padding: '0 2px', borderRadius: 3,
                                            display: 'flex', alignItems: 'center', flexShrink: 0,
                                            transition: 'color 0.3s' }}>
                                        <CloseIcon />
                                    </button>
                                </div>
                                )
                            })()}

                            {/* iframe fills the full cell */}
                            <iframe
                                ref={el => { iframeRefs.current[i] = el }}
                                src={iframeUrl(session.id)}
                                style={{ display: 'block', width: '100%', height: '100%',
                                    border: 'none', position: 'absolute', inset: 0 }}
                                allow="microphone"
                                onFocus={() => setFocusedIdx(i)}
                                onLoad={e => setupIframeKeyboard(e.currentTarget)}
                            />
                        </div>
                        )
                    })}
                </div>
            )}

            {/* Cmd+P: add new session to grid (or create brand new) */}
            <SessionSearchModal
                sessions={sessions.filter(s => !pinnedIds.includes(s.id))}
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                onSelect={s => addSession(s.id)}
                onCreateNew={() => { setIsAddOpen(false); setIsNewSessionOpen(true) }}
                actionLabel="Add to grid"
            />

            {/* Cmd+Shift+F: replace focused cell */}
            <SessionSearchModal
                sessions={sessions.filter(s =>
                    s.id === pinnedIds[replaceTargetIdx ?? -1] || !pinnedIds.includes(s.id)
                )}
                isOpen={isReplaceOpen}
                onClose={() => setIsReplaceOpen(false)}
                onSelect={replaceCell}
                actionLabel={replaceTargetIdx !== null ? `Replace ${KBD.primary}${replaceTargetIdx + 1}` : 'Add to grid'}
            />

            {/* "+ New session" from grid: create inline and pin without navigating away */}
            <NewSessionModal
                isOpen={isNewSessionOpen}
                onClose={() => setIsNewSessionOpen(false)}
                onCreated={id => addSession(id)}
            />

            {/* Double-click title: rename session */}
            <RenameSessionDialog
                isOpen={renameTargetId !== null}
                onClose={() => setRenameTargetId(null)}
                currentName={renameTargetId ? getSessionTitle(sessions.find(s => s.id === renameTargetId) ?? { id: '', metadata: null } as SessionSummary) : ''}
                onRename={handleRename}
                isPending={isRenaming}
            />
        </div>
    )
}
