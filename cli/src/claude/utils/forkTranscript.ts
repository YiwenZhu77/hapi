import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { getProjectPath } from './path';

/**
 * Fork a Claude transcript so a branched session can resume the full parent
 * history WITHOUT corrupting the parent's own transcript.
 *
 * `claude --resume <id>` reads `<id>.jsonl` and continues appending to it. If we
 * resumed the parent's own session id, the branched process and any live parent
 * process would both write to one file. To isolate them we:
 *   1. Copy the parent JSONL to a freshly-minted uuid file.
 *   2. Rewrite the `sessionId` field on every line to that new uuid, so Claude
 *      keys the resumed conversation to the copy regardless of whether it trusts
 *      the filename or the embedded id.
 *
 * The parent file is never opened for writing and never passed to `--resume`, so
 * it is structurally protected.
 *
 * Returns the new uuid to resume, or null if the parent transcript does not
 * exist (caller should fall back to a fresh, no-history session).
 */
export async function forkClaudeTranscript(
    workingDirectory: string,
    parentClaudeSessionId: string
): Promise<string | null> {
    const projectDir = getProjectPath(workingDirectory);
    const src = join(projectDir, `${parentClaudeSessionId}.jsonl`);

    let raw: string;
    try {
        raw = await fs.readFile(src, 'utf8');
    } catch {
        return null;
    }

    const forkId = randomUUID();
    const dst = join(projectDir, `${forkId}.jsonl`);

    const rewritten = raw
        .split('\n')
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            try {
                const obj = JSON.parse(trimmed);
                if (obj && typeof obj === 'object' && 'sessionId' in obj) {
                    obj.sessionId = forkId;
                    return JSON.stringify(obj);
                }
                return line;
            } catch {
                // Non-JSON or malformed line: copy verbatim.
                return line;
            }
        })
        .join('\n');

    await fs.writeFile(dst, rewritten, 'utf8');
    return forkId;
}
