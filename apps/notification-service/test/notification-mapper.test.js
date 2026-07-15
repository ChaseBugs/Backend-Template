const test = require('node:test');
const assert = require('node:assert/strict');
const { mapEventToNotification } = require('../dist/notification.mapper');

test('maps customer events to explicit user recipients', () => {
  const payment = mapEventToNotification('payment.completed', {
    userId: 'user-1', orderId: 'order-1', paymentId: 'payment-1', amount: 25000,
  });
  const shipped = mapEventToNotification('delivery.shipped', {
    userId: 'user-1', orderId: 'order-1', deliveryGroupId: 'group-1',
    trackingNumber: 'TRACK-1', courierName: 'Courier',
  });

  assert.equal(payment.userId, 'user-1');
  assert.equal(payment.routingKey, 'payment.completed');
  assert.equal(shipped.userId, 'user-1');
  assert.match(shipped.body, /TRACK-1/);
  const returned = mapEventToNotification('delivery.return.completed', {
    userId: 'user-1', orderId: 'order-1', deliveryGroupId: 'group-1', returnRequestId: 'return-1', refundAmount: 5000,
  });
  assert.equal(returned.userId, 'user-1');
  assert.match(returned.body, /5,000/);
});

test('maps fulfillment, return, and settlement events to agent recipients', () => {
  for (const [topic, payload] of [
    ['delivery.group.created', { agentId: 'agent-1', orderId: 'order-1', deliveryGroupId: 'group-1' }],
    ['delivery.return.requested', { agentId: 'agent-1', orderId: 'order-1', deliveryGroupId: 'group-1', returnRequestId: 'return-1', reason: 'damaged' }],
    ['payment.agent-settlement.created', { agentId: 'agent-1', orderId: 'order-1', paymentId: 'payment-1', settlementId: 'settlement-1', netAmount: 9500 }],
    ['payment.agent-settlement.completed', { agentId: 'agent-1', orderId: 'order-1', paymentId: 'payment-1', settlementId: 'settlement-1', netAmount: 9500, completedAt: '2026-01-01T00:00:00Z' }],
    ['stock.low', { agentId: 'agent-1', productId: 'product-1', available: 2, threshold: 5 }],
    ['product.approved', { agentId: 'agent-1', productId: 'product-1' }],
    ['product.rejected', { agentId: 'agent-1', productId: 'product-1', reason: 'invalid description' }],
  ]) {
    const draft = mapEventToNotification(topic, payload);
    assert.equal(draft.agentId, 'agent-1');
    assert.equal(draft.userId, undefined);
  }
});

test('ignores unrelated events', () => {
  assert.equal(mapEventToNotification('product.updated', {}), null);
});

test('maps an agent application to active administrator roles', () => {
  const draft = mapEventToNotification('agent.application.submitted', {
    agentId: 'agent-1', userId: 'user-1', businessName: 'Example Shop', businessNumber: 'BN-1',
  });

  assert.deepEqual(draft.recipientRoles, ['admin', 'super-admin']);
  assert.equal(draft.userId, undefined);
  assert.equal(draft.agentId, undefined);
  assert.equal(draft.routingKey, 'agent.application_submitted');
  assert.equal(draft.metadata.agentId, 'agent-1');
});

test('maps a delayed delivery warning to active administrator roles', () => {
  const draft = mapEventToNotification('delivery.delayed', {
    deliveryGroupId: 'group-1', orderId: 'order-12345678', agentId: 'agent-1',
    delayedSince: '2026-07-10T00:00:00.000Z', thresholdHours: 72,
  });
  assert.deepEqual(draft.recipientRoles, ['admin', 'super-admin']);
  assert.equal(draft.routingKey, 'delivery.delayed');
  assert.equal(draft.metadata.thresholdHours, 72);
});

test('maps a system warning to active administrator roles', () => {
  const draft = mapEventToNotification('system.warning', {
    source: 'auth-service', code: 'SERVICE_UNREADY', message: 'auth-service is unavailable',
    targetUrl: 'http://localhost:3001/ready', consecutiveFailures: 3, detectedAt: '2026-07-15T00:00:00.000Z',
  });
  assert.deepEqual(draft.recipientRoles, ['admin', 'super-admin']);
  assert.equal(draft.body, 'auth-service is unavailable');
  assert.equal(draft.routingKey, 'system.warning');
});
