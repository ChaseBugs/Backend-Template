const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBuyBox } = require('../dist/application/buy-box');

// Offers arrive in Buy Box order (price ascending, earliest first on ties).

test('reports the agent as winner when their offer leads the Buy Box', () => {
  const offers = [
    { productId: 'p-mine', agentId: 'me', price: 9000, condition: 'NEW' },
    { productId: 'p-b', agentId: 'other', price: 9500, condition: 'NEW' },
  ];
  const r = computeBuyBox('v1', offers, 'me');
  assert.equal(r.offerCount, 2);
  assert.equal(r.lowestPrice, 9000);
  assert.equal(r.winnerAgentId, 'me');
  assert.equal(r.iAmWinning, true);
  assert.deepEqual(r.myOffer, { productId: 'p-mine', price: 9000, condition: 'NEW', rank: 1 });
  assert.equal(r.priceToWin, 0);
});

test('computes rank and the undercut needed when the agent is losing', () => {
  const offers = [
    { productId: 'p-a', agentId: 'a', price: 8000, condition: 'NEW' },
    { productId: 'p-b', agentId: 'b', price: 8500, condition: 'NEW' },
    { productId: 'p-mine', agentId: 'me', price: 9000, condition: 'NEW' },
  ];
  const r = computeBuyBox('v1', offers, 'me');
  assert.equal(r.winnerAgentId, 'a');
  assert.equal(r.iAmWinning, false);
  assert.equal(r.myOffer.rank, 3);
  // Undercut the current lowest by 1 to take the box.
  assert.equal(r.priceToWin, 9000 - 8000 + 1);
});

test('handles a variant where the agent has no offer', () => {
  const offers = [{ productId: 'p-a', agentId: 'a', price: 8000, condition: 'NEW' }];
  const r = computeBuyBox('v1', offers, 'me');
  assert.equal(r.winnerAgentId, 'a');
  assert.equal(r.myOffer, null);
  assert.equal(r.iAmWinning, false);
  assert.equal(r.priceToWin, null);
});

test('handles a variant with no active offers', () => {
  const r = computeBuyBox('v1', [], 'me');
  assert.equal(r.offerCount, 0);
  assert.equal(r.lowestPrice, null);
  assert.equal(r.winnerAgentId, null);
  assert.equal(r.myOffer, null);
  assert.equal(r.iAmWinning, false);
  assert.equal(r.priceToWin, null);
});
