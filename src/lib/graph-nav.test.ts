import assert from 'node:assert/strict';
import test from 'node:test';
import { graphNav } from './graph-nav';

const steps = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}` }));
const edge = (from: number, to: number) => ({ from: `s${from}`, to: `s${to}` });
const none = { up: null, down: null, left: null, right: null };

test('a linear flow moves down and up and has no siblings', () => {
  const edges = [edge(1, 2), edge(2, 3)];
  assert.deepEqual(graphNav(steps(3), edges, 's1'), { ...none, down: 's2' });
  assert.deepEqual(graphNav(steps(3), edges, 's2'), { up: 's1', down: 's3', left: null, right: null });
  assert.deepEqual(graphNav(steps(3), edges, 's3'), { ...none, up: 's2' });
});

test('a fork with three branches: down follows the remembered choice, left and right switch branches without wrapping', () => {
  const edges = [edge(1, 2), edge(2, 3), edge(2, 4), edge(2, 5)];
  assert.equal(graphNav(steps(5), edges, 's2').down, 's3');
  assert.equal(graphNav(steps(5), edges, 's2', { choices: { s2: 's4' } }).down, 's4');
  assert.equal(graphNav(steps(5), edges, 's2', { choices: { s2: 's1' } }).down, 's3');
  assert.deepEqual(graphNav(steps(5), edges, 's3'), { up: 's2', down: null, left: null, right: 's4' });
  assert.deepEqual(graphNav(steps(5), edges, 's4'), { up: 's2', down: null, left: 's3', right: 's5' });
  assert.deepEqual(graphNav(steps(5), edges, 's5'), { up: 's2', down: null, left: 's4', right: null });
});

test('siblings are ordered by rendered position when it is known', () => {
  const edges = [edge(1, 2), edge(1, 3)];
  const x = (id: string) => ({ s2: 300, s3: 100 })[id];
  assert.deepEqual(graphNav(steps(3), edges, 's3', {}, x), { up: 's1', down: null, left: null, right: 's2' });
  assert.deepEqual(graphNav(steps(3), edges, 's2', {}, x), { up: 's1', down: null, left: 's3', right: null });
});

test('a merge goes up to the parent the user came from, else the lowest parent', () => {
  const edges = [edge(1, 2), edge(1, 3), edge(2, 4), edge(3, 4)];
  assert.equal(graphNav(steps(4), edges, 's4').up, 's2');
  assert.equal(graphNav(steps(4), edges, 's4', { cameFrom: { s4: 's3' } }).up, 's3');
  assert.equal(graphNav(steps(4), edges, 's4', { cameFrom: { s4: 's1' } }).up, 's2');
  assert.deepEqual(graphNav(steps(4), edges, 's4', { cameFrom: { s4: 's3' } }), { ...none, up: 's3', left: null, right: null });
});

test('a dead end only goes up, and the first step or an orphan does nothing upwards', () => {
  const edges = [edge(1, 2), edge(1, 3)];
  assert.deepEqual(graphNav(steps(4), edges, 's2'), { up: 's1', down: null, left: null, right: 's3' });
  assert.deepEqual(graphNav(steps(4), edges, 's4'), none);
  assert.equal(graphNav(steps(4), edges, 's1').up, null);
});

test('a diamond: siblings come from the parent that ↑ resolves to', () => {
  const edges = [edge(1, 2), edge(1, 3), edge(2, 4), edge(3, 4)];
  assert.deepEqual(graphNav(steps(4), edges, 's2'), { up: 's1', down: 's4', left: null, right: 's3' });
  assert.deepEqual(graphNav(steps(4), edges, 's3'), { up: 's1', down: 's4', left: 's2', right: null });
});

test('edges to unknown steps and a missing current step are ignored', () => {
  assert.deepEqual(graphNav(steps(2), [edge(1, 9)], 's1'), none);
  assert.deepEqual(graphNav(steps(2), [edge(1, 2)], 's7'), none);
});
