import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MessageBranchMenu } from './MessageBranchMenu'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import { ToastProvider } from '@/lib/toast-context'
import type { ApiClient, BranchedSession } from '@/api/client'
import { readPinnedIds, writePinnedIds, MAX_PINNED_CELLS } from '@/hooks/useGridPinned'

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: { notification: vi.fn() },
    }),
}))

function makeChild(overrides: Partial<BranchedSession> = {}): BranchedSession {
    return {
        id: 'child-1',
        tag: null,
        parentSessionId: 'parent-1',
        branchedFromSeq: 42,
        namespace: 'test',
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    }
}

function makeContext(api: ApiClient, sessionId: string = 'parent-1', lastCommittedSeq?: number): HappyChatContextValue {
    return {
        api,
        sessionId,
        metadata: null,
        terminalToolDisplayMode: 'compact',
        disabled: false,
        onRefresh: vi.fn(),
        hasMoreMessages: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: vi.fn().mockResolvedValue(false),
        lastCommittedSeq,
    } as HappyChatContextValue
}

function renderMenu(api: ApiClient, props: {
    onBranched?: (id: string) => void
    sessionId?: string
    messageSeq?: number
    omitMessageSeq?: boolean
    lastCommittedSeq?: number
} = {}) {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const sessionId = props.sessionId ?? 'parent-1'
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <HappyChatProvider value={makeContext(api, sessionId, props.lastCommittedSeq)}>{children}</HappyChatProvider>
                </ToastProvider>
            </QueryClientProvider>
        )
    }
    const seq = props.omitMessageSeq ? undefined : (props.messageSeq ?? 42)
    return render(
        <Wrapper>
            <MessageBranchMenu
                messageSeq={seq}
                onBranched={props.onBranched}
            />
        </Wrapper>
    )
}

describe('MessageBranchMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
    })

    afterEach(() => {
        cleanup()
    })

    it('calls api.branchSession with sessionId + seq and fires onBranched on success', async () => {
        const child = makeChild()
        const branchSession = vi.fn().mockResolvedValue(child)
        const api = { branchSession } as unknown as ApiClient
        const onBranched = vi.fn()

        renderMenu(api, { onBranched })

        const button = screen.getByRole('button', { name: 'Branch from this message' })
        fireEvent.click(button)

        await waitFor(() => {
            expect(branchSession).toHaveBeenCalledWith('parent-1', 42)
        })
        await waitFor(() => {
            expect(onBranched).toHaveBeenCalledWith('child-1')
        })
    })

    it('does not call onBranched when api.branchSession throws and leaves button clickable', async () => {
        const branchSession = vi.fn().mockRejectedValue(new Error('boom'))
        const api = { branchSession } as unknown as ApiClient
        const onBranched = vi.fn()

        renderMenu(api, { onBranched })

        const button = screen.getByRole('button', { name: 'Branch from this message' })
        fireEvent.click(button)

        await waitFor(() => {
            expect(branchSession).toHaveBeenCalledTimes(1)
        })

        // onBranched stays unfired
        expect(onBranched).not.toHaveBeenCalled()

        // Button is interactive again after the failed mutation settles.
        await waitFor(() => {
            expect((button as HTMLButtonElement).disabled).toBe(false)
        })
    })

    it('falls back to context lastCommittedSeq when messageSeq prop is undefined', async () => {
        const child = makeChild({ branchedFromSeq: 5 })
        const branchSession = vi.fn().mockResolvedValue(child)
        const api = { branchSession } as unknown as ApiClient
        const onBranched = vi.fn()

        renderMenu(api, { onBranched, omitMessageSeq: true, lastCommittedSeq: 5 })

        const button = screen.getByRole('button', { name: 'Branch from this message' })
        expect((button as HTMLButtonElement).disabled).toBe(false)
        fireEvent.click(button)

        await waitFor(() => {
            expect(branchSession).toHaveBeenCalledWith('parent-1', 5)
        })
        await waitFor(() => {
            expect(onBranched).toHaveBeenCalledWith('child-1')
        })
    })

    it('adds the new child session to the grid on successful branch', async () => {
        const child = makeChild({ id: 'child-new' })
        const branchSession = vi.fn().mockResolvedValue(child)
        const api = { branchSession } as unknown as ApiClient

        renderMenu(api)

        const button = screen.getByRole('button', { name: 'Branch from this message' })
        fireEvent.click(button)

        await waitFor(() => {
            expect(branchSession).toHaveBeenCalled()
        })
        await waitFor(() => {
            expect(readPinnedIds()).toContain('child-new')
        })
    })

    it('evicts an existing pinned cell when the grid is full', async () => {
        const filler = Array.from({ length: MAX_PINNED_CELLS }, (_, i) => `s${i}`)
        writePinnedIds(filler)
        const child = makeChild({ id: 'child-evict' })
        const branchSession = vi.fn().mockResolvedValue(child)
        const api = { branchSession } as unknown as ApiClient

        renderMenu(api)

        fireEvent.click(screen.getByRole('button', { name: 'Branch from this message' }))

        await waitFor(() => {
            const ids = readPinnedIds()
            expect(ids).toContain('child-evict')
            expect(ids).toHaveLength(MAX_PINNED_CELLS)
        })
    })

    it('disables the button when neither messageSeq prop nor lastCommittedSeq is available', () => {
        const branchSession = vi.fn()
        const api = { branchSession } as unknown as ApiClient

        renderMenu(api, { omitMessageSeq: true })

        const button = screen.getByRole('button', { name: 'Branch from this message' })
        expect((button as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(button)
        expect(branchSession).not.toHaveBeenCalled()
    })
})
