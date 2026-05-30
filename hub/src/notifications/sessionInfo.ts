import { getFlavorLabel, isKnownFlavor } from '@hapi/protocol'
import type { Session } from '../sync/syncEngine'

// Mirror of web/src/lib/sessionTitle.ts (separate package, can't import).
// Display = "<prefix> · <auto>": prefix = manual name or folder basename,
// auto = HAPI summary truncated. Keep in sync with the web helper.
function folderName(session: Session): string {
    const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''
    const parts = path.split('/').filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
}

export function getSessionName(session: Session): string {
    const prefix = session.metadata?.name?.trim() || folderName(session)
    const auto = session.metadata?.summary?.text?.trim()
    if (!auto) return prefix
    const shortAuto = auto.length > 28 ? `${auto.slice(0, 27)}…` : auto
    return `${prefix} · ${shortAuto}`
}

export function getAgentName(session: Session): string {
    const flavor = session.metadata?.flavor
    if (!flavor || !isKnownFlavor(flavor)) return 'Agent'
    return getFlavorLabel(flavor)
}
