import { createRtcDataChannelTransport } from '../../src/adapters/rtc-data-channel';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createEndpoint } from '../../src/factory';
import { connect } from '../../src/middleware/connect';
import { protocol } from '../../src/middleware/protocol';
import { timeout } from '../../src/middleware/timeout';
import { abort } from '../../src/middleware/abort';
import { contract } from '../../src/middleware/contract';
import { ping } from '../../src/middleware/ping';
import { chunk } from '../../src/middleware/chunk';
import { installErrorGuards } from './rpc';

const errors = installErrorGuards();

/** Returns compact ICE/DTLS diagnostics when browser loopback cannot open. */
const connectionDiagnostics = async (
  left: RTCPeerConnection,
  right: RTCPeerConnection
): Promise<string> => {
  const summarize = async (peer: RTCPeerConnection): Promise<unknown[]> => {
    const report = await peer.getStats();
    return [...report.values()]
      .filter((entry) =>
        ['candidate-pair', 'local-candidate', 'remote-candidate', 'transport'].includes(entry.type)
      )
      .map((entry) => ({
        type: entry.type,
        state: entry.state,
        candidateType: entry.candidateType,
        protocol: entry.protocol,
        address: entry.address,
        port: entry.port,
        localCandidateId: entry.localCandidateId,
        remoteCandidateId: entry.remoteCandidateId,
        selectedCandidatePairId: entry.selectedCandidatePairId
      }));
  };
  return JSON.stringify({
    left: {
      connection: left.connectionState,
      ice: left.iceConnectionState,
      stats: await summarize(left)
    },
    right: {
      connection: right.connectionState,
      ice: right.iceConnectionState,
      stats: await summarize(right)
    }
  });
};

/** Creates one real negotiated RTCDataChannel pair with ordered ICE candidate delivery. */
const linkPeers = async () => {
  const left = new RTCPeerConnection();
  const right = new RTCPeerConnection();
  const leftCandidates: RTCIceCandidate[] = [];
  const rightCandidates: RTCIceCandidate[] = [];
  /** Maps Chromium's non-routable RFC 2544 test interface back to its loopback-bound UDP socket. */
  const routableCandidate = (candidate: RTCIceCandidate): RTCIceCandidateInit => {
    const init = candidate.toJSON();
    /** Canonical candidate line retained when older browser JSON omits its optional declaration. */
    const description = init.candidate ?? candidate.candidate;
    return candidate.address === '198.18.0.1'
      ? { ...init, candidate: description.replace('198.18.0.1', '127.0.0.1') }
      : init;
  };
  left.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return;
    if (right.remoteDescription) void right.addIceCandidate(routableCandidate(event.candidate));
    else leftCandidates.push(event.candidate);
  });
  right.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return;
    if (left.remoteDescription) void left.addIceCandidate(routableCandidate(event.candidate));
    else rightCandidates.push(event.candidate);
  });
  const leftChannel = left.createDataChannel('web-rpc', { negotiated: true, id: 0 });
  const rightChannel = right.createDataChannel('web-rpc', { negotiated: true, id: 0 });
  const offer = await left.createOffer();
  await left.setLocalDescription(offer);
  await right.setRemoteDescription(offer);
  await Promise.all(
    leftCandidates.splice(0).map((candidate) => right.addIceCandidate(routableCandidate(candidate)))
  );
  const answer = await right.createAnswer();
  await right.setLocalDescription(answer);
  await left.setRemoteDescription(answer);
  await Promise.all(
    rightCandidates.splice(0).map((candidate) => left.addIceCandidate(routableCandidate(candidate)))
  );
  const channelsOpen = Promise.all(
    [leftChannel, rightChannel].map(
      (channel) =>
        new Promise<void>((resolve) => {
          if (channel.readyState === 'open') resolve();
          else channel.addEventListener('open', () => resolve(), { once: true });
        })
    )
  );
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const openDeadline = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      void connectionDiagnostics(left, right).then((details) =>
        reject(new Error(`RTCDataChannel loopback did not open: ${details}`))
      );
    }, 5_000);
  });
  try {
    await Promise.race([channelsOpen, openDeadline]);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
  return { left, right, leftChannel, rightChannel };
};

