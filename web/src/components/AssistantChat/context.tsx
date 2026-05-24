import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import type { ApiClient } from '@/api/client'
import type { TerminalToolDisplayMode } from '@/hooks/useTerminalToolDisplayMode'
import type { SessionMetadataSummary } from '@/types/api'

export type HappyChatContextValue = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    terminalToolDisplayMode: TerminalToolDisplayMode
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    loadOlderMessagesPreservingScroll: () => Promise<boolean>
    /**
     * Highest committed message seq in the visible timeline (computed by
     * the caller from `VisibleChatBlock[]`). Used as a fallback branch
     * point when a per-message action is mounted on a streaming/partial
     * card whose own seq is undefined. Undefined only when no block in
     * the timeline carries a seq (e.g. a fresh, all-pending session).
     */
    lastCommittedSeq?: number
}

const HappyChatContext = createContext<HappyChatContextValue | null>(null)

export function HappyChatProvider(props: { value: HappyChatContextValue; children: ReactNode }) {
    return (
        <HappyChatContext.Provider value={props.value}>
            {props.children}
        </HappyChatContext.Provider>
    )
}

export function useOptionalHappyChatContext(): HappyChatContextValue | null {
    return useContext(HappyChatContext)
}

export function useHappyChatContext(): HappyChatContextValue {
    const ctx = useOptionalHappyChatContext()
    if (!ctx) {
        throw new Error('HappyChatContext is missing')
    }
    return ctx
}
