import type { Session } from '../sync/syncEngine'
import type { NotificationChannel, TaskNotification } from '../notifications/notificationTypes'
import { getAgentName, getSessionName } from '../notifications/sessionInfo'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { PushPayload, PushService } from './pushService'

export class PushNotificationChannel implements NotificationChannel {
    constructor(
        private readonly pushService: PushService,
        private readonly sseManager: SSEManager,
        private readonly visibilityTracker: VisibilityTracker,
        _appUrl: string
    ) {}

    async sendPermissionRequest(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const name = getSessionName(session)
        const request = session.agentState?.requests
            ? Object.values(session.agentState.requests)[0]
            : null
        const toolName = request?.tool ? ` (${request.tool})` : ''

        const payload: PushPayload = {
            title: 'Permission Request',
            body: `${name}${toolName}`,
            tag: `permission-${session.id}`,
            data: {
                type: 'permission-request',
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        const url = payload.data?.url ?? this.buildSessionPath(session.id)
        // Always do both: in-page toast for clients currently watching, and a
        // push for OS-level notification (other devices in the same namespace,
        // or this device when it's backgrounded). The previous SSE-first
        // short-circuit suppressed push for the entire namespace whenever any
        // one client was visible — a phone foregrounded on the desk muted the
        // desktop PWA in the background. SW dedupes via the payload's tag, so
        // the same alert won't stack on a foregrounded device.
        if (this.visibilityTracker.hasVisibleConnection(session.namespace)) {
            void this.sseManager.sendToast(session.namespace, {
                type: 'toast',
                data: {
                    title: payload.title,
                    body: payload.body,
                    sessionId: session.id,
                    url
                }
            })
        }

        await this.pushService.sendToNamespace(session.namespace, payload)
    }

    async sendReady(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const name = getSessionName(session)

        const payload: PushPayload = {
            title: 'Ready for input',
            body: `${agentName} is waiting in ${name}`,
            tag: `ready-${session.id}`,
            data: {
                type: 'ready',
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        const url = payload.data?.url ?? this.buildSessionPath(session.id)
        // Always do both: in-page toast for clients currently watching, and a
        // push for OS-level notification (other devices in the same namespace,
        // or this device when it's backgrounded). The previous SSE-first
        // short-circuit suppressed push for the entire namespace whenever any
        // one client was visible — a phone foregrounded on the desk muted the
        // desktop PWA in the background. SW dedupes via the payload's tag, so
        // the same alert won't stack on a foregrounded device.
        if (this.visibilityTracker.hasVisibleConnection(session.namespace)) {
            void this.sseManager.sendToast(session.namespace, {
                type: 'toast',
                data: {
                    title: payload.title,
                    body: payload.body,
                    sessionId: session.id,
                    url
                }
            })
        }

        await this.pushService.sendToNamespace(session.namespace, payload)
    }

    async sendTaskNotification(session: Session, notification: TaskNotification): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const name = getSessionName(session)
        const normalizedStatus = notification.status?.trim().toLowerCase()
        const isFailure = normalizedStatus === 'failed'
            || normalizedStatus === 'error'
            || normalizedStatus === 'killed'
            || normalizedStatus === 'aborted'

        const payload: PushPayload = {
            title: isFailure ? 'Task failed' : 'Task completed',
            body: `${agentName} · ${name} · ${notification.summary}`,
            data: {
                type: 'task-notification',
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        const url = payload.data?.url ?? this.buildSessionPath(session.id)
        // Always do both: in-page toast for clients currently watching, and a
        // push for OS-level notification (other devices in the same namespace,
        // or this device when it's backgrounded). The previous SSE-first
        // short-circuit suppressed push for the entire namespace whenever any
        // one client was visible — a phone foregrounded on the desk muted the
        // desktop PWA in the background. SW dedupes via the payload's tag, so
        // the same alert won't stack on a foregrounded device.
        if (this.visibilityTracker.hasVisibleConnection(session.namespace)) {
            void this.sseManager.sendToast(session.namespace, {
                type: 'toast',
                data: {
                    title: payload.title,
                    body: payload.body,
                    sessionId: session.id,
                    url
                }
            })
        }

        await this.pushService.sendToNamespace(session.namespace, payload)
    }

    private buildSessionPath(sessionId: string): string {
        return `/sessions/${sessionId}`
    }
}
