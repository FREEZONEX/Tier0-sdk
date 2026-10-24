import { createClient } from '@tier0/sdk/cloud';

// The App host injects the trusted runtime before this module is called.
// A Node deployment supplies the existing SDK HTTP/App context instead.
export async function openOrderInteractions(onMessage, onError) {
  const sdk = createClient();
  const removeErrorHandler = sdk.streams.messages.onError(onError);
  let subscription;
  let disposed = false;
  try {
    subscription = await sdk.streams.messages.use({ topic: 'orders/accepted' }).subscribe(onMessage);
    const producer = sdk.streams.messages.use({ topic: 'orders/created' });
    const request = sdk.streams.requests.use({ code: 'orders.approve' });
    return {
      describe: () => request.describe(),
      // The caller persists one key for each business intent; no automatic retry.
      approve: (orderId, savedIntentId) => request.invoke({ orderId }, { idempotencyKey: savedIntentId }),
      publish: orderId => producer.publish({ orderId }),
      async dispose() {
        if (disposed) return;
        disposed = true;
        try { await subscription.dispose(); }
        finally {
          removeErrorHandler();
          await sdk.dispose();
        }
      },
    };
  } catch (error) {
    removeErrorHandler();
    await sdk.dispose();
    throw error;
  }
}
