// Single source of truth for session display names. Keeping this in one place
// stops the header, sidebar, Cmd+P palette, grid, and outline from drifting
// apart (they used to each carry their own copy with different priorities).
//
// Display = "<prefix> · <auto>" where:
//   prefix = metadata.name — a fixed manual name set via rename (Cmd+Shift+N /
//            the ⋮ menu). Defaults to the folder basename when unset. HAPI
//            never rewrites it.
//   auto   = metadata.summary.text — the HAPI-generated auto-title, truncated
//            so the combined string stays short.

export type TitleSession = {
    id: string
    metadata?: {
        name?: string
        summary?: { text: string } | null
        path?: string
        worktree?: { basePath?: string } | null
    } | null
}

const AUTO_MAX = 28

function basename(path: string): string {
    const parts = path.split('/').filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** Folder basename used as the default prefix (worktree base wins over cwd). */
export function getSessionFolderName(session: TitleSession): string {
    const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''
    return basename(path) || session.id.slice(0, 8)
}

/** Fixed manual prefix: the rename name, or the folder basename by default. */
export function getSessionPrefix(session: TitleSession): string {
    const name = session.metadata?.name?.trim()
    return name ? name : getSessionFolderName(session)
}

/** Truncate the auto-title so the combined name stays short. */
export function shortenAuto(text: string, max: number = AUTO_MAX): string {
    const t = text.trim()
    return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** "<prefix> · <auto>", or just the prefix when there is no auto-title yet. */
export function getSessionTitle(session: TitleSession): string {
    const prefix = getSessionPrefix(session)
    const auto = session.metadata?.summary?.text?.trim()
    return auto ? `${prefix} · ${shortenAuto(auto)}` : prefix
}
