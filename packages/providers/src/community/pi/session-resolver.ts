import { SessionManager } from '@earendil-works/pi-coding-agent';

/**
 * Result of resolving an Archon `resumeSessionId` against Pi's session store.
 */
export interface ResolvedSession {
  /** SessionManager to hand to createAgentSession. */
  sessionManager: SessionManager;
}

/**
 * Resolve a Pi `SessionManager` for a sendQuery call.
 *
 * Behavior:
 *  - No resumeSessionId + persistSession=true → fresh `SessionManager.create(cwd)`.
 *  - No resumeSessionId + persistSession=false → `SessionManager.inMemory(cwd)` (CLI `--no-session` parity).
 *  - resumeSessionId matches a session file for this cwd → `SessionManager.open(path)`.
 *  - resumeSessionId matches and forkSession is true → `SessionManager.forkFrom(path, cwd)`.
 *  - resumeSessionId provided but not found → error; never erase continuity.
 *
 * Pi stores sessions as JSONL files under `~/.pi/agent/sessions/<encoded-cwd>/`
 * (or `$PI_CODING_AGENT_DIR/sessions/...`). This mirrors Claude's
 * `~/.claude/projects/` and Codex's thread store — the provider owns
 * session persistence; Archon just holds the opaque UUID.
 *
 * Lookup uses `SessionManager.list(cwd)` which scans only this cwd's
 * sessions. Cross-cwd resume (e.g. worktree switch) is deliberately not
 * supported: a workflow moved to a different directory fails closed rather
 * than silently losing the packet's context.
 */
export async function resolvePiSession(
  cwd: string,
  resumeSessionId: string | undefined,
  forkSession = false,
  persistSession = true
): Promise<ResolvedSession> {
  if (!resumeSessionId) {
    return {
      sessionManager: persistSession ? SessionManager.create(cwd) : SessionManager.inMemory(cwd),
    };
  }

  try {
    const sessions = await SessionManager.list(cwd);
    const match = sessions.find(s => s.id === resumeSessionId);
    if (match) {
      return {
        sessionManager: forkSession
          ? SessionManager.forkFrom(match.path, cwd)
          : SessionManager.open(match.path),
      };
    }
  } catch (err: unknown) {
    // Missing directory and missing ID both block exact continuity. Other errors
    // retain their original diagnostics instead of being disguised as absence.
    if (!isMissingSessionDirError(err)) throw err;
  }

  throw new Error(
    `Pi session continuity blocked: exact session '${resumeSessionId}' is unavailable for this working directory`
  );
}

function isMissingSessionDirError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
