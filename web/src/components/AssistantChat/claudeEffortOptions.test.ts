import { describe, expect, it } from 'vitest'
import { getClaudeComposerEffortOptions } from './claudeEffortOptions'

describe('getClaudeComposerEffortOptions', () => {
    it('includes the active non-preset Claude effort in the options list', () => {
        expect(getClaudeComposerEffortOptions('custom')).toEqual([
            { value: null, label: 'Auto' },
            { value: 'custom', label: 'Custom' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Ultra High' },
            { value: 'max', label: 'Max' },
            { value: 'ultracode', label: 'Ultracode' },
        ])
    })

    it('does not duplicate preset Claude effort values', () => {
        expect(getClaudeComposerEffortOptions('ultracode')).toEqual([
            { value: null, label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Ultra High' },
            { value: 'max', label: 'Max' },
            { value: 'ultracode', label: 'Ultracode' },
        ])
    })
})
