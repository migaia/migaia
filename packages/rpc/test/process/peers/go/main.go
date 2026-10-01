// Native RPC peer for process-channel and conformance fixtures. It has no third-party dependencies.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const maxFrameBytes = 16 * 1024 * 1024
const maxHandshakeBytes = 65536

var codecPattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,31}$`)
var capabilityPattern = regexp.MustCompile(`^[a-z][a-z0-9.-]*@[1-9][0-9]*$`)
var runtimePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
var errInvalidClose = errors.New("invalid close payload")
var errHandshakeInvalid = errors.New("invalid handshake")
var errHandshakeIncompatible = errors.New("incompatible handshake")

type record = map[string]any

type version struct {
	Major int `json:"major"`
	Minor int `json:"minor"`
}

type offer struct {
	Versions     []version `json:"versions"`
	Codecs       []string  `json:"codecs"`
	Capabilities []string  `json:"capabilities"`
	Peer         record    `json:"peer"`
}

type agreement struct {
	Major        int
	Minor        int
	Codec        string
	Capabilities []string
}

// readFrame checks the unsigned payload length before allocation. EOF between frames ends a session.
func readFrame(reader io.Reader) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	length := binary.BigEndian.Uint32(header[:])
	if length == 0 || length > maxFrameBytes {
		return nil, errors.New("invalid frame length")
	}
	payload := make([]byte, int(length))
	_, err := io.ReadFull(reader, payload)
	return payload, err
}

// writeFrame writes exactly one bounded nonempty payload with its four-byte big-endian header.
func writeFrame(writer io.Writer, payload []byte) error {
	if len(payload) == 0 || len(payload) > maxFrameBytes {
		return errors.New("invalid frame length")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(payload)))
	if err := writeAll(writer, header[:]); err != nil {
		return err
	}
	return writeAll(writer, payload)
}

// writeAll handles short writes without silently dropping any payload bytes.
func writeAll(writer io.Writer, payload []byte) error {
	for len(payload) > 0 {
		written, err := writer.Write(payload)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		payload = payload[written:]
	}
	return nil
}

// receive decodes one framed JSON record; error strings never contain untrusted input.
func receive(reader io.Reader, handshake bool) (record, error) {
	payload, err := readFrame(reader)
	if err != nil {
		return nil, err
	}
	if handshake && len(payload) > maxHandshakeBytes {
		return nil, errors.New("invalid handshake length")
	}
	if !utf8.Valid(payload) {
		return nil, errors.New("invalid UTF-8 payload")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value record
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, errors.New("invalid JSON record")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, errors.New("trailing JSON value")
	}
	return value, nil
}

// send serializes a JSON record and applies the strict byte framing.
func send(writer io.Writer, value record) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return errors.New("invalid outbound record")
	}
	return writeFrame(writer, payload)
}

// asInt admits only nonnegative JSON integers in the protocol's safe integer domain.
func asInt(value any) (int, bool) {
	if integer, ok := value.(int); ok {
		return integer, integer >= 0 && integer <= 9007199254740991
	}
	number, ok := value.(json.Number)
	if !ok || strings.ContainsAny(string(number), ".eE") {
		return 0, false
	}
	parsed, err := number.Int64()
	return int(parsed), err == nil && parsed >= 0 && parsed <= 9007199254740991
}

// asStrings checks ordered, unique, bounded protocol label lists.
func asStrings(value any, max int, pattern *regexp.Regexp) ([]string, bool) {
	items, ok := value.([]any)
	if !ok || len(items) > max {
		return nil, false
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		label, ok := item.(string)
		if !ok || !pattern.MatchString(label) || slices.Contains(result, label) {
			return nil, false
		}
		result = append(result, label)
	}
	return result, true
}

// parseHello validates one language-neutral hello without returning or logging its auth field.
func parseHello(value record) (offer, error) {
	if value["kind"] != "handshake" || value["step"] != "hello" {
		return offer{}, errors.New("invalid hello")
	}
	if _, ok := value["protocol"].(string); !ok {
		return offer{}, errors.New("invalid hello protocol")
	}
	versionsRaw, ok := value["versions"].([]any)
	if !ok || len(versionsRaw) < 1 || len(versionsRaw) > 8 {
		return offer{}, errors.New("invalid hello versions")
	}
	parsed := offer{Versions: make([]version, 0, len(versionsRaw))}
	for _, item := range versionsRaw {
		entry, ok := item.(record)
		if !ok {
			return offer{}, errors.New("invalid hello version")
		}
		major, goodMajor := asInt(entry["major"])
		minor, goodMinor := asInt(entry["minor"])
		if !goodMajor || major == 0 || !goodMinor {
			return offer{}, errors.New("invalid hello version")
		}
		for _, prior := range parsed.Versions {
			if prior.Major == major {
				return offer{}, errors.New("duplicate hello major")
			}
		}
		parsed.Versions = append(parsed.Versions, version{major, minor})
	}
	parsed.Codecs, ok = asStrings(value["codecs"], 16, codecPattern)
	if !ok || !slices.Contains(parsed.Codecs, "json") {
		return offer{}, errors.New("invalid hello codecs")
	}
	parsed.Capabilities, ok = asStrings(value["capabilities"], 64, capabilityPattern)
	if !ok {
		return offer{}, errors.New("invalid hello capabilities")
	}
	parsed.Peer, ok = value["peer"].(record)
	if !ok {
		return offer{}, errors.New("invalid hello peer")
	}
	id, goodID := parsed.Peer["id"].(string)
	runtime, goodRuntime := parsed.Peer["runtime"].(string)
	if !goodID || len(id) < 1 || len(id) > 128 || !goodRuntime || !runtimePattern.MatchString(runtime) {
		return offer{}, errors.New("invalid hello peer")
	}
	return parsed, nil
}

// localOffer is the fixed native JSON profile; no auth token enters peer diagnostics.
func localOffer() offer {
	return offer{
		Versions:     []version{{Major: 1, Minor: 1}},
		Codecs:       []string{"json"},
		Capabilities: []string{"abort@1", "ping@1", "close@1", "wire-error@1", "stream@1"},
		Peer:         record{"id": "go-peer", "runtime": "go"},
	}
}

// helloRecord encodes the local offer without optional credentials.
func helloRecord(local offer) record {
	return record{"kind": "handshake", "step": "hello", "protocol": "migaia.rpc", "versions": local.Versions, "codecs": local.Codecs, "capabilities": local.Capabilities, "peer": local.Peer}
}

// negotiate selects highest shared major, lower minor, initiator-preferred codec, and ordered capability intersection.
func negotiate(initiator, responder offer) (agreement, bool) {
	chosen := agreement{}
	for _, remote := range initiator.Versions {
		for _, local := range responder.Versions {
			if remote.Major == local.Major && remote.Major > chosen.Major {
				chosen.Major = remote.Major
				chosen.Minor = min(remote.Minor, local.Minor)
			}
		}
	}
	if chosen.Major == 0 {
		return agreement{}, false
	}
	for _, codec := range initiator.Codecs {
		if slices.Contains(responder.Codecs, codec) {
			chosen.Codec = codec
			break
		}
	}
	if chosen.Codec == "" {
		return agreement{}, false
	}
	for _, capability := range initiator.Capabilities {
		if slices.Contains(responder.Capabilities, capability) {
			chosen.Capabilities = append(chosen.Capabilities, capability)
		}
	}
	if chosen.Capabilities == nil {
		chosen.Capabilities = []string{}
	}
	return chosen, true
}

// acceptRecord publishes only negotiated nonsecret fields.
func acceptRecord(chosen agreement, local offer) record {
	return record{"kind": "handshake", "step": "accept", "protocol": "migaia.rpc", "major": chosen.Major, "minor": chosen.Minor, "codec": chosen.Codec, "capabilities": chosen.Capabilities, "peer": local.Peer}
}

// wireError uses the required source/code/name/message/stack wire fields with fixed safe text.
func wireError(code, message string) record {
	return record{"source": "@migaia/rpc/peer-go", "code": code, "name": "Error", "message": message, "stack": "Error: " + message}
}

// rejectRecord never includes a received hello or a credential.
func rejectRecord(code, message string) record {
	return record{"kind": "handshake", "step": "reject", "protocol": "migaia.rpc", "error": wireError(code, message)}
}

// parseAccept verifies that responder choices are a subset of the initiator offer.
func parseAccept(value record, local offer) error {
	if value["kind"] != "handshake" || value["step"] != "accept" || value["protocol"] != "migaia.rpc" {
		return errors.New("invalid handshake accept")
	}
	major, majorOK := asInt(value["major"])
	minor, minorOK := asInt(value["minor"])
	codec, codecOK := value["codec"].(string)
	if !majorOK || major == 0 || !minorOK || !codecOK || !slices.Contains(local.Codecs, codec) {
		return errors.New("invalid handshake accept")
	}
	versionOK := false
	for _, offered := range local.Versions {
		versionOK = versionOK || offered.Major == major && minor <= offered.Minor
	}
	capabilities, capOK := asStrings(value["capabilities"], 64, capabilityPattern)
	if !versionOK || !capOK {
		return errors.New("invalid handshake accept")
	}
	for _, capability := range capabilities {
		if !slices.Contains(local.Capabilities, capability) {
			return errors.New("invalid handshake accept")
		}
	}
	return nil
}

// route creates protocol-owned routing metadata for one reply or control message.
func route(kind, senderID, targetID string) record {
	return record{"profile": "migaia.rpc.route", "type": kind, "applicationVersion": "1", "senderId": senderID, "targetId": targetID, "sentAt": 0}
}

// replyRoute reverses validated sender/target identities and includes the response method.
func replyRoute(inbound record, method string) record {
	senderID, _ := inbound["targetId"].(string)
	targetID, _ := inbound["senderId"].(string)
	result := route("response", senderID, targetID)
	result["method"] = method
	return result
}

// routeOf checks the shared route prefix before an inbound envelope is dispatched.
func routeOf(message record, expected string) (record, error) {
	data, ok := message["data"].(record)
	if !ok {
		return nil, errors.New("invalid envelope data")
	}
	routing, ok := data["route"].(record)
	if !ok || routing["profile"] != "migaia.rpc.route" || routing["type"] != expected {
		return nil, errors.New("invalid envelope route")
	}
	for _, field := range []string{"applicationVersion", "senderId", "targetId"} {
		value, ok := routing[field].(string)
		if !ok || value == "" || len(value) > 128 {
			return nil, errors.New("invalid envelope route")
		}
	}
	if _, ok := asInt(routing["sentAt"]); !ok {
		return nil, errors.New("invalid envelope route")
	}
	return routing, nil
}

// successResponse preserves the request's route identities while returning a fixed method result.
func successResponse(id, method string, routing record, payload any, hasPayload bool) record {
	data := record{"route": replyRoute(routing, method)}
	if hasPayload {
		data["payload"] = payload
	}
	return record{"kind": "response", "id": id, "ok": true, "data": data}
}

// response returns zero or more frames for one-way, wait, finish, echo, and error requests.
func response(message record, pending map[string]record) ([]record, error) {
	routing, err := routeOf(message, "request")
	if err != nil {
		return nil, err
	}
	id, idOK := message["id"].(string)
	method, methodOK := message["method"].(string)
	if !idOK || !methodOK || id == "" || method == "" {
		return nil, errors.New("invalid request")
	}
	if routing["dispatchOnly"] == true {
		return nil, nil
	}
	if method == "peer.wait" {
		pending[id] = routing
		return nil, nil
	}
	data := message["data"].(record)
	if method == "peer.finish" {
		ids := make([]string, 0, len(pending))
		for waitingID := range pending {
			ids = append(ids, waitingID)
		}
		sort.Strings(ids)
		replies := make([]record, 0, len(ids)+1)
		for _, waitingID := range ids {
			replies = append(replies, successResponse(waitingID, "peer.wait", pending[waitingID], nil, false))
			delete(pending, waitingID)
		}
		payload, present := data["payload"]
		return append(replies, successResponse(id, method, routing, payload, present)), nil
	}
	if method == "echo" || method == "peer.echo" {
		payload, present := data["payload"]
		return []record{successResponse(id, method, routing, payload, present)}, nil
	}
	code, messageText := "METHOD_NOT_FOUND", "method not found"
	if method == "peer.error" {
		code, messageText = "PEER_ERROR", "peer requested error"
	}
	return []record{{"kind": "response", "id": id, "ok": false, "code": code, "message": messageText, "error": wireError(code, messageText), "data": record{"route": replyRoute(routing, method)}}}, nil
}

// control ignores unnegotiated controls and returns a close duration only for negotiated close.
func control(message record, pending map[string]record, capabilities []string) (record, *int, error) {
	routing, err := routeOf(message, "variation")
	if err != nil {
		return nil, nil, err
	}
	id, ok := message["id"].(string)
	if !ok || id == "" {
		return nil, nil, errors.New("invalid variation")
	}
	variation, ok := routing["variation"].(string)
	if !ok {
		return nil, nil, errors.New("invalid variation")
	}
	if required := map[string]string{"abort": "abort@1", "ping": "ping@1", "close": "close@1"}[variation]; required != "" && !slices.Contains(capabilities, required) {
		return nil, nil, nil
	}
	senderID, _ := routing["targetId"].(string)
	targetID, _ := routing["senderId"].(string)
	switch variation {
	case "abort":
		delete(pending, id)
		return nil, nil, nil
	case "ping":
		pongRoute := route("variation", senderID, targetID)
		pongRoute["variation"] = "pong"
		return record{"kind": "variation", "id": id, "data": record{"route": pongRoute}}, nil, nil
	case "pong":
		return nil, nil, nil
	case "close":
		payload, ok := message["data"].(record)["payload"].(record)
		if !ok {
			return nil, nil, errInvalidClose
		}
		drain, ok := asInt(payload["drainMs"])
		if !ok || drain > 2147483647 {
			return nil, nil, errInvalidClose
		}
		return nil, &drain, nil
	default:
		return nil, nil, nil
	}
}

// responder consumes the first hello, then dispatches only validated framed RPC records.
func responder(reader io.Reader, writer io.Writer) error {
	first, err := receive(reader, true)
	if err != nil {
		return errHandshakeInvalid
	}
	remote, err := parseHello(first)
	if err != nil {
		return errHandshakeInvalid
	}
	if first["protocol"] != "migaia.rpc" {
		_ = send(writer, rejectRecord("HANDSHAKE_INCOMPATIBLE", "incompatible protocol"))
		return errHandshakeIncompatible
	}
	chosen, ok := negotiate(remote, localOffer())
	if !ok {
		_ = send(writer, rejectRecord("HANDSHAKE_INCOMPATIBLE", "incompatible version or codec"))
		return errHandshakeIncompatible
	}
	if err := send(writer, acceptRecord(chosen, localOffer())); err != nil {
		return err
	}
	// A dedicated reader lets a drain deadline close an idle stdio session.
	type inboundFrame struct {
		message record
		err     error
	}
	inbound := make(chan inboundFrame, 1)
	go func() {
		for {
			message, readErr := receive(reader, false)
			inbound <- inboundFrame{message: message, err: readErr}
			if readErr != nil {
				return
			}
		}
	}()
	pending := make(map[string]record)
	var drainTimer *time.Timer
	var drainDeadline <-chan time.Time
	defer func() {
		if drainTimer != nil {
			drainTimer.Stop()
		}
	}()
	for {
		var received inboundFrame
		select {
		case received = <-inbound:
		case <-drainDeadline:
			return nil
		}
		if errors.Is(received.err, io.EOF) {
			return nil
		}
		if received.err != nil {
			return received.err
		}
		message := received.message
		switch message["kind"] {
		case "request":
			if drainTimer != nil {
				continue
			}
			replies, dispatchErr := response(message, pending)
			if dispatchErr != nil {
				return dispatchErr
			}
			for _, reply := range replies {
				if sendErr := send(writer, reply); sendErr != nil {
					return sendErr
				}
			}
		case "variation":
			reply, closeMs, controlErr := control(message, pending, chosen.Capabilities)
			if errors.Is(controlErr, errInvalidClose) {
				_, _ = fmt.Fprintln(os.Stderr, "PEER_ERROR PROTOCOL_INVALID")
				continue
			}
			if controlErr != nil {
				return controlErr
			}
			if reply != nil {
				if sendErr := send(writer, reply); sendErr != nil {
					return sendErr
				}
			}
			data, _ := message["data"].(record)
			routing, _ := data["route"].(record)
			if drainTimer != nil && routing["variation"] == "abort" && slices.Contains(chosen.Capabilities, "abort@1") {
				_, _ = fmt.Fprintln(os.Stderr, "PEER_EVENT ABORT_DURING_DRAIN")
				if len(pending) == 0 {
					return nil
				}
			}
			if closeMs != nil && drainTimer == nil {
				if *closeMs == 0 || len(pending) == 0 {
					return nil
				}
				drainTimer = time.NewTimer(time.Duration(*closeMs) * time.Millisecond)
				drainDeadline = drainTimer.C
			}
		default:
			_, _ = fmt.Fprintln(os.Stderr, "PEER_WARN UNKNOWN_KIND")
		}
	}
}

// initiator performs the minimal cross-language hello, echo request, and close exchange.
func initiator(reader io.Reader, writer io.Writer) error {
	local := localOffer()
	if err := send(writer, helloRecord(local)); err != nil {
		return err
	}
	accept, err := receive(reader, true)
	if err != nil {
		return err
	}
	if err := parseAccept(accept, local); err != nil {
		return err
	}
	payload := record{"probe": "go"}
	request := record{"kind": "request", "id": "go-echo-1", "method": "echo", "data": record{"route": route("request", "go-peer", "peer"), "payload": payload}}
	if err := send(writer, request); err != nil {
		return err
	}
	reply, err := receive(reader, false)
	if err != nil {
		return err
	}
	if reply["kind"] != "response" || reply["id"] != "go-echo-1" || reply["ok"] != true {
		return errors.New("invalid echo response")
	}
	data, ok := reply["data"].(record)
	if !ok {
		return errors.New("invalid echo data")
	}
	returned, ok := data["payload"].(record)
	if !ok || returned["probe"] != "go" {
		return errors.New("echo mismatch")
	}
	closing := route("variation", "go-peer", "peer")
	closing["variation"] = "close"
	if err := send(writer, record{"kind": "variation", "id": "go-close-1", "data": record{"route": closing, "payload": record{"drainMs": 0}}}); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(os.Stderr, "RESULT ok")
	return nil
}

// serveUnix accepts one connection and removes only its own socket path on exit.
func serveUnix(path, role string) error {
	if role == "initiator" {
		connection, err := net.Dial("unix", path)
		if err != nil {
			return err
		}
		defer connection.Close()
		fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
		return initiator(connection, connection)
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(path)
	fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
	connection, err := listener.Accept()
	if err != nil {
		return err
	}
	defer connection.Close()
	return responder(connection, connection)
}

// main selects a selftest, stdio session, or a single Unix socket session.
func main() {
	business := flag.Bool("business", false, "serve published business profile")
	descendant := flag.Bool("descendant", false, "own a real child until stdin EOF")
	bridge := flag.Bool("jsonrpc", false, "serve Content-Length bridge profile")
	bare := flag.Bool("bare-jsonrpc", false, "echo physical Content-Length frames")
	host := flag.Bool("host", false, "serve portable Host controls")
	bootstrap := flag.String("bootstrap", "none", "native stdin bootstrap")
	authFD := flag.Int("auth-fd", -1, "inherited auth descriptor")
	contractPath := flag.String("contract", "", "published business contract vector")
	role := flag.String("role", "responder", "responder or initiator")
	stdio := flag.Bool("stdio", false, "use framed stdin/stdout")
	listenUnix := flag.String("listen-unix", "", "listen on a Unix socket")
	connectUnix := flag.String("connect-unix", "", "connect to a Unix socket")
	selftest := flag.Bool("selftest", false, "run vector selftest")
	vectors := flag.String("vectors", "", "path to schema/vectors")
	flag.Parse()
	if *selftest {
		os.Exit(runSelftest(*vectors))
	}
	if *role != "responder" && *role != "initiator" {
		_, _ = fmt.Fprintln(os.Stderr, "ERROR invalid role")
		os.Exit(2)
	}
	if *listenUnix != "" && *connectUnix != "" || *stdio && (*listenUnix != "" || *connectUnix != "") {
		_, _ = fmt.Fprintln(os.Stderr, "ERROR conflicting transport")
		os.Exit(2)
	}
	var err error
	if *business {
		err = runBusiness(*stdio, *listenUnix, *host, *bootstrap, *authFD, *contractPath, *bridge, *bare, *descendant)
	} else if *listenUnix != "" {
		err = serveUnix(*listenUnix, *role)
	} else if *connectUnix != "" {
		err = serveUnix(*connectUnix, "initiator")
	} else {
		fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
		if *role == "initiator" {
			err = initiator(os.Stdin, os.Stdout)
		} else {
			err = responder(os.Stdin, os.Stdout)
		}
	}
	if err != nil {
		switch {
		case errors.Is(err, errHandshakeInvalid):
			_, _ = fmt.Fprintln(os.Stderr, "PEER_FAIL HANDSHAKE_INVALID")
		case errors.Is(err, errHandshakeIncompatible):
			_, _ = fmt.Fprintln(os.Stderr, "PEER_FAIL HANDSHAKE_INVALID")
		default:
			_, _ = fmt.Fprintln(os.Stderr, "PEER_FAIL SESSION_ERROR")
		}
		os.Exit(1)
	}
}
