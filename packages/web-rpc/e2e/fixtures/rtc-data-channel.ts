import { createRtcDataChannelTransport } from '../../src/adapters/rtc-data-channel';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createEndpoint } from '../../src/factory';
import { connect } from '../../src/middleware/connect';
import { protocol } from '../../src/middleware/protocol';
import { timeout } from '../../src/middleware/timeout';
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
    middlewares: [connect({ transport: leftTransport }), codec, timeout({ timeoutMs: 500 })]
  });
  const right = await createEndpoint({
    id: 'right',
    targetIds: ['left'],
    provider: { echo: (context) => context.success(context.data) },
    middlewares: [connect({ transport: rightTransport }), codec, timeout({ timeoutMs: 500 })]
  });
  const result = await left.send('right', 'echo', 'rtc-ok');
  peers.leftChannel.close();
  const terminal = await left.send('right', 'echo', 'late').then(
    () => 'unexpected',
    (error: { code?: string }) => error.code ?? 'error'
  );
  await Promise.allSettled([left.dispose(), right.dispose()]);
  peers.left.close();
  peers.right.close();
  return {
    result,
    terminal,
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
