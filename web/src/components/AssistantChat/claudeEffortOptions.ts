export type ClaudeComposerEffortOption = {
    value: string | null
    label: string
}

// Effort options shown in the composer.
// low/medium/high/xhigh/max are the claude runtime's real --effort values.
// 'ultracode' is a HAPI-side pseudo-level: xhigh effort + standing
// dynamic-workflow orchestration. The runtime's --effort REJECTS 'ultracode',
// so the CLI maps it to (--effort xhigh) + the per-session `ultracode: true`
// settings key (see cli/src/claude/sdk/query.ts + generateHookSettings.ts).
// Needs an xhigh-capable model (Opus 4.8) and dynamic workflows enabled.
const CLAUDE_EFFORT_PRESETS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] as const
const CLAUDE_EFFORT_LABELS: Record<(typeof CLAUDE_EFFORT_PRESETS)[number], string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Ultra High',
    max: 'Max',
    ultracode: 'Ultracode'
}

function normalizeClaudeComposerEffort(effort?: string | null): string | null {
    const trimmedEffort = effort?.trim().toLowerCase()
    if (!trimmedEffort || trimmedEffort === 'auto' || trimmedEffort === 'default') {
        return null
    }

    return trimmedEffort
}

function formatEffortLabel(effort: string): string {
    return CLAUDE_EFFORT_LABELS[effort as keyof typeof CLAUDE_EFFORT_LABELS]
        ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

export function getClaudeComposerEffortOptions(currentEffort?: string | null): ClaudeComposerEffortOption[] {
    const normalizedCurrentEffort = normalizeClaudeComposerEffort(currentEffort)
    const options: ClaudeComposerEffortOption[] = [
        { value: null, label: 'Auto' }
    ]

    if (
        normalizedCurrentEffort
        && !CLAUDE_EFFORT_PRESETS.includes(normalizedCurrentEffort as typeof CLAUDE_EFFORT_PRESETS[number])
    ) {
        options.push({
            value: normalizedCurrentEffort,
            label: formatEffortLabel(normalizedCurrentEffort)
        })
    }

    options.push(...CLAUDE_EFFORT_PRESETS.map((effort) => ({
        value: effort,
        label: CLAUDE_EFFORT_LABELS[effort]
    })))

    return options
}
