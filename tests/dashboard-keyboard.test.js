/**
 * Tests for MC Dashboard keyboard shortcut logic
 *
 * Tests the handleKeyboardShortcut function and related helpers
 * using a minimal DOM mock (no jsdom dependency required).
 */

// ─── Minimal DOM Mock ───────────────────────────────────

function createMockElement(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    style: { display: '' },
    className: '',
    dataset: { ...attrs.dataset },
    classList: {
      _classes: new Set((attrs.className || '').split(' ').filter(Boolean)),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    children: [],
    parentNode: null,
    focus: jest.fn(),
    blur: jest.fn(function() { if (mockDoc._activeElement === el) mockDoc._activeElement = mockDoc.body; }),
    remove: jest.fn(function() { el.parentNode = null; }),
    scrollIntoView: jest.fn(),
    addEventListener: jest.fn(),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => []),
  };
  if (attrs.style) Object.assign(el.style, attrs.style);
  return el;
}

// Elements the shortcut handler interacts with
const sidebarSearch = createMockElement('input');
const shortcutOverlay = createMockElement('div', { style: { display: 'none' } });
const missionList = createMockElement('div');

const mockBody = createMockElement('body');
mockBody.appendChild = jest.fn();

const mockDoc = {
  _activeElement: mockBody,
  get activeElement() { return this._activeElement; },
  set activeElement(el) { this._activeElement = el; },
  body: mockBody,
  getElementById: jest.fn((id) => {
    const map = {
      'sidebar-search': sidebarSearch,
      'shortcut-overlay': shortcutOverlay,
      'mission-list': missionList,
    };
    return map[id] || null;
  }),
  querySelector: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
  addEventListener: jest.fn(),
  createElement: jest.fn(() => createMockElement('div')),
};

// ─── State & Functions Under Test ───────────────────────

// Replicate the state object
const state = {
  sidebarIndex: -1,
  plans: [],
  currentPlanId: null,
  workerPanelOpen: false,
  workers: [],
};

// Stubs for action functions
const selectPlan = jest.fn();
const executeCurrentPlan = jest.fn();
const showNewMissionModal = jest.fn();
const toggleWorkerPanel = jest.fn();

// ─── Functions under test (copied from app.js) ─────────

function toggleShortcutHelp() {
  const overlay = mockDoc.getElementById('shortcut-overlay');
  if (!overlay) return;
  overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
}

function hideShortcutHelp() {
  const overlay = mockDoc.getElementById('shortcut-overlay');
  if (overlay) overlay.style.display = 'none';
}

function updateSidebarHighlight() {
  // In real code this queries DOM; here we just verify state
  const items = missionItems;
  items.forEach(el => el.classList.remove('keyboard-active'));
  if (state.sidebarIndex < 0) return;
  if (items[state.sidebarIndex]) {
    items[state.sidebarIndex].classList.add('keyboard-active');
    items[state.sidebarIndex].scrollIntoView({ block: 'nearest' });
  }
}

function handleKeyboardShortcut(e) {
  const tag = mockDoc.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const shortcutOvl = mockDoc.getElementById('shortcut-overlay');
  const shortcutVisible = shortcutOvl && shortcutOvl.style.display !== 'none';

  if (e.key === 'Escape') {
    if (shortcutVisible) { hideShortcutHelp(); return; }
    const modal = mockDoc.querySelector('.modal-overlay');
    if (modal) { modal.remove(); mockDoc.querySelector = jest.fn(() => null); return; }
    if (isTyping) { mockDoc.activeElement.blur(); return; }
    return;
  }

  if (e.key === '?' && !isTyping) { toggleShortcutHelp(); return; }

  if (isTyping) return;
  if (mockDoc.querySelector('.modal-overlay')) return;
  if (shortcutVisible) return;

  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
    const search = mockDoc.getElementById('sidebar-search');
    if (search) { search.focus(); mockDoc._activeElement = search; }
    return;
  }

  if (e.key === '/') {
    const search = mockDoc.getElementById('sidebar-search');
    if (search) { search.focus(); mockDoc._activeElement = search; }
    return;
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const items = missionItems;
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      state.sidebarIndex = state.sidebarIndex < items.length - 1 ? state.sidebarIndex + 1 : 0;
    } else {
      state.sidebarIndex = state.sidebarIndex > 0 ? state.sidebarIndex - 1 : items.length - 1;
    }
    updateSidebarHighlight();
    return;
  }

  if (e.key === 'Enter') {
    const items = missionItems;
    if (state.sidebarIndex >= 0 && items[state.sidebarIndex]) {
      const id = items[state.sidebarIndex].dataset.id;
      if (id) selectPlan(id);
    }
    return;
  }

  if (e.key === 'e' || e.key === 'E') { executeCurrentPlan(); return; }
  if (e.key === 'n' || e.key === 'N') { showNewMissionModal(); return; }
  if (e.key === 'w' || e.key === 'W') { toggleWorkerPanel(); return; }
}

