import { expect, test } from '@playwright/test';

async function sceneButton(page, scene, button, touch) {
  const point = await page.evaluate(({ scene, button }) => {
    const game = window.__strategyGame;
    const bounds = game.canvas.getBoundingClientRect();
    const control = game.scene.getScene(scene)[button];
    return { x: bounds.left + control.x, y: bounds.top + control.y };
  }, { scene, button });
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function startGame(page, touch) {
  await page.goto('/juegos/strategy-game-world/');
  await page.waitForFunction(() => window.__strategyGame?.scene.isActive('Menu'));
  await sceneButton(page, 'Menu', 'playBtn', touch);
  await expect.poll(() => page.evaluate(() => window.__strategyGame.scene.getScene('Menu').view)).toBe('setup');
  await sceneButton(page, 'Menu', 'goBtn', touch);
  await page.waitForFunction(() => window.__strategyGame?.scene.isActive('World'));
}

test('landing links are usable without horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /un mundo para jugar/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Jugar Strategy Game World' })).toBeVisible();
  await page.getByRole('link', { name: /explorar juegos/i }).click();
  await expect(page.locator('.game-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('el catálogo sigue visible sin JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /un mundo para jugar/i })).toBeVisible();
  await expect(page.locator('.game-card')).toBeVisible();
  await context.close();
});

test('partidas y reinicios muestran el mundo completo sin zoom', async ({ page, isMobile }) => {
  await startGame(page, isMobile);
  const initial = await page.evaluate(() => {
    const scene = window.__strategyGame.scene.getScene('World');
    const zoomBounds = scene.zoomInBtn.getBounds();
    return { zoom: scene.zoom, x: scene.camX, y: scene.camY, canvas: getComputedStyle(window.__strategyGame.canvas).touchAction, zoomWidth: zoomBounds.width, zoomHeight: zoomBounds.height };
  });
  expect(initial).toMatchObject({ zoom: 1, x: 2048, y: 1024, canvas: 'none' });
  expect(initial.zoomWidth).toBeGreaterThanOrEqual(44);
  expect(initial.zoomHeight).toBeGreaterThanOrEqual(44);
  await sceneButton(page, 'World', 'zoomInBtn', isMobile);
  await expect.poll(() => page.evaluate(() => window.__strategyGame.scene.getScene('World').zoom)).toBeGreaterThan(1);
  await page.evaluate(() => window.__strategyGame.scene.getScene('World').scene.restart({ first: 'player', homelands: 3 }));
  await page.waitForFunction(() => window.__strategyGame.scene.isActive('World'));
  await expect.poll(() => page.evaluate(() => {
    const scene = window.__strategyGame.scene.getScene('World');
    return [scene.zoom, scene.camX, scene.camY];
  })).toEqual([1, 2048, 1024]);
});

test('si empieza la computadora el mapa también abre completo', async ({ page, isMobile }) => {
  await page.goto('/juegos/strategy-game-world/');
  await page.waitForFunction(() => window.__strategyGame?.scene.isActive('Menu'));
  await sceneButton(page, 'Menu', 'playBtn', isMobile);
  await sceneButton(page, 'Menu', 'btnCpu', isMobile);
  await sceneButton(page, 'Menu', 'goBtn', isMobile);
  await page.waitForFunction(() => window.__strategyGame?.scene.isActive('World'));
  const view = await page.evaluate(() => {
    const scene = window.__strategyGame.scene.getScene('World');
    return { zoom: scene.zoom, x: scene.camX, y: scene.camY, first: scene.firstPlayer };
  });
  expect(view).toEqual({ zoom: 1, x: 2048, y: 1024, first: 'ai' });
});

test('se puede seleccionar y conquistar un vecino', async ({ page, isMobile }) => {
  await startGame(page, isMobile);
  for (let i = 0; i < 6; i++) await sceneButton(page, 'World', 'zoomInBtn', isMobile);
  const points = await page.evaluate(() => {
    const game = window.__strategyGame;
    const scene = game.scene.getScene('World');
    const canvas = game.canvas.getBoundingClientRect();
    scene.state.current = 'player';
    scene.state.regions['068'] = { owner: 'player', armies: 7 };
    scene.state.regions['600'] = { owner: null, armies: 6 };
    scene.state.strikers = ['068'];
    scene.state.acted = [];
    const a = scene.regionCenter('068');
    const b = scene.regionCenter('600');
    scene.camX = (a[0] + b[0]) / 2;
    scene.camY = (a[1] + b[1]) / 2;
    scene.redraw();
    return ['068', '600'].map((id) => {
      const label = scene.labels.get(id).army;
      return { x: canvas.left + label.x, y: canvas.top + label.y, visible: label.visible };
    });
  });
  expect(points.every((point) => point.visible)).toBe(true);
  for (const point of points) {
    if (isMobile) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  }
  const result = await page.evaluate(() => {
    const scene = window.__strategyGame.scene.getScene('World');
    return { source: scene.state.regions['068'], target: scene.state.regions['600'], log: scene.log.text };
  });
  expect(result.source).toEqual({ owner: 'player', armies: 1 });
  expect(result.target).toEqual({ owner: 'player', armies: 1 });
  expect(result.log).toContain('Paraguay es tuyo');
});

