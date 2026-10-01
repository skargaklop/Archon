import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ─── Mock SessionManager before import ─────────────────────────────────────

const mockCreate = mock((_cwd: string) => ({ __kind: 'created' }));
const mockInMemory = mock((_cwd: string) => ({ __kind: 'in-memory' }));
const mockOpen = mock((_path: string) => ({ __kind: 'opened' }));
const mockForkFrom = mock(async (_path: string, _cwd: string) => ({ __kind: 'forked' }));
const mockList = mock(async (_cwd: string) => [] as { id: string; path: string; cwd: string }[]);

mock.module('@earendil-works/pi-coding-agent', () => ({
  SessionManager: {
    create: mockCreate,
    inMemory: mockInMemory,
    open: mockOpen,
    forkFrom: mockForkFrom,
    list: mockList,
  },
}));

import { resolvePiSession } from './session-resolver';

describe('resolvePiSession', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockInMemory.mockClear();
    mockOpen.mockClear();
    mockForkFrom.mockClear();
    mockList.mockClear();
    mockList.mockImplementation(async () => []);
  });

  test('no resumeSessionId → create fresh session', async () => {
    await resolvePiSession('/tmp/proj', undefined);
    expect(mockCreate).toHaveBeenCalledWith('/tmp/proj');
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  test('persistSession=false → create in-memory session like pi --no-session', async () => {
    await resolvePiSession('/tmp/proj', undefined, false, false);
    expect(mockInMemory).toHaveBeenCalledWith('/tmp/proj');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  test('resume id matches existing session → open by path', async () => {
    mockList.mockImplementationOnce(async () => [
      { id: 'abc-123', path: '/sessions/abc-123.jsonl', cwd: '/tmp/proj' },
      { id: 'def-456', path: '/sessions/def-456.jsonl', cwd: '/tmp/proj' },
    ]);

    await resolvePiSession('/tmp/proj', 'def-456');
    expect(mockOpen).toHaveBeenCalledWith('/sessions/def-456.jsonl');
    expect(mockForkFrom).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('fork request matches existing session → fork by path without opening source', async () => {
    mockList.mockImplementationOnce(async () => [
      { id: 'abc-123', path: '/sessions/abc-123.jsonl', cwd: '/tmp/proj' },
    ]);

    await resolvePiSession('/tmp/proj', 'abc-123', true);
    expect(mockForkFrom).toHaveBeenCalledWith('/sessions/abc-123.jsonl', '/tmp/proj');
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('resume id not found → fails closed without creating a fresh session', async () => {
    mockList.mockImplementationOnce(async () => [
      { id: 'abc-123', path: '/sessions/abc-123.jsonl', cwd: '/tmp/proj' },
    ]);

    await expect(resolvePiSession('/tmp/proj', 'missing-id', true)).rejects.toThrow(
      /Pi session continuity blocked.*missing-id/
    );
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockForkFrom).not.toHaveBeenCalled();
  });

  test('list() throws ENOENT while resuming → fails closed', async () => {
    mockList.mockImplementationOnce(async () => {
      throw Object.assign(new Error('no such directory'), { code: 'ENOENT' });
    });

    await expect(resolvePiSession('/tmp/proj', 'some-id')).rejects.toThrow(
      /Pi session continuity blocked.*some-id/
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('list() throws ENOTDIR while resuming → fails closed', async () => {
    mockList.mockImplementationOnce(async () => {
      throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    });

    await expect(resolvePiSession('/tmp/proj', 'some-id')).rejects.toThrow(
      /Pi session continuity blocked.*some-id/
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('list() throws unexpected error → propagates (no silent fallback)', async () => {
    // Permission errors, parse failures, etc. must NOT be swallowed as
    // "no resume" — that would paper over real config/filesystem problems.
    mockList.mockImplementationOnce(async () => {
      const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw err;
    });

    await expect(resolvePiSession('/tmp/proj', 'some-id')).rejects.toThrow(/permission denied/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('list() throws plain Error → propagates (no code = not ENOENT)', async () => {
    mockList.mockImplementationOnce(async () => {
      throw new Error('some other failure');
    });

    await expect(resolvePiSession('/tmp/proj', 'some-id')).rejects.toThrow(/some other failure/);
  });

  test('empty resumeSessionId string → fresh session (no resume attempted)', async () => {
    // Treated as "no resume requested" by the truthy check in the resolver.
    await resolvePiSession('/tmp/proj', '');
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });
});
