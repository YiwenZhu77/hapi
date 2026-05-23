import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { isPrimaryMod, isDigitFocusMod } from '@/lib/platform'

type Options = {
    // Grid mode: <Primary>+1-9 focus nth pinned cell instead of navigating
    onSelectIndex?: (n: number) => void
    // Grid mode: <Primary>+H/L cycle prev/next pinned cell instead of navigating
    onCyclePinned?: (delta: -1 | 1) => void
    // <Primary>+P: open search palette (add session to grid, or navigate)
    onOpenSearch?: () => void
    // <Primary>+F: replace currently focused grid cell
    onReplaceCell?: () => void
    // <Primary>+X: close currently focused grid cell
    onCloseCell?: () => void
    // <Primary>+': toggle strip/grid layout
    onToggleStrip?: () => void
}

// Primary modifier: Cmd on Mac, Ctrl on Windows/Linux.
// Note: some Cmd combos on Mac browsers can't be intercepted (e.g. Cmd+H hides
// the app at OS level). Install as PWA for fewer browser conflicts (Cmd+1-9).
function getCurrentSessionId(): string | null {
    const m = /^\/sessions\/([^/]+)/.exec(window.location.pathname)
    return m && m[1] !== 'new' ? m[1] : null
}

export function useGlobalKeyboard(sessions: { id: string }[], options: Options = {}) {
    const navigate = useNavigate()

    useEffect(() => {
        // Don't register shortcuts when running inside a grid iframe
        if (window.self !== window.top) return

        const onKeyDown = (e: KeyboardEvent) => {
            // Digit focus shortcut uses a more permissive modifier
            // (Mac: Cmd; Win/Linux: Alt OR Ctrl) — handled FIRST so Ctrl+1 also
            // works as a fallback when Chrome PWA on Win intercepts plain Alt+1.
            if (e.code.startsWith('Digit') && isDigitFocusMod(e) && !e.shiftKey) {
                const n = parseInt(e.code.slice(5))
                if (n >= 1 && n <= 9) {
                    e.preventDefault()
                    if (options.onSelectIndex) {
                        options.onSelectIndex(n)
                        return
                    }
                    const target = sessions[n - 1]
                    if (target) navigate({ to: '/sessions/$sessionId', params: { sessionId: target.id } })
                    return
                }
            }

            // Primary modifier: Cmd on Mac, Alt on Win/Linux.
            if (!isPrimaryMod(e)) return

            // <Primary>+P → open palette
            if (e.code === 'KeyP' && !e.shiftKey) {
                if (options.onOpenSearch) { e.preventDefault(); options.onOpenSearch(); return }
                return
            }
            // <Primary>+Shift+F → replace focused cell (plain Cmd+F left to browser find)
            if (e.code === 'KeyF' && e.shiftKey) {
                if (options.onReplaceCell) { e.preventDefault(); options.onReplaceCell(); return }
                return
            }
            // <Primary>+X → close focused cell
            if (e.code === 'KeyX' && !e.shiftKey) {
                if (options.onCloseCell) { e.preventDefault(); options.onCloseCell(); return }
                return
            }
            // <Primary>+Shift+N — new session
            if (e.code === 'KeyN' && e.shiftKey) {
                e.preventDefault()
                navigate({ to: '/sessions/new' })
            }
        }

        window.addEventListener('keydown', onKeyDown, true)

        // <Primary>+H/L → cycle pinned cells (grid) or prev/next session (normal).
        // <Primary>+; → toggle grid view. <Primary>+' → toggle strip/grid layout.
        // Mac: Cmd; Windows/Linux: Alt.
        const onScrollMod = (e: KeyboardEvent) => {
            if (!isPrimaryMod(e) || e.shiftKey) return
            if (e.code === 'KeyH' || e.code === 'KeyL') {
                const delta = e.code === 'KeyL' ? 1 : -1
                e.preventDefault()
                if (options.onCyclePinned) {
                    options.onCyclePinned(delta)
                    return
                }
                if (sessions.length === 0) return
                const currentId = getCurrentSessionId()
                const curIdx = currentId ? sessions.findIndex(s => s.id === currentId) : -1
                const nextIdx = curIdx < 0
                    ? (delta > 0 ? 0 : sessions.length - 1)
                    : (curIdx + delta + sessions.length) % sessions.length
                const next = sessions[nextIdx]
                if (next) navigate({ to: '/sessions/$sessionId', params: { sessionId: next.id } })
                return
            }
            if (e.code === 'Semicolon') {
                e.preventDefault()
                const isGrid = window.location.pathname === '/grid'
                navigate({ to: isGrid ? '/sessions' : '/grid' })
                return
            }
            if (e.code === 'Quote') {
                if (options.onToggleStrip) { e.preventDefault(); options.onToggleStrip() }
                return
            }
        }
        window.addEventListener('keydown', onScrollMod, true)

        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('keydown', onScrollMod, true)
        }
    }, [navigate, sessions, options.onSelectIndex, options.onCyclePinned, options.onOpenSearch, options.onReplaceCell, options.onCloseCell, options.onToggleStrip])
}