test('un rótulo superpuesto no impide seleccionar el país visible', async ({ page, isMobile }) => {
  await startGame(page, isMobile);
  for (let i = 0; i < 6; i++) await sceneButton(page, 'World', 'zoomInBtn', isMobile);
  const points = await page.evaluate(() => {
    const game = window.__strategyGame;
    const scene = game.scene.getScene('World');
    const canvas = game.canvas.getBoundingClientRect();
    scene.state.current = 'player';
    scene.state.regions['068'] = { owner: 'player', armies: 7 };
    scene.state.regions['600'] = { owner: null, armies: 6 };
    scene.state.strikers = ['068'];
    scene.state.acted = [];
    const a = scene.regionCenter('068');
    const b = scene.regionCenter('600');
    scene.camX = (a[0] + b[0]) / 2;
    scene.camY = (a[1] + b[1]) / 2;
    scene.redraw();
    for (const label of scene.labels.values()) {
      label.name.setVisible(false);
      label.army.setVisible(false);
    }
    const findPoint = (id) => {
      const center = scene.regionCenter(id);
      const screen = scene.worldToScreen(center[0], center[1]);
      for (let radius = 0; radius <= 100; radius += 5) {
        for (let dx = -radius; dx <= radius; dx += 5) {
          for (const dy of [-radius, radius]) {
            const x = screen.x + dx;
            const y = screen.y + dy;
            if (x > 10 && x < scene.view.w - 10 && y > 115 && y < scene.view.h - 70 && scene.regionAt(x, y) === id) return { x, y };
          }
        }
      }
      throw new Error(`No visible polygon point for ${id}`);
    };
    const from = findPoint('068');
    const to = findPoint('600');
    const overlappingLabel = scene.labels.get('032').army;
    overlappingLabel.setText('999').setPosition(to.x, to.y).setVisible(true);
    return {
      from: { x: canvas.left + from.x, y: canvas.top + from.y },
      to: { x: canvas.left + to.x, y: canvas.top + to.y },
      targetUnderLabel: scene.regionAt(to.x, to.y),
    };
  });
  expect(points.targetUnderLabel).toBe('600');
  for (const point of [points.from, points.to]) {
    if (isMobile) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  }
  await expect.poll(() => page.evaluate(() => window.__strategyGame.scene.getScene('World').state.regions['600'])).toEqual({ owner: 'player', armies: 1 });
});

test('Mongolia puede atacar Rusia desde el mapa', async ({ page, isMobile }) => {
  await startGame(page, isMobile);
  for (let i = 0; i < 6; i++) await sceneButton(page, 'World', 'zoomInBtn', isMobile);
  const points = await page.evaluate(() => {
    const game = window.__strategyGame;
    const scene = game.scene.getScene('World');
    const canvas = game.canvas.getBoundingClientRect();
    const worldPoint = (lon, lat) => [((lon + 180) / 360) * 4096, ((90 - lat) / 180) * 2048];
    const mongolia = worldPoint(106, 49);
    const russia = worldPoint(106, 52.5);
    scene.camX = (mongolia[0] + russia[0]) / 2;
    scene.camY = (mongolia[1] + russia[1]) / 2;
    scene.state.current = 'player';
    scene.state.regions['496'] = { owner: 'player', armies: 7 };
    scene.state.regions['643'] = { owner: null, armies: 6 };
    scene.state.strikers = ['496'];
    scene.state.acted = [];
    scene.redraw();
    return [mongolia, russia].map(([x, y]) => {
      const screen = scene.worldToScreen(x, y);
      return { x: canvas.left + screen.x, y: canvas.top + screen.y, id: scene.regionAt(screen.x, screen.y) };
    });
  });
  expect(points.map((point) => point.id)).toEqual(['496', '643']);
  for (const point of points) {
    if (isMobile) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  }
  await expect.poll(() => page.evaluate(() => window.__strategyGame.scene.getScene('World').state.regions['643'])).toEqual({ owner: 'player', armies: 1 });
});

test('los controles táctiles desplazan el mapa ampliado', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'El gesto se prueba con entrada táctil real.');
  await startGame(page, true);
  await sceneButton(page, 'World', 'zoomInBtn', true);
  await sceneButton(page, 'World', 'zoomInBtn', true);
  const before = await page.evaluate(() => {
    const game = window.__strategyGame;
    const scene = game.scene.getScene('World');
    const rect = game.canvas.getBoundingClientRect();
    return { x: scene.camX, y: scene.camY, startX: rect.left + rect.width / 2, startY: rect.top + rect.height / 2 };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.startX, y: before.startY }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: before.startX + 70, y: before.startY + 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.__strategyGame.scene.getScene('World').camX)).not.toBe(before.x);
  await cdp.detach();
});
