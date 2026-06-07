import { describe, expect, it } from 'vitest'
import { getSessionTitle, getSessionPrefix, getSessionFolderName } from './sessionTitle'

describe('sessionTitle', () => {
    const withMeta = (meta: Record<string, unknown>) => ({ id: 'sess-1234abcd', metadata: meta as never })

    it('uses the manual name when set', () => {
        expect(getSessionTitle(withMeta({ name: 'My Run' }))).toBe('My Run')
    })

    it('falls back to the folder basename when no manual name', () => {
        expect(getSessionTitle(withMeta({ path: '/glade/work/yizhu/OpOF' }))).toBe('OpOF')
    })

    it('does NOT append the HAPI auto-title (summary) to the display name', () => {
        // The whole point: HAPI must not auto-rename. The auto summary is ignored
        // for display; the name is the manual name (or folder) only.
        expect(getSessionTitle(withMeta({
            name: 'My Run',
            summary: { text: 'agent-generated chat about debugging' }
        }))).toBe('My Run')
    })

    it('ignores auto-title even when only the folder default is available', () => {
        expect(getSessionTitle(withMeta({
            path: '/glade/work/yizhu/OpOF',
            summary: { text: 'some auto summary' }
        }))).toBe('OpOF')
    })

    it('prefix and title agree (no auto component anywhere)', () => {
        const s = withMeta({ name: 'Manual', summary: { text: 'auto' } })
        expect(getSessionTitle(s)).toBe(getSessionPrefix(s))
    })

    it('falls back to id prefix when no path or name', () => {
        expect(getSessionFolderName(withMeta({}))).toBe('sess-123')
    })
})