globalThis.runRtcScenario = async () => {
  let dispatchPayload: unknown;
  const peers = await linkPeers();
  const codec = protocol({
    encodedType: 'string',
    encode: (value) => JSON.stringify(value),
    decode: (value) => JSON.parse(String(value))
  });
  const leftTransport = createRtcDataChannelTransport(peers.leftChannel);
  const rightTransport = createRtcDataChannelTransport(peers.rightChannel);
  const left = await createEndpoint({
    id: 'left',
    targetIds: ['right'],
    middlewares: [
      connect({ transport: leftTransport }),
      codec,
      timeout({ timeoutMs: 500 }),
      abort(),
      ping(),
      contract({
        schemas: {
          schema: {
            params: {
              parse: () => {
                throw new Error('schema rejected');
              }
            },
            result: { parse: (value) => value }
          }
        }
      }),
      chunk({ chunkSize: 4 })
    ]
  });
  const right = await createEndpoint({
    id: 'right',
    targetIds: ['left'],
    provider: {
      echo: (context) => context.success(context.data),
      notify: (context) => {
        dispatchPayload = context.data;
        return context.success(undefined);
      },
      fail: (context) => context.failed('remote failure', 'REMOTE_FAILURE'),
      hang: async () => await new Promise<never>(() => undefined)
    },
    middlewares: [
      connect({ transport: rightTransport }),
      codec,
      timeout({ timeoutMs: 500 }),
      abort(),
      ping(),
      chunk({ chunkSize: 4 })
    ]
  });
  const result = await left.send('right', 'echo', 'rtc-ok');
  const chunkedRequest = await left.send('right', 'echo', 'rtc-chunked-request-😀');
  const chunkedRemoteError = await left.send('right', 'fail', 'rtc-chunked-error-😀').then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const chunkedTimeout = await left
    .send('right', 'hang', 'rtc-chunked-timeout-😀', {
      timeoutMs: 40
    })
    .then(
      () => 'resolved',
      (error: { readonly code?: string }) => error.code ?? 'error'
    );
  const chunkedAbortController = new AbortController();
  const chunkedAbortPending = left.send('right', 'hang', 'rtc-chunked-abort-😀', {
    signal: chunkedAbortController.signal
  });
  chunkedAbortController.abort();
  const chunkedAbort = await chunkedAbortPending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const chunkedSchemaError = await left.send('right', 'schema', 'rtc-chunked-schema-😀').then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  left.dispatch('right', 'notify', 'rtc-chunked-dispatch-😀');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const remoteError = await left.send('right', 'fail', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const timeoutResult = await left.send('right', 'hang', null, { timeoutMs: 40 }).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const controller = new AbortController();
  const abortPending = left.send('right', 'hang', null, { signal: controller.signal });
  controller.abort();
  const aborted = await abortPending.then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const schemaError = await left.send('right', 'schema', null).then(
    () => 'resolved',
    (error: { readonly code?: string }) => error.code ?? 'error'
  );
  const pingEndpoint = left as typeof left & {
    ping(
      targetId: string,
      receiverId?: string,
      options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }
    ): Promise<boolean>;
  };
  const pingSuccess = await pingEndpoint.ping('right');
  const pingTimeout = await pingEndpoint.ping('missing', undefined, { timeoutMs: 40 });
  const pingController = new AbortController();
  const pingAbortedPending = pingEndpoint.ping('right', undefined, {
    signal: pingController.signal
  });
  pingController.abort();
  const pingAborted = await pingAbortedPending;
  peers.leftChannel.close();
  const terminal = await left.send('right', 'echo', 'late').then(
    () => 'unexpected',
    (error: { code?: string }) => error.code ?? 'error'
  );
  const activeSnapshots = {
    left: readEndpointDebugSnapshot(left),
    right: readEndpointDebugSnapshot(right)
  };
  await Promise.allSettled([left.dispose(), right.dispose()]);
  peers.left.close();
  peers.right.close();
  return {
    result,
    chunkedRequest,
    chunkedRemoteError,
    chunkedTimeout,
    chunkedAbort,
    chunkedSchemaError,
    dispatchPayload: String(dispatchPayload),
    remoteError,
    timeoutResult,
    aborted,
    schemaError,
    pingSuccess,
    pingTimeout,
    pingAborted,
    terminal,
    activeSnapshots,
    errors,
    snapshots: {
      left: readEndpointDebugSnapshot(left),
      right: readEndpointDebugSnapshot(right)
    }
  };
};

declare global {
  var runRtcScenario: () => Promise<unknown>;
}
