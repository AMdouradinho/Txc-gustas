import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfDayUtc, startOfMonthUtc, nowIso } from '../src/time.js';

test('startOfDayUtc usa o dia local de São Paulo (02h UTC ainda é dia anterior)', () => {
  assert.equal(startOfDayUtc(new Date('2026-11-05T02:00:00Z'), 'America/Sao_Paulo'), '2026-11-04T03:00:00.000Z');
});

test('startOfDayUtc no meio do dia local', () => {
  assert.equal(startOfDayUtc(new Date('2026-11-05T15:30:00Z'), 'America/Sao_Paulo'), '2026-11-05T03:00:00.000Z');
});

test('startOfMonthUtc devolve o primeiro dia do mês local', () => {
  assert.equal(startOfMonthUtc(new Date('2026-11-05T12:00:00Z'), 'America/Sao_Paulo'), '2026-11-01T03:00:00.000Z');
});

test('startOfDayUtc funciona em UTC', () => {
  assert.equal(startOfDayUtc(new Date('2026-11-05T12:00:00Z'), 'UTC'), '2026-11-05T00:00:00.000Z');
});

test('nowIso devolve ISO', () => {
  assert.equal(nowIso(new Date('2026-01-02T03:04:05.000Z')), '2026-01-02T03:04:05.000Z');
});
