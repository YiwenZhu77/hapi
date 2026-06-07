// Single source of truth for session display names. Keeping this in one place
// stops the header, sidebar, Cmd+P palette, grid, and outline from drifting
// apart (they used to each carry their own copy with different priorities).
//
// Display name = metadata.name — a fixed manual name set via rename (Cmd+Shift+N
// / the ⋮ menu), defaulting to the folder basename when unset. HAPI never
// rewrites it. The HAPI-generated auto-title (metadata.summary.text) is kept in
// the data model (used for notifications/preview) but is NOT shown in the name.

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

/**
 * Session display name = the manual name (Cmd+Shift+N / ⋮ rename), or the folder
 * basename when unset. The HAPI-generated auto-title (metadata.summary.text) is
 * deliberately NOT appended: the user controls the name, HAPI never changes it.
 */
export function getSessionTitle(session: TitleSession): string {
    return getSessionPrefix(session)
}
