import { createFileRoute } from '@tanstack/react-router';
import { ClientOnly } from '@/components/client-only';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@tier0/sdk';
import type { StreamJSON } from '@tier0/sdk';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/forms';
import { businessSelector, parseBusinessJSON, publicFailure, SubscriptionSlot } from '@/lib/sdk-acceptance';

export const Route = createFileRoute('/_app/')({ component: AcceptanceHome });

function AcceptanceHome() {
  return <ClientOnly fallback={<div className="page-shell">Initializing SDK acceptance console…</div>}>
    <SdkAcceptance />
  </ClientOnly>;
}

type Evidence = { sequence: number; at: string; operation: string; value: unknown };
type Intent = { code: string; input: StreamJSON; idempotencyKey: string };

/** Acceptance console is an action/evidence workflow, not a record list; no MetaListPage adapter. */
function SdkAcceptance() {
  const [confirmation, setConfirmation] = useState<'invoke' | 'replay' | 'publish' | null>(null);
  const [code, setCode] = useState('ack.echo');
  const [topic, setTopic] = useState('');
  const [requestJSON, setRequestJSON] = useState('{"intent":"sdk-acceptance"}');
  const [payloadJSON, setPayloadJSON] = useState('{"intent":"sdk-acceptance-message"}');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [subscriptionState, setSubscriptionState] = useState('idle');
  const [unknown, setUnknown] = useState(false);
  const [lastFailure, setLastFailure] = useState<ReturnType<typeof publicFailure>>();
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [subscribedTopic, setSubscribedTopic] = useState('');
  const sequence = useRef(0);
  const mounted = useRef(false);
  const requestLock = useRef(false);
  const messageLock = useRef(false);
  const slot = useRef(new SubscriptionSlot());
  const lastIntent = useRef<Intent | undefined>(undefined);

  const record = useCallback((operation: string, value: unknown) => {
    if (!mounted.current) return;
    const event = { sequence: ++sequence.current, at: new Date().toISOString(), operation, value };
    setEvidence(previous => [...previous.slice(-49), event]);
  }, []);
  const failure = useCallback((operation: string, error: unknown) => {
    const value = publicFailure(error);
    console.error(`[SDK acceptance] ${operation}`, value);
    if (!mounted.current) return;
    setLastFailure(value);
    record(`${operation}:error`, value);
    toast.error(`${operation}: ${value.errorCode}`);
  }, [record]);

  useEffect(() => {
    mounted.current = true;
    // Browser-only intent creation after hydration.
    setKey(crypto.randomUUID());
    const stopErrors = client.streams.messages.onError(error => {
      failure('messages', error);
    });
    const currentSlot = slot.current;
    return () => {
      mounted.current = false;
      stopErrors();
      void currentSlot.dispose().catch(error => {
        console.error('[SDK acceptance] unmount dispose', publicFailure(error));
      });
    };
  }, [failure]);

  async function request(operation: 'describe' | 'invoke' | 'replay') {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setLastFailure(undefined);
    try {
      const selectedCode = businessSelector(code);
      if (operation === 'describe') {
        record('describe:start', { code: selectedCode });
        const contract = await client.streams.requests.use({ code: selectedCode }).describe();
        record('describe:result', contract);
        toast.success('Contract received');
      } else {
        const intent = operation === 'replay' ? lastIntent.current : {
          code: selectedCode, input: parseBusinessJSON(requestJSON), idempotencyKey: key,
        };
        if (!intent?.idempotencyKey) throw new Error('A stable intent key is required.');
        lastIntent.current = intent;
        record(operation + ':start', intent);
        const result = await client.streams.requests.use({ code: intent.code })
          .invoke(intent.input, { idempotencyKey: intent.idempotencyKey });
        if (mounted.current) setUnknown(false);
        record(operation + ':result', result);
        toast.success('Request completed; inspect returned result');
      }
    } catch (error) {
      if (operation !== 'describe' && mounted.current) setUnknown(previous => previous || publicFailure(error).outcomeUnknown);
      failure(operation, error);
    } finally {
      requestLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function subscribe() {
    if (messageLock.current) return;
    messageLock.current = true;
    setMessageBusy(true);
    const ticket = slot.current.begin();
    try {
      const selectedTopic = businessSelector(topic);
      setSubscriptionState('connecting');
      record('subscribe:start', { topic: selectedTopic });
      const handle = await client.streams.messages.use({ topic: selectedTopic }).subscribe(message => {
        if (slot.current.current(ticket)) record('message:received', { topic: selectedTopic, message });
      }, { onError: error => {
        if (slot.current.current(ticket)) {
          setSubscriptionState('error');
          failure('subscription', error);
        }
      } });
      const attached = await slot.current.attach(ticket, handle);
      if (mounted.current && attached) {
        setSubscribedTopic(selectedTopic);
        setSubscriptionState(handle.disposed ? 'disposed' : 'subscribed');
        record('subscribe:ready', { topic: selectedTopic, disposed: handle.disposed });
        toast.success('Subscription established');
      }
    } catch (error) {
      if (mounted.current) setSubscriptionState('error');
      failure('subscribe', error);
    } finally {
      messageLock.current = false;
      if (mounted.current) setMessageBusy(false);
    }
  }

  async function dispose() {
    try {
      await slot.current.dispose();
      if (mounted.current) {
        setSubscriptionState('disposed');
        setSubscribedTopic('');
        record('dispose:completed', { topic: subscribedTopic || topic });
        toast.success('Subscription disposed (pending subscribe invalidated)');
      }
    } catch (error) { failure('dispose', error); }
  }

  async function publish() {
    if (messageLock.current) return;
    messageLock.current = true;
    setMessageBusy(true);
    try {
      const selectedTopic = businessSelector(topic);
      const payload = parseBusinessJSON(payloadJSON);
      const messageId = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      record('publish:start', { topic: selectedTopic, payload, messageId, correlationId });
      const message = await client.streams.messages.use({ topic: selectedTopic })
        .publish(payload, { messageId, correlationId });
      record('publish:flushed', { topic: selectedTopic, message, receiverACK: 'not provided by NATS Core' });
      toast.success('Broker flush completed; receiver ACK unproven');
    } catch (error) { failure('publish', error); }
    finally {
      messageLock.current = false;
      if (mounted.current) setMessageBusy(false);
    }
  }

  async function changeTopic(value: string) {
    setTopic(value);
    if (subscriptionState !== 'idle' && subscriptionState !== 'disposed') await dispose();
  }

  return (
    <div className="page-shell space-y-6">
      <ConfirmDialog open={confirmation !== null} onOpenChange={open => {
        if (!open && !busy && !messageBusy) setConfirmation(null);
      }} title={confirmation === 'publish' ? 'Publish fixture message' : 'Invoke fixture request'}
        description={confirmation === 'publish'
          ? `Send one real message on business topic ${topic}. Broker flush does not prove receiver ACK.`
          : confirmation === 'replay'
            ? 'Replay the captured business input with its original key. Confirm uncertain execution has been reconciled; this can execute if the earlier call did not.'
            : `Invoke ${code} once with key ${key}. The published Stream may perform real side effects; use only an authorized owned fixture.`}
        confirmLabel={confirmation === 'publish' ? 'Publish once' : confirmation === 'replay' ? 'Replay same intent' : 'Invoke once'}
        pending={busy || messageBusy} onConfirm={async () => {
          if (confirmation === 'publish') await publish();
          else if (confirmation) await request(confirmation);
          setConfirmation(null);
        }} />
      <h1 className="text-xl font-semibold">CloudApp ↔ Stream SDK acceptance</h1>
      <p role="status" data-testid="acceptance-status">Browser / ACK acceptance: UNVERIFIED — deployment and authenticated execution required.</p>
      <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="request-heading">
        <h2 id="request-heading" className="font-semibold">Request contract and invocation</h2>
        <p>Owned inventory codes: ack.echo, ack.identity, ack.http.telemetry. Confirm v3 cutover and App policy before invoking.</p>
        <FieldGroup label="Business request code" htmlFor="request-code" required>
          <input id="request-code" className="w-full max-w-xl rounded border bg-white p-2" required value={code} disabled={busy || !!lastIntent.current} onChange={e => setCode(e.target.value)} />
        </FieldGroup>
        <FieldGroup label="Input JSON" htmlFor="request-input" required>
          <textarea id="request-input" className="min-h-24 w-full max-w-xl rounded border bg-white p-2 font-mono" required value={requestJSON} disabled={busy || !!lastIntent.current} onChange={e => setRequestJSON(e.target.value)} />
        </FieldGroup>
        <p className="break-all">Idempotency key: <output data-testid="intent-key">{key || 'Initializing browser intent'}</output></p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void request('describe')}>Describe</Button>
          <Button disabled={busy || !!lastIntent.current || !key} onClick={() => setConfirmation('invoke')}>Invoke once</Button>
          <Button variant="outline" disabled={busy || !lastIntent.current} onClick={() => setConfirmation('replay')}>Replay same intent</Button>
          <Button variant="outline" disabled={busy || unknown} onClick={() => {
            lastIntent.current = undefined;
            setKey(crypto.randomUUID());
            record('intent:new', { reason: 'explicit operator action' });
          }}>New intent key</Button>
        </div>
        <p>No automatic retry. Replay sends the captured code, input and key. Reconcile uncertain execution before deliberate replay.</p>
        {unknown && <p role="alert" data-testid="outcome-unknown" className="font-semibold text-destructive">RESULT UNKNOWN: execution may have happened. Intent is frozen; inspect run information before replaying.</p>}
      </section>
      <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="messages-heading">
        <h2 id="messages-heading" className="font-semibold">Business messages</h2>
        <p>The private snapshot has no confirmed v3 business topic. Enter the parent-approved logical topic; publish and subscribe grants are independent.</p>
        <FieldGroup label="Business topic" htmlFor="message-topic" required>
          <input id="message-topic" className="w-full max-w-xl rounded border bg-white p-2" required value={topic} disabled={messageBusy} onChange={e => void changeTopic(e.target.value)} />
        </FieldGroup>
        <FieldGroup label="Payload JSON" htmlFor="message-payload" required>
          <textarea id="message-payload" className="min-h-24 w-full max-w-xl rounded border bg-white p-2 font-mono" required value={payloadJSON} disabled={messageBusy} onChange={e => setPayloadJSON(e.target.value)} />
        </FieldGroup>
        <p role="status" data-testid="subscription-status">Subscription: {subscriptionState}{subscribedTopic ? ` (${subscribedTopic})` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={messageBusy || !topic.trim() || subscriptionState === 'subscribed' || subscriptionState === 'error'} onClick={() => void subscribe()}>Subscribe</Button>
          <Button disabled={messageBusy || !topic.trim()} onClick={() => setConfirmation('publish')}>Publish once</Button>
          <Button variant="outline" onClick={() => void dispose()}>Dispose subscription</Button>
        </div>
        <p>Core WSS messages have no offline queue, replay or receiver ACK. A broker flush or received envelope alone does not prove business ACK.</p>
      </section>
      {lastFailure && <section role="alert" data-testid="sdk-error" className="space-y-2 rounded border border-destructive p-4">
        <h2 className="font-semibold">SDK operation failed</h2>
        <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(lastFailure, null, 2)}</pre>
      </section>}
      <section aria-labelledby="evidence-heading" className="space-y-3">
        <h2 id="evidence-heading" className="font-semibold">Observed SDK evidence (latest 50 events, browser memory only)</h2>
        {evidence.length === 0 && <p>No SDK operations performed.</p>}
        <ol data-testid="sdk-evidence" className="space-y-2">
          {evidence.map(event => <li key={event.sequence} className="min-w-0 rounded border bg-card p-3">
            <p className="break-all text-sm">{event.sequence} · {event.at} · {event.operation}</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.value, null, 2)}</pre>
          </li>)}
        </ol>
      </section>
    </div>
  );
}
