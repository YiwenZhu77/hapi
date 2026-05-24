import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { usePlatform } from '@/hooks/usePlatform'
import { useToast } from '@/lib/toast-context'
import { queryKeys } from '@/lib/query-keys'
import { addSessionToGrid } from '@/hooks/useGridPinned'
import type { BranchedSession } from '@/api/client'

/**
 * Per-message branch button. Calls POST /api/sessions/:id/branch via
 * ApiClient.branchSession and notifies the caller with the new child
 * session id so a parent (e.g. grid placement in Task 3.6) can react.
 *
 * sessionId is sourced from HappyChatContext (single source of truth);
 * callers only supply the seq + onBranched callback.
 *
 * `messageSeq` is optional: when omitted (e.g. mounted on a streaming
 * card whose own seq is undefined) the menu falls back to the context's
 * `lastCommittedSeq`, i.e. the highest seq currently in the timeline.
 * That typically points at the user prompt that triggered the in-flight
 * stream, making branch-from-here reachable mid-stream.
 */
export function MessageBranchMenu(props: {
    messageSeq?: number
    onBranched?: (newSessionId: string) => void
    className?: string
}) {
    const { api, sessionId, lastCommittedSeq } = useHappyChatContext()
    const queryClient = useQueryClient()
    const { haptic } = usePlatform()
    const { addToast } = useToast()

    const effectiveSeq = props.messageSeq ?? lastCommittedSeq

    const mutation = useMutation<BranchedSession, Error, void>({
        mutationFn: () => {
            if (typeof effectiveSeq !== 'number') {
                return Promise.reject(new Error('No branch point available yet'))
            }
            return api.branchSession(sessionId, effectiveSeq)
        },
        onSuccess: (child) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
            haptic.notification('success')
            // Task 3.6: branched session auto-fills a grid slot. When the grid
            // is full, the least-recently-viewed pinned cell is evicted.
            // Storage write is cross-route — GridView (on /grid) picks it up
            // via the GRID_UPDATE_EVENT / 'storage' listeners in useGridPinned.
            try { addSessionToGrid(child.id) } catch { /* localStorage disabled — non-fatal */ }
            props.onBranched?.(child.id)
        },
        onError: (error) => {
            haptic.notification('error')
            // Surface failure visibly: on desktop/web haptic is a no-op,
            // so without this a 500 from the hub would vanish silently.
            addToast({
                title: 'Branch failed',
                body: error?.message ?? 'Could not branch session',
                sessionId,
                url: window.location.href,
            })
        },
    })

    const isBranching = mutation.isPending
    const disabled = isBranching || typeof effectiveSeq !== 'number'
    const baseClassName = 'text-[10px] text-[var(--app-hint)] underline-offset-2 hover:text-[var(--app-fg)] hover:underline disabled:opacity-50'
    const className = props.className ? `${baseClassName} ${props.className}` : baseClassName

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => mutation.mutate()}
            title={typeof effectiveSeq === 'number'
                ? `Branch from this message (seq ${effectiveSeq})`
                : 'Branch unavailable until first message is committed'}
            aria-label="Branch from this message"
            className={className}
        >
            {isBranching ? '↗ branching…' : '↗ branch'}
        </button>
    )
}
