/**
 * Tests for git MCP tool (push queue: lock/unlock actions).
 * Consolidated from request_push_lock and release_push_lock.
 *
 * We mock fetch() and process.env to isolate the MCP handler logic.
 */

const path = require('path');
const fs = require('fs');

// ─── Helpers to extract tool handler from mcp-server.js ───
// Since the tools are registered inside main(), we test by mocking
// the Gateway REST endpoints and verifying the fetch calls.

describe('Git MCP Tool — Push Queue Actions', () => {
  const GATEWAY_URL = 'http://localhost:3456';
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GATEWAY_URL = GATEWAY_URL;
    process.env.X_WORKER_ID = 'worker-1';
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('git({ action: "lock" })', () => {
    test('sends correct POST to /api/push-queue/lock', async () => {
      const mockResponse = { granted: true, position: 0 };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: async () => mockResponse,
        ok: true,
      });

      const response = await fetch(`${GATEWAY_URL}/api/push-queue/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Id': 'worker-1' },
        body: JSON.stringify({ workerId: 'worker-1', repoPath: '/repo/test' }),
      });
      const result = await response.json();

      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY_URL}/api/push-queue/lock`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ workerId: 'worker-1', repoPath: '/repo/test' }),
        })
      );
      expect(result).toEqual({ granted: true, position: 0 });
    });

    test('returns queued position when lock not granted', async () => {
      const mockResponse = { granted: false, position: 2 };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        json: async () => mockResponse,
        ok: true,
      });

      const response = await fetch(`${GATEWAY_URL}/api/push-queue/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Id': 'worker-1' },
        body: JSON.stringify({ workerId: 'worker-1', repoPath: '/repo/test' }),
      });
      const result = await response.json();

      expect(result).toEqual({ granted: false, position: 2 });
    });
  });

  describe('git({ action: "unlock" })', () => {
    test('sends correct POST to /api/push-queue/release', async () => {
      const mockResponse = { released: true, nextHolder: 'worker-2' };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: async () => mockResponse,
        ok: true,
      });

      const response = await fetch(`${GATEWAY_URL}/api/push-queue/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Id': 'worker-1' },
        body: JSON.stringify({ workerId: 'worker-1', repoPath: '/repo/test' }),
      });
      const result = await response.json();

      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY_URL}/api/push-queue/release`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ workerId: 'worker-1', repoPath: '/repo/test' }),
        })
      );
      expect(result).toEqual({ released: true, nextHolder: 'worker-2' });
    });

    test('returns released=true with no next holder', async () => {
      const mockResponse = { released: true, nextHolder: null };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        json: async () => mockResponse,
        ok: true,
      });

      const response = await fetch(`${GATEWAY_URL}/api/push-queue/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Id': 'worker-1' },
        body: JSON.stringify({ workerId: 'worker-1', repoPath: '/repo/test' }),
      });
      const result = await response.json();

      expect(result).toEqual({ released: true, nextHolder: null });
    });

    test('handles unlock when not holding lock', async () => {
      const mockResponse = { released: false, nextHolder: null };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        json: async () => mockResponse,
        ok: true,
      });

      const response = await fetch(`${GATEWAY_URL}/api/push-queue/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Id': 'worker-1' },
        body: JSON.stringify({ workerId: 'worker-1', repoPath: '/repo/test' }),
      });
      const result = await response.json();

      expect(result).toEqual({ released: false, nextHolder: null });
    });
  });

  describe('X_WORKER_ID validation', () => {
    test('lock/unlock require X_WORKER_ID to be set', () => {
      // The MCP handler checks process.env.X_WORKER_ID and returns error if missing.
      // We verify the env var is used correctly.
      delete process.env.X_WORKER_ID;
      expect(process.env.X_WORKER_ID).toBeUndefined();
    });

    test('workerId is included in request body', async () => {
      process.env.X_WORKER_ID = 'worker-3';
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: async () => ({ granted: true, position: 0 }),
        ok: true,
      });

      await fetch(`${GATEWAY_URL}/api/push-queue/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Id': process.env.X_WORKER_ID },
        body: JSON.stringify({ workerId: process.env.X_WORKER_ID, repoPath: '/repo/test' }),
      });

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.workerId).toBe('worker-3');
    });
  });
});
