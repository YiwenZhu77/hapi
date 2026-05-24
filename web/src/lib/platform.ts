// Platform detection + keyboard shortcut display helpers.

export const isMac: boolean = (() => {
    if (typeof navigator === 'undefined') return false
    // userAgentData is the modern way; fall back to platform/userAgent for older browsers
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    if (uaData?.platform) return /mac/i.test(uaData.platform)
    if (navigator.platform) return /mac/i.test(navigator.platform)
    return /Mac/i.test(navigator.userAgent)
})()

// Primary modifier for ALL HAPI keyboard shortcuts:
//   Mac:           Cmd (⌘)
//   Windows/Linux: Alt
// Windows uses Alt (not Ctrl) so the browser's Ctrl combos stay free.
// `scrollMod` kept as alias for any callers still referencing it.
export const KBD = {
    primary:   isMac ? '⌘' : 'Alt+',
    scrollMod: isMac ? '⌘' : 'Alt+',
    alt:       isMac ? '⌥' : 'Alt+',
    shift:     isMac ? '⇧' : 'Shift+',
}

/** True if the event's modifier matches the HAPI primary modifier
 *  (Cmd on Mac, Alt on Win/Linux) and no other primary modifier is held. */
export function isPrimaryMod(e: KeyboardEvent): boolean {
    if (isMac) {
        return e.metaKey && !e.altKey && !e.ctrlKey
    }
    return e.altKey && !e.metaKey && !e.ctrlKey
}

/** Digit-focus modifier — more permissive on Win/Linux: accepts either Alt OR
 *  Ctrl (not both). Some Chrome PWA contexts on Windows steal Alt+digit at the
 *  accelerator layer; Ctrl+digit is a safe fallback that doesn't conflict in
 *  PWA standalone mode (no tab strip). */
export function isDigitFocusMod(e: KeyboardEvent): boolean {
    if (isMac) {
        return e.metaKey && !e.altKey && !e.ctrlKey
    }
    // Win/Linux: Alt+digit OR Ctrl+digit, exclusive
    const altOnly = e.altKey && !e.ctrlKey && !e.metaKey
    const ctrlOnly = e.ctrlKey && !e.altKey && !e.metaKey
    return altOnly || ctrlOnly
}

// Backwards-compat alias for earlier code that used isScrollMod.
export const isScrollMod = isPrimaryMod
