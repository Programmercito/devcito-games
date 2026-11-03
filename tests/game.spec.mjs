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
