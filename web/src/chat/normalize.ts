import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import { safeStringify } from '@hapi/protocol'
import type { DecryptedMessage } from '@/types/api'
import type { NormalizedMessage } from '@/chat/types'
import { isCodexContent, isSkippableAgentContent, normalizeAgentRecord } from '@/chat/normalizeAgent'
import { normalizeUserRecord } from '@/chat/normalizeUser'

export function normalizeDecryptedMessage(message: DecryptedMessage): NormalizedMessage | null {
    // DecryptedMessage.seq is `number | null` (null for pending/optimistic).
    // NormalizedMessage uses `seq?: number`, so collapse null → undefined.
    const seq = typeof message.seq === 'number' ? message.seq : undefined
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) {
        return {
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text: safeStringify(message.content), uuid: message.id, parentUUID: null }],
            status: message.status,
            originalText: message.originalText,
            seq
        }
    }

    if (record.role === 'user') {
        const normalized = normalizeUserRecord(message.id, message.localId, message.createdAt, record.content, record.meta)
        return normalized
            ? { ...normalized, status: message.status, originalText: message.originalText, invokedAt: message.invokedAt, seq }
            : {
                id: message.id,
                localId: message.localId,
                createdAt: message.createdAt,
                role: 'user',
                isSidechain: false,
                content: { type: 'text', text: safeStringify(record.content) },
                meta: record.meta,
                status: message.status,
                originalText: message.originalText,
                invokedAt: message.invokedAt,
                seq
            }
    }
    if (record.role === 'agent') {
        if (isSkippableAgentContent(record.content)) {
            return null
        }
        const normalized = normalizeAgentRecord(message.id, message.localId, message.createdAt, record.content, record.meta)
        if (!normalized && isCodexContent(record.content)) {
            return null
        }
        return normalized
            ? { ...normalized, status: message.status, originalText: message.originalText, invokedAt: message.invokedAt, seq }
            : {
                id: message.id,
                localId: message.localId,
                createdAt: message.createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
                meta: record.meta,
                status: message.status,
                originalText: message.originalText,
                invokedAt: message.invokedAt,
                seq
            }
    }

    return {
        id: message.id,
        localId: message.localId,
        createdAt: message.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: safeStringify(record.content), uuid: message.id, parentUUID: null }],
        meta: record.meta,
        status: message.status,
        originalText: message.originalText,
        invokedAt: message.invokedAt,
        seq
    }
}
