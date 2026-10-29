// Store this program in the current single-model Stream document; omit version selectors.
module.exports = api => {
  const inputSchema = {
    type: 'object', properties: { orderId: { type: 'string' } },
    required: ['orderId'], additionalProperties: false,
  };
  api.stream.messages.use({ topic: 'orders/accepted', access: 'publish' });

  api.stream.onRequest({
    id: 'approve-order',
    request: {
      code: 'orders.approve', name: 'Approve order', contractVersion: '1',
      inputSchema,
      outputSchema: {
        type: 'object', properties: { accepted: { type: 'boolean' } },
        required: ['accepted'], additionalProperties: false,
      },
      sideEffect: 'write', idempotency: 'required', timeoutMs: 1000,
    },
  }, async ctx => {
    await api.stream.messages.publish({ topic: 'orders/accepted', payload: { orderId: ctx.input.orderId } });
    return { accepted: true };
  });

  api.stream.messages.subscribe({ id: 'order-created', topic: 'orders/created', inputSchema }, async ctx => {
    await api.stream.messages.publish({ topic: 'orders/accepted', payload: { orderId: ctx.input.orderId } });
  });
};
