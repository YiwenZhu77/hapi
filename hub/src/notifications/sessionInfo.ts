import { getFlavorLabel, isKnownFlavor } from '@hapi/protocol'
import type { Session } from '../sync/syncEngine'

// Mirror of web/src/lib/sessionTitle.ts (separate package, can't import).
// Display name = manual name (Cmd+Shift+N rename) or folder basename. The HAPI
// auto-title (summary) is NOT appended — HAPI never auto-renames a session.
// Keep in sync with the web helper.
function folderName(session: Session): string {
    const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''
    const parts = path.split('/').filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
}

export function getSessionName(session: Session): string {
    return session.metadata?.name?.trim() || folderName(session)
}

export function getAgentName(session: Session): string {
    const flavor = session.metadata?.flavor
    if (!flavor || !isKnownFlavor(flavor)) return 'Agent'
    return getFlavorLabel(flavor)
}
