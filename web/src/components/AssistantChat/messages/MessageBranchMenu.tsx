import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { usePlatform } from '@/hooks/usePlatform'
import { useToast } from '@/lib/toast-context'
import { queryKeys } from '@/lib/query-keys'
import type { BranchedSession } from '@/api/client'

/**
 * Per-message branch button. Calls POST /api/sessions/:id/branch via
 * ApiClient.branchSession and notifies the caller with the new child
 * session id so a parent (e.g. grid placement in Task 3.6) can react.
 *
 * sessionId is sourced from HappyChatContext (single source of truth);
 * callers only supply the seq + onBranched callback.
 */
export function MessageBranchMenu(props: {
    messageSeq: number
    onBranched?: (newSessionId: string) => void
    className?: string
}) {
    const { api, sessionId } = useHappyChatContext()
    const queryClient = useQueryClient()
    const { haptic } = usePlatform()
    const { addToast } = useToast()

    const mutation = useMutation<BranchedSession, Error, void>({
        mutationFn: () => api.branchSession(sessionId, props.messageSeq),
        onSuccess: (child) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
            haptic.notification('success')
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
    const baseClassName = 'text-[10px] text-[var(--app-hint)] underline-offset-2 hover:text-[var(--app-fg)] hover:underline disabled:opacity-50'
    const className = props.className ? `${baseClassName} ${props.className}` : baseClassName

    return (
        <button
            type="button"
            disabled={isBranching}
            onClick={() => mutation.mutate()}
            title={`Branch from this message (seq ${props.messageSeq})`}
            aria-label="Branch from this message"
            className={className}
        >
            {isBranching ? '↗ branching…' : '↗ branch'}
        </button>
    )
}
