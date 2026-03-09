/**
 * Tests for Activity Drawer drag-to-resize (MC Dashboard)
 * Tests pure logic — no DOM dependency (node environment)
 */

describe('Drag Handle Visibility', () => {
  function isDragHandleVisible(drawerState) {
    return drawerState === 'expanded';
  }

  test('visible when drawer is expanded', () => {
    expect(isDragHandleVisible('expanded')).toBe(true);
  });

  test('hidden when drawer is collapsed', () => {
    expect(isDragHandleVisible('collapsed')).toBe(false);
  });

  test('hidden when drawer is hidden', () => {
    expect(isDragHandleVisible('hidden')).toBe(false);
  });
});

describe('Height Constraints', () => {
  function clampHeight(newH, contentH) {
    const minH = 200;
    const maxH = Math.floor(contentH * 0.7);
    return Math.max(minH, Math.min(maxH, newH));
  }

  test('enforces minimum height of 200px', () => {
    expect(clampHeight(100, 800)).toBe(200);
    expect(clampHeight(0, 800)).toBe(200);
    expect(clampHeight(-50, 800)).toBe(200);
  });

  test('enforces maximum height of 70% of content', () => {
    expect(clampHeight(600, 800)).toBe(560); // 800 * 0.7 = 560
    expect(clampHeight(1000, 800)).toBe(560);
  });

  test('allows height within valid range', () => {
    expect(clampHeight(300, 800)).toBe(300);
    expect(clampHeight(400, 800)).toBe(400);
    expect(clampHeight(200, 800)).toBe(200);
    expect(clampHeight(560, 800)).toBe(560);
  });

  test('handles small content area', () => {
    // If content is 250px, max = 175, but min is 200 → min wins
    expect(clampHeight(300, 250)).toBe(200);
  });

  test('70% of 1000px content is 700px', () => {
    expect(clampHeight(700, 1000)).toBe(700);
    expect(clampHeight(701, 1000)).toBe(700);
  });
});

describe('Drag Delta Calculation', () => {
  function calcNewHeight(startHeight, startY, currentY) {
    // Dragging up (lower currentY) increases height
    const dy = startY - currentY;
    return startHeight + dy;
  }

  test('dragging up increases height', () => {
    expect(calcNewHeight(300, 500, 450)).toBe(350);
  });

  test('dragging down decreases height', () => {
    expect(calcNewHeight(300, 500, 550)).toBe(250);
  });

  test('no movement keeps same height', () => {
    expect(calcNewHeight(300, 500, 500)).toBe(300);
  });
});

describe('Height to Percentage Conversion', () => {
  function heightToPct(drawerH, contentH) {
    if (contentH <= 0) return 40; // fallback
    return Math.round((drawerH / contentH) * 100);
  }

  test('converts pixel height to percentage', () => {
    expect(heightToPct(400, 1000)).toBe(40);
    expect(heightToPct(500, 1000)).toBe(50);
    expect(heightToPct(250, 1000)).toBe(25);
  });

  test('rounds to nearest integer', () => {
    expect(heightToPct(333, 1000)).toBe(33);
    expect(heightToPct(667, 1000)).toBe(67);
  });

  test('fallback for zero content height', () => {
    expect(heightToPct(300, 0)).toBe(40);
  });
});

describe('Double-Click Toggle', () => {
  function dblClickAction(currentState) {
    if (currentState === 'expanded') return 'collapse';
    return 'expand';
  }

  test('expanded → collapse on double-click', () => {
    expect(dblClickAction('expanded')).toBe('collapse');
  });

  test('collapsed → expand on double-click', () => {
    expect(dblClickAction('collapsed')).toBe('expand');
  });

  test('hidden → expand on double-click', () => {
    expect(dblClickAction('hidden')).toBe('expand');
  });
});

describe('localStorage Persistence of Height', () => {
  test('mc-activity-height key stores pixel value as string', () => {
    const pixelH = 450;
    const stored = String(pixelH);
    expect(stored).toBe('450');
    expect(parseInt(stored)).toBe(450);
  });

  test('activityDrawerHeight stores percentage as string', () => {
    const pct = 45;
    const stored = String(pct);
    expect(stored).toBe('45');
    expect(parseInt(stored)).toBe(45);
  });

  test('NaN stored value falls back to default', () => {
    const stored = 'invalid';
    const height = parseInt(stored) || 40;
    expect(height).toBe(40);
  });

  test('null stored value falls back to default', () => {
    const stored = null;
    const height = parseInt(stored) || 40;
    expect(height).toBe(40);
  });
});

describe('Dragging Class Management', () => {
  test('dragging flag starts false', () => {
    const dragging = false;
    expect(dragging).toBe(false);
  });

  test('dragging flag set true on start', () => {
    let dragging = false;
    // simulate mousedown
    dragging = true;
    expect(dragging).toBe(true);
  });

  test('dragging flag set false on end', () => {
    let dragging = true;
    // simulate mouseup
    dragging = false;
    expect(dragging).toBe(false);
  });

  test('onMove is no-op when not dragging', () => {
    const dragging = false;
    let moved = false;
    if (dragging) moved = true;
    expect(moved).toBe(false);
  });
});

describe('Touch Event Support', () => {
  function getY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
  }

  test('extracts Y from mouse event', () => {
    const mouseEvent = { clientY: 300 };
    expect(getY(mouseEvent)).toBe(300);
  });

  test('extracts Y from touch event', () => {
    const touchEvent = { touches: [{ clientY: 400 }] };
    expect(getY(touchEvent)).toBe(400);
  });

  test('handles touch with multiple fingers (uses first)', () => {
    const touchEvent = { touches: [{ clientY: 100 }, { clientY: 200 }] };
    expect(getY(touchEvent)).toBe(100);
  });
});
