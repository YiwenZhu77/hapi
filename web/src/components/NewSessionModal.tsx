import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NewSession } from '@/components/NewSession'
import { useAppContext } from '@/lib/app-context'
import { useMachines } from '@/hooks/queries/useMachines'
import { queryKeys } from '@/lib/query-keys'

export function NewSessionModal({
    isOpen,
    onClose,
    onCreated,
}: {
    isOpen: boolean
    onClose: () => void
    onCreated: (sessionId: string) => void
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const { machines, isLoading } = useMachines(api, isOpen)

    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isOpen, onClose])

    if (!isOpen) return null

    const handleSuccess = (sessionId: string) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        onCreated(sessionId)
        onClose()
    }

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                paddingTop: '8vh', paddingBottom: '4vh', overflowY: 'auto',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'var(--app-bg)',
                    color: 'var(--app-fg)',
                    border: '1px solid var(--app-border)',
                    borderRadius: 10,
                    width: 'min(560px, 92vw)',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
                    overflow: 'hidden',
                }}
            >
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderBottom: '1px solid var(--app-border)',
                    fontSize: 14, fontWeight: 600,
                }}>
                    <span>New session</span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            background: 'transparent', border: 'none', color: 'var(--app-hint)',
                            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
                        }}
                    >×</button>
                </div>
                <NewSession
                    api={api}
                    machines={machines}
                    isLoading={isLoading}
                    onCancel={onClose}
                    onSuccess={handleSuccess}
                />
            </div>
        </div>
    )
}
