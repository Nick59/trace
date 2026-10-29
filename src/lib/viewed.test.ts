import assert from 'node:assert/strict';
import test from 'node:test';
import { nextUnviewedStep, nextWorkflow, progressOf, stepState, type WorkflowProgress } from './viewed';

const paths = ['a', 'b', 'c', 'd'];

test('nextUnviewedStep goes forward, wraps to the start and returns null when nothing is left', () => {
  assert.equal(nextUnviewedStep(paths, new Set(['a']), 1), 2);
  assert.equal(nextUnviewedStep(paths, new Set(['a', 'b']), 2), 3);
  assert.equal(nextUnviewedStep(paths, new Set(['b', 'c', 'd']), 3), 1);
  assert.equal(nextUnviewedStep(paths, new Set(['c', 'd']), 4), 1);
  assert.equal(nextUnviewedStep(paths, new Set(['a', 'c']), 1), 2);
  assert.equal(nextUnviewedStep(paths, new Set(paths), 2), null);
  assert.equal(nextUnviewedStep(['a'], new Set(['a']), 1), null);
});

test('progressOf counts viewed steps and finds the first unviewed one', () => {
  assert.deepEqual(progressOf(paths, new Set(['a', 'b', 'zzz'])), { total: 4, viewed: 2, firstUnviewed: 3 });
  assert.deepEqual(progressOf(paths, new Set(paths)), { total: 4, viewed: 4, firstUnviewed: null });
});

test('nextWorkflow takes the next unfinished workflow in PR order and wraps around', () => {
  const entry = (id: string, firstUnviewed: number | null): WorkflowProgress => ({ id, title: id, feature: 'f', total: 3, viewed: firstUnviewed === null ? 3 : 0, firstUnviewed });
  const order = [entry('w1', 1), entry('w3', null), entry('w2', 2)];
  assert.equal(nextWorkflow(order, 'w1')?.id, 'w2');
  assert.equal(nextWorkflow(order, 'w2')?.id, 'w1');
  assert.equal(nextWorkflow(order, 'w3')?.id, 'w2');
  assert.equal(nextWorkflow([entry('w1', null), entry('w2', null)], 'w1'), null);
  assert.equal(nextWorkflow([entry('w1', 1)], 'w1'), null);
});

test('stepState prefers viewed over skipped and is none for untouched steps', () => {
  assert.equal(stepState('s1', ['s1'], ['s1']), 'viewed');
  assert.equal(stepState('s2', ['s1'], ['s2']), 'skipped');
  assert.equal(stepState('s3', ['s1'], ['s2']), 'none');
});
