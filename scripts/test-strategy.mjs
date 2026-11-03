import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-50m.json');
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const worldUrl = moduleUrl(await compile('../src/lib/games/strategy-game-world/data/world.ts'));
const rulesCode = (await compile('../src/lib/games/strategy-game-world/core/rules.ts'))
  .replace("'../data/world'", JSON.stringify(worldUrl));
const rulesUrl = moduleUrl(rulesCode);
const world = await import(worldUrl);
const rules = await import(rulesUrl);
const aiCode = (await compile('../src/lib/games/strategy-game-world/core/ai.ts'))
  .replace("'../data/world'", JSON.stringify(worldUrl))
  .replace("'./rules'", JSON.stringify(rulesUrl));
const ai = await import(moduleUrl(aiCode));

{
  const { REGIONS, ADJACENCY, regionById } = world;

  assert.ok(regionById.has('496') && regionById.has('643'));
  assert.ok(rules.isAdjacent('496', '643') && rules.isAdjacent('643', '496'));
  for (const region of REGIONS) {
    assert.ok(region.area >= 45_000, `${region.name} is too small to play`);
    for (const ring of region.rings) for (let i = 0; i < ring.length; i++) {
      const [x, y] = ring[i];
      assert.ok(x >= 0 && x <= world.WORLD_WIDTH && y >= 0 && y <= world.WORLD_HEIGHT, `${region.name} lies outside the map`);
      assert.ok(Math.abs(x - ring[(i + 1) % ring.length][0]) <= world.WORLD_WIDTH / 2, `${region.name} crosses the map seam`);
    }
    assert.ok(ADJACENCY[region.id].length >= 1, `${region.name} has no route out`);
    for (const neighbor of ADJACENCY[region.id]) {
      assert.ok(regionById.has(neighbor), `${region.name} links to a removed region`);
      assert.ok(ADJACENCY[neighbor].includes(region.id), `${region.name} has a one-way route`);
    }
  }

  const visited = new Set([REGIONS[0].id]);
  const queue = [...visited];
  for (const id of queue) {
    for (const neighbor of ADJACENCY[id]) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  assert.equal(visited.size, REGIONS.length, 'all regions must be reachable');

  const arcs = new Map();
  const sourceToRegion = new Map(REGIONS.flatMap((region) => region.sourceIds.map((id) => [id, region.id])));
  for (const geometry of topo.objects.countries.geometries) {
    const id = String(geometry.id ?? `X:${geometry.properties.name}`);
    const regionId = sourceToRegion.get(id);
    if (!regionId) continue;
    for (const arc of geometry.arcs.flat(Infinity)) {
      const key = arc < 0 ? ~arc : arc;
      const countries = arcs.get(key) ?? new Set();
      countries.add(regionId);
      arcs.set(key, countries);
    }
  }
  const vertices = new Map(REGIONS.map((region) => [region.id, new Set(region.rings.flatMap((ring) => ring.map((point) => point.join(','))))]));
  const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const edges = new Map(REGIONS.map((region) => [region.id, new Set(region.rings.flatMap((ring) =>
    ring.map((point, i) => edgeKey(point.join(','), ring[(i + 1) % ring.length].join(','))),
  ))]));
  let sharedSegments = 0;
  for (const [arcIndex, countries] of arcs) {
    for (const a of countries) for (const b of countries) {
      if (a !== b) assert.ok(rules.isAdjacent(a, b), `missing land border ${a}–${b}`);
    }
    const [a, b] = [...countries];
    if (countries.size !== 2) continue;
    let x = 0, y = 0, previous = null;
    for (const [dx, dy] of topo.arcs[arcIndex]) {
      x += dx;
      y += dy;
      const lon = x * topo.transform.scale[0] + topo.transform.translate[0];
      const lat = y * topo.transform.scale[1] + topo.transform.translate[1];
      const point = [
        +(((lon + 180) / 360) * world.WORLD_WIDTH).toFixed(1),
        +(((90 - lat) / 180) * world.WORLD_HEIGHT).toFixed(1),
      ].join(',');
      if (previous && point !== previous &&
        vertices.get(a).has(previous) && vertices.get(a).has(point) &&
        vertices.get(b).has(previous) && vertices.get(b).has(point)) {
        const edge = edgeKey(previous, point);
        assert.ok(edges.get(a).has(edge) && edges.get(b).has(edge), `mismatched visible border ${a}–${b}`);
        sharedSegments++;
      }
      previous = point;
    }
  }
  assert.ok(sharedSegments > 10_000, 'shared visible borders must retain matching geometry');

  const random = Math.random;
  try {
    for (const area of [0, 80_000, 500_000, 2_500_000, 17_000_000]) {
      Math.random = () => 0;
      const low = rules.initialGarrisonForArea(area);
      Math.random = () => 0.999999;
      const high = rules.initialGarrisonForArea(area);
      const base = rules.garrisonForArea(area);
      const variation = Math.max(1, Math.ceil(base * 0.3));
      assert.equal(low, Math.max(2, base - variation));
      assert.equal(high, base + variation);
      assert.ok(high > low, `initial troops must vary for ${area}`);
      const outcomes = new Set();
      for (let i = 0; i < high - low + 1; i++) {
        Math.random = () => (i + 0.5) / (high - low + 1);
        outcomes.add(rules.initialGarrisonForArea(area));
      }
      assert.deepEqual([...outcomes], Array.from({ length: high - low + 1 }, (_, i) => low + i));
    }
  } finally {
    Math.random = random;
  }
  assert.ok(rules.initialGarrisonForArea(17_000_000) > rules.initialGarrisonForArea(80_000));

  try {
    for (let i = 0; i < REGIONS.length; i++) {
      Math.random = () => (i + 0.5) / REGIONS.length;
      assert.equal(rules.pickHomelands(1).player[0], REGIONS[i].id, `${REGIONS[i].name} must be eligible`);

      const firstIndex = (i + 1) % REGIONS.length;
      const targetIndex = i === REGIONS.length - 1 ? 0 : i;
      const rolls = [(firstIndex + 0.5) / REGIONS.length, (targetIndex + 0.5) / (REGIONS.length - 1)];
      Math.random = () => rolls.shift();
      assert.equal(rules.pickHomelands(1).ai[0], REGIONS[i].id, `${REGIONS[i].name} must be eligible for the AI`);
    }
    const drawsFor = (ids) => {
      const pool = REGIONS.map((r) => r.id);
      let next = 0;
      return () => {
        const index = pool.indexOf(ids[next++]);
        assert.ok(index >= 0);
        const roll = (index + 0.5) / pool.length;
        [pool[index], pool[pool.length - 1]] = [pool[pool.length - 1], pool[index]];
        pool.pop();
        return roll;
      };
    };
    Math.random = drawsFor(['068', '600']);
    assert.deepEqual(rules.pickHomelands(1), { player: ['068'], ai: ['600'] });
    Math.random = drawsFor(['068', '600', '032', '076']);
    assert.deepEqual(rules.pickHomelands(2), { player: ['068', '600'], ai: ['032', '076'] });
    for (const invalid of [0, -1, 1.5, REGIONS.length]) {
      assert.throws(() => rules.pickHomelands(invalid), RangeError);
    }
  } finally {
    Math.random = random;
  }

  for (const first of ['player', 'ai']) for (const count of [1, 3, 5]) {
    const state = rules.createGame(first, count);
    assert.equal(state.initialHomelands.player.length, count);
    assert.equal(state.initialHomelands.ai.length, count);
    assert.equal(new Set([...state.initialHomelands.player, ...state.initialHomelands.ai]).size, count * 2);
    assert.deepEqual(state.strikers, state.initialHomelands[first]);
  }

  try {
    for (const first of ['player', 'ai']) for (const roll of [0, 0.999999]) {
      Math.random = () => roll;
      const game = rules.createGame(first, 3);
      for (const region of REGIONS) {
        assert.equal(game.regions[region.id].armies, rules.initialGarrisonForArea(region.area), `initial garrison for ${region.name}`);
      }
      const initial = Object.fromEntries(REGIONS.map((region) => [region.id, game.regions[region.id].armies]));
      assert.deepEqual(rules.endTurn(game), { income: 0, places: [] });
      assert.equal(game.turn, 1);
      for (const region of REGIONS) assert.equal(game.regions[region.id].armies, initial[region.id]);

      const firstIncome = rules.endTurn(game);
      assert.equal(game.current, first);
      assert.ok(firstIncome.income > 0);
      assert.equal(rules.totalArmies(game, first), game.initialHomelands[first].reduce((sum, id) => sum + initial[id], 0) + firstIncome.income);
      const second = first === 'player' ? 'ai' : 'player';
      const secondIncome = rules.endTurn(game);
      assert.equal(game.current, second);
      assert.ok(secondIncome.income > 0);
      assert.equal(rules.totalArmies(game, second), game.initialHomelands[second].reduce((sum, id) => sum + initial[id], 0) + secondIncome.income);
    }
  } finally {
    Math.random = random;
  }

  const state = rules.createGame('player', 1);
  state.regions['496'] = { owner: 'player', armies: 3 };
  state.regions['643'] = { owner: null, armies: 5 };
  state.strikers = ['496'];
  assert.ok(rules.canAttack(state, '496', '643'), 'a losing border attack must remain available');
  assert.equal(rules.previewAttack(state, '496', '643').willCapture, false);
  state.regions['496'].armies = 8;
  assert.equal(rules.previewAttack(state, '496', '643').willCapture, true);

  for (const side of ['player', 'ai']) {
    const battle = rules.createGame(side, 1);
    for (const region of REGIONS) for (const neighbor of ADJACENCY[region.id]) {
      battle.regions[region.id] = { owner: side, armies: 7 };
      battle.regions[neighbor] = { owner: null, armies: 6 };
      battle.strikers = [region.id];
      battle.acted = [];
      assert.ok(rules.canAttack(battle, region.id, neighbor), `${side} cannot attack ${region.id}–${neighbor}`);
      assert.ok(rules.performAttack(battle, region.id, neighbor).willCapture, `${side} cannot capture ${region.id}–${neighbor}`);
    }
  }

  for (const side of ['player', 'ai']) {
    const thresholds = rules.createGame(side, 1);
    thresholds.regions['068'] = { owner: side, armies: 1 };
    thresholds.regions['600'] = { owner: null, armies: 1 };
    thresholds.strikers = ['068'];
    for (let attackers = 1; attackers <= 30; attackers++) {
      for (let defenders = 1; defenders <= 30; defenders++) {
        thresholds.regions['068'].armies = attackers;
        thresholds.regions['600'].armies = defenders;
        assert.equal(rules.previewAttack(thresholds, '068', '600').willCapture, attackers > defenders, `${side}: ${attackers} vs ${defenders}`);
      }
    }
    for (const [attackers, defenders, wins] of [[7, 6, true], [6, 6, false], [2, 1, true], [1, 1, false]]) {
      const battle = rules.createGame(side, 1);
      battle.regions['068'] = { owner: side, armies: attackers };
      battle.regions['600'] = { owner: null, armies: defenders };
      battle.strikers = ['068'];
      assert.ok(rules.isAdjacent('068', '600'), 'Bolivia must border Paraguay');
      assert.equal(rules.canAttack(battle, '068', '600'), attackers > 1);
      if (attackers > 1) {
        const preview = rules.previewAttack(battle, '068', '600');
        assert.equal(preview.willCapture, wins, `${attackers} vs ${defenders}`);
        const result = rules.performAttack(battle, '068', '600');
        assert.deepEqual(result, preview);
        assert.equal(battle.regions['600'].owner, wins ? side : null);
        assert.ok(battle.regions['068'].armies >= 1);
        assert.ok(battle.regions['600'].armies >= 1);
      }
    }
  }

  {
    const game = rules.createGame('player', 1);
    game.regions['068'] = { owner: 'player', armies: 9 };
    game.regions['600'] = { owner: null, armies: 2 };
    game.regions['032'] = { owner: null, armies: 2 };
    game.strikers = ['068'];
    assert.ok(rules.canAttack(game, '068', '600'));
    assert.ok(rules.performAttack(game, '068', '600').willCapture);
    assert.equal(rules.canAttack(game, '068', '032'), false, 'a country cannot attack twice in one turn');
    assert.equal(rules.canAttack(game, '600', '032'), false, 'a new conquest waits until the next turn');
    assert.ok(rules.canMove(game, '600', '068'));
    const total = game.regions['600'].armies + game.regions['068'].armies;
    rules.moveArmies(game, '600', '068', 100);
    assert.equal(game.regions['600'].armies, 1);
    assert.equal(game.regions['600'].armies + game.regions['068'].armies, total);
    rules.endTurn(game);
    rules.endTurn(game);
    assert.ok(game.strikers.includes('600'), 'conquests join the next turn');
    assert.ok(rules.canAttack(game, '600', '032'), 'conquests can attack on the next turn');
  }

  for (const first of ['player', 'ai']) {
    const game = rules.createGame(first, 3);
    for (let turn = 0; turn < 35 && !game.winner; turn++) {
      const budget = game.strikers.length;
      const actions = ai.planAiTurn(game, game.current);
      assert.ok(actions.filter((action) => action.type === 'attack').length <= budget);
      for (const action of actions) {
        if (action.type === 'attack') {
          assert.ok(rules.canAttack(game, action.from, action.to));
          rules.performAttack(game, action.from, action.to);
        } else {
          assert.ok(rules.canMove(game, action.from, action.to));
          rules.moveArmies(game, action.from, action.to, action.amount);
        }
      }
      if (!game.winner) rules.endTurn(game);
    }
  }

  console.log(`Strategy checks passed: ${REGIONS.length} connected regions, inherited land borders, and attacks in both directions.`);
}