// ─── Helpers ────────────────────────────────────────────

let missionItems = [];

function addMissionItems(count) {
  missionItems = [];
  for (let i = 0; i < count; i++) {
    missionItems.push(createMockElement('div', { className: 'mission-item', dataset: { id: `plan-${i}` } }));
  }
}

function makeKeyEvent(key, opts = {}) {
  return { key, ctrlKey: false, metaKey: false, ...opts };
}

// ─── Tests ──────────────────────────────────────────────

describe('Dashboard Keyboard Shortcuts', () => {

  beforeEach(() => {
    // Reset state
    state.sidebarIndex = -1;
    missionItems = [];
    mockDoc._activeElement = mockBody;
    shortcutOverlay.style.display = 'none';
    mockDoc.querySelector = jest.fn(() => null);
    jest.clearAllMocks();
  });

  // ─── Shortcut Help Overlay ────────────────────────────

  describe('shortcut help overlay (?)', () => {
    it('should show overlay when ? is pressed', () => {
      expect(shortcutOverlay.style.display).toBe('none');
      handleKeyboardShortcut(makeKeyEvent('?'));
      expect(shortcutOverlay.style.display).toBe('flex');
    });

    it('should hide overlay when ? is pressed again (toggle)', () => {
      handleKeyboardShortcut(makeKeyEvent('?'));
      expect(shortcutOverlay.style.display).toBe('flex');
      handleKeyboardShortcut(makeKeyEvent('?'));
      expect(shortcutOverlay.style.display).toBe('none');
    });

    it('should hide overlay on Escape', () => {
      handleKeyboardShortcut(makeKeyEvent('?'));
      expect(shortcutOverlay.style.display).toBe('flex');
      handleKeyboardShortcut(makeKeyEvent('Escape'));
      expect(shortcutOverlay.style.display).toBe('none');
    });
  });

  // ─── Search Focus ────────────────────────────────────

  describe('search focus (/ and Ctrl+K)', () => {
    it('should focus sidebar search on /', () => {
      handleKeyboardShortcut(makeKeyEvent('/'));
      expect(sidebarSearch.focus).toHaveBeenCalled();
    });

    it('should focus sidebar search on Ctrl+K', () => {
      handleKeyboardShortcut(makeKeyEvent('k', { ctrlKey: true }));
      expect(sidebarSearch.focus).toHaveBeenCalled();
    });
  });

  // ─── Action Shortcuts ────────────────────────────────

  describe('action shortcuts (E, N, W)', () => {
    it('E should call executeCurrentPlan', () => {
      handleKeyboardShortcut(makeKeyEvent('e'));
      expect(executeCurrentPlan).toHaveBeenCalled();
    });

    it('N should call showNewMissionModal', () => {
      handleKeyboardShortcut(makeKeyEvent('n'));
      expect(showNewMissionModal).toHaveBeenCalled();
    });

    it('W should call toggleWorkerPanel', () => {
      handleKeyboardShortcut(makeKeyEvent('w'));
      expect(toggleWorkerPanel).toHaveBeenCalled();
    });

    it('uppercase E should also work', () => {
      handleKeyboardShortcut(makeKeyEvent('E'));
      expect(executeCurrentPlan).toHaveBeenCalled();
    });
  });

  // ─── Sidebar Navigation ──────────────────────────────

  describe('sidebar navigation (↑/↓)', () => {
    it('ArrowDown should increment sidebarIndex from -1 to 0', () => {
      addMissionItems(3);
      expect(state.sidebarIndex).toBe(-1);
      handleKeyboardShortcut(makeKeyEvent('ArrowDown'));
      expect(state.sidebarIndex).toBe(0);
    });

    it('ArrowDown should increment sequentially', () => {
      addMissionItems(3);
      handleKeyboardShortcut(makeKeyEvent('ArrowDown'));
      handleKeyboardShortcut(makeKeyEvent('ArrowDown'));
      expect(state.sidebarIndex).toBe(1);
    });

    it('ArrowUp should wrap from 0 to last item', () => {
      addMissionItems(3);
      state.sidebarIndex = 0;
      handleKeyboardShortcut(makeKeyEvent('ArrowUp'));
      expect(state.sidebarIndex).toBe(2);
    });

    it('ArrowDown should wrap from last to first', () => {
      addMissionItems(3);
      state.sidebarIndex = 2;
      handleKeyboardShortcut(makeKeyEvent('ArrowDown'));
      expect(state.sidebarIndex).toBe(0);
    });

    it('Enter should call selectPlan with highlighted item id', () => {
      addMissionItems(3);
      state.sidebarIndex = 1;
      handleKeyboardShortcut(makeKeyEvent('Enter'));
      expect(selectPlan).toHaveBeenCalledWith('plan-1');
    });

    it('Enter should not call selectPlan when sidebarIndex is -1', () => {
      addMissionItems(3);
      handleKeyboardShortcut(makeKeyEvent('Enter'));
      expect(selectPlan).not.toHaveBeenCalled();
    });

    it('should add keyboard-active class to highlighted item', () => {
      addMissionItems(3);
      state.sidebarIndex = 1;
      updateSidebarHighlight();
      expect(missionItems[1].classList.contains('keyboard-active')).toBe(true);
      expect(missionItems[0].classList.contains('keyboard-active')).toBe(false);
      expect(missionItems[2].classList.contains('keyboard-active')).toBe(false);
    });

    it('ArrowDown with empty list should not crash', () => {
      missionItems = [];
      expect(() => handleKeyboardShortcut(makeKeyEvent('ArrowDown'))).not.toThrow();
      expect(state.sidebarIndex).toBe(-1);
    });
  });

  // ─── Guard Rails ─────────────────────────────────────

  describe('guard rails — disabled when typing', () => {
    it('should NOT trigger shortcuts when INPUT is focused', () => {
      mockDoc._activeElement = createMockElement('input');
      handleKeyboardShortcut(makeKeyEvent('e'));
      expect(executeCurrentPlan).not.toHaveBeenCalled();
    });

    it('should NOT trigger shortcuts when TEXTAREA is focused', () => {
      mockDoc._activeElement = createMockElement('textarea');
      handleKeyboardShortcut(makeKeyEvent('n'));
      expect(showNewMissionModal).not.toHaveBeenCalled();
    });

    it('should NOT trigger shortcuts when SELECT is focused', () => {
      mockDoc._activeElement = createMockElement('select');
      handleKeyboardShortcut(makeKeyEvent('w'));
      expect(toggleWorkerPanel).not.toHaveBeenCalled();
    });

    it('Escape should blur focused input', () => {
      const input = createMockElement('input');
      mockDoc._activeElement = input;
      handleKeyboardShortcut(makeKeyEvent('Escape'));
      expect(input.blur).toHaveBeenCalled();
    });
  });

  describe('guard rails — disabled when modal is open', () => {
    it('should NOT trigger shortcuts when modal-overlay exists', () => {
      const modalOverlay = createMockElement('div', { className: 'modal-overlay' });
      mockDoc.querySelector = jest.fn((sel) => sel === '.modal-overlay' ? modalOverlay : null);
      handleKeyboardShortcut(makeKeyEvent('e'));
      expect(executeCurrentPlan).not.toHaveBeenCalled();
    });

    it('Escape should remove modal-overlay', () => {
      const modalOverlay = createMockElement('div', { className: 'modal-overlay' });
      modalOverlay.parentNode = mockBody;
      mockDoc.querySelector = jest.fn((sel) => sel === '.modal-overlay' ? modalOverlay : null);
      handleKeyboardShortcut(makeKeyEvent('Escape'));
      expect(modalOverlay.remove).toHaveBeenCalled();
    });
  });

  describe('guard rails — disabled when shortcut overlay is visible', () => {
    it('should NOT trigger action shortcuts when overlay is shown', () => {
      shortcutOverlay.style.display = 'flex';
      handleKeyboardShortcut(makeKeyEvent('e'));
      expect(executeCurrentPlan).not.toHaveBeenCalled();
    });
  });

  // ─── State Defaults ──────────────────────────────────

  describe('state defaults', () => {
    it('sidebarIndex should default to -1', () => {
      expect(state.sidebarIndex).toBe(-1);
    });
  });
});
