package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// businessStream retains the original correlation route and the next credited item.
type businessStream struct {
	request record
	items   []any
	seq     int
}

// businessOffer adds the stream capability only for the profile that installs its providers.
func businessOffer() offer {
	local := localOffer()
	local.Capabilities = append(local.Capabilities, "stream@1")
	return local
}

// businessState owns one authenticated session's actual Host definition and call receipts.
type businessState struct {
	host, installed, closing bool
	// stream records this session's capability agreement, rather than the local offer.
	stream                  bool
	revision, pongs, closes int
	received, aborts        []any
	waiting                 map[string]record
	streams                 map[string]*businessStream
}

// businessRoute answers this exact caller and preserves request trace without leaking other sessions.
func businessRoute(message record, kind string) record {
	incoming := field(field(message["data"])["route"])
	result := route(kind, incoming["targetId"].(string), incoming["senderId"].(string))
	if _, ok := incoming["receiverId"]; ok {
		result["receiverId"] = incoming["senderId"]
	}
	if trace, ok := incoming["trace"]; ok {
		result["trace"] = trace
	}
	if kind == "response" {
		result["method"] = message["method"]
	}
	return result
}

// businessResponse emits one canonical response preserving the complete native error graph.
func businessResponse(message record, value any, failure record) record {
	data := record{"route": businessRoute(message, "response")}
	result := record{"kind": "response", "id": message["id"], "ok": failure == nil, "data": data}
	if failure == nil {
		data["payload"] = value
	} else {
		result["code"] = failure["code"]
		result["message"] = failure["message"]
		result["error"] = failure
	}
	return result
}

// businessStreamFrame returns the next event through the request's original authenticated route.
func businessStreamFrame(message record, event string, seq int, value any) record {
	payload := record{"event": event, "seq": seq}
	if event == "item" {
		payload["value"] = value
	}
	return record{"kind": "stream", "id": message["id"], "data": record{"route": businessRoute(message, "stream"), "payload": payload}}
}

// businessItem projects only the installed definition's portable state.
func (b *businessState) item() record {
	return record{"name": "p", "state": "enabled", "revision": b.revision, "features": []any{"f"}}
}

// businessInvoke executes the same published business and Host controls as the public TS peer.
func (b *businessState) invoke(method string, payload any, trace any) (any, record) {
	args, _ := payload.([]any)
	switch method {
	case runtimeDescribeMethod:
		return runtimeDescription(true, b.host, b.stream), nil
	case "migaia.remote.host.use":
		if !b.host || len(args) < 1 || len(args) > 2 || args[0] != "p" {
			return nil, wireError("REMOTE_CONTRACT_INVALID", "invalid Host use")
		}
		b.installed = true
		b.revision++
		return b.item(), nil
	case "migaia.remote.host.unUse":
		if !b.host || len(args) < 1 || len(args) > 2 || args[0] != "p" {
			return nil, wireError("REMOTE_CONTRACT_INVALID", "invalid Host unUse")
		}
		b.installed = false
		b.revision++
		return record{"ok": true}, nil
	case "migaia.remote.host.inspect":
		items := []any{}
		if b.installed {
			items = append(items, b.item())
		}
		return record{"revision": b.revision, "plugins": items}, nil
	case "echo", "peer.echo":
		return payload, nil
	case "peer.received":
		return record{"count": len(b.received), "values": b.received}, nil
	case "peer.aborts":
		return b.aborts, nil
	case "peer.stats":
		return record{"pongs": b.pongs, "closes": b.closes, "pid": os.Getpid()}, nil
	case "peer.trace":
		return trace, nil
	case "peer.error":
		cause := record{"source": "@migaia/rpc/core", "code": "INTERNAL", "name": "Error", "message": "peer cause", "stack": "Error: peer cause"}
		return nil, record{"source": "@migaia/rpc/core", "code": "INTERNAL", "name": "RpcError", "message": "peer error", "stack": "RpcError: peer error", "cause": cause}
	}
	if strings.HasPrefix(method, "p.f.") && !b.installed {
		failure := wireError("REMOTE_CLOSED", "remote is closed")
		failure["source"] = "@migaia/rpc/remote"
		return nil, failure
	}
	if method == "p.f.request" {
		if len(args) != 1 {
			return nil, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid)
		}
		return args[0], nil
	}
	if method == "p.f.oneWay" {
		if len(args) != 1 {
			return nil, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid)
		}
		b.received = append(b.received, args[0])
		return nil, nil
	}
	if method == "p.f.generator" || method == "p.f.asyncGenerator" || strings.HasPrefix(method, runtimeStreamPrefix) {
		return nil, runtimeFailure("CAPABILITY_UNSUPPORTED", runtimeCapabilityUnavailable)
	}
	return nil, runtimeFailure("PROVIDER_NOT_FOUND", runtimeMethodUnavailable)
}

// native dispatch requires explicit credit before every stream item and records actual abort reasons.
func (b *businessState) native(message record) ([]record, error) {
	data := field(message["data"])
	header := field(data["route"])
	id, _ := message["id"].(string)
	payload := data["payload"]
	switch message["kind"] {
	case "discovery":
		if header["type"] == "discovery-query" {
			return []record{baselineDiscovery(message)}, nil
		}
	case "variation":
		switch header["variation"] {
		case "ping":
			b.pongs++
			reply := businessRoute(message, "variation")
			reply["variation"] = "pong"
			return []record{{"kind": "variation", "id": id, "data": record{"route": reply}}}, nil
		case "abort":
			if _, exists := b.waiting[id]; exists {
				delete(b.waiting, id)
				b.aborts = append(b.aborts, payload)
			}
		case "close":
			b.closes++
			b.closing = true
		}
		return nil, nil
	case "stream":
		state := b.streams[id]
		if state == nil {
			return nil, nil
		}
		control := field(payload)
		if control["event"] == "cancel" {
			delete(b.streams, id)
			return []record{businessStreamFrame(state.request, "cancelled", state.seq, nil)}, nil
		}
		seq, ok := asInt(control["seq"])
		if control["event"] != "pull" || !ok || seq != state.seq {
			return nil, fmt.Errorf("invalid stream credit")
		}
		if state.seq < len(state.items) {
			result := businessStreamFrame(state.request, "item", state.seq, state.items[state.seq])
			state.seq++
			return []record{result}, nil
		}
		delete(b.streams, id)
		return []record{businessStreamFrame(state.request, "end", state.seq, nil)}, nil
	case "request":
		if b.closing {
			return nil, nil
		}
		method, _ := message["method"].(string)
		if method == "peer.wait" {
			if header["dispatchOnly"] == true {
				fmt.Fprintln(os.Stderr, "PEER_ERROR CAPABILITY_UNSUPPORTED")
				return nil, nil
			}
			b.waiting[id] = message
			return nil, nil
		}
		if method == runtimeStreamPrefix+"p.f.generator" || method == runtimeStreamPrefix+"p.f.asyncGenerator" {
			if header["dispatchOnly"] == true {
				fmt.Fprintln(os.Stderr, "PEER_ERROR CAPABILITY_UNSUPPORTED")
				return nil, nil
			}
			if !b.stream {
				return []record{businessResponse(message, nil, runtimeFailure("CAPABILITY_UNSUPPORTED", runtimeCapabilityUnavailable))}, nil
			}
			args, _ := payload.([]any)
			if len(args) != 1 {
				return []record{businessResponse(message, nil, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid))}, nil
			}
			items, ok := args[0].([]any)
			if !ok {
				return []record{businessResponse(message, nil, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid))}, nil
			}
			b.streams[id] = &businessStream{request: message, items: items}
			return []record{businessStreamFrame(message, "open", 0, nil)}, nil
		}
		result, failure := b.invoke(method, payload, header["trace"])
		if header["dispatchOnly"] == true {
			return nil, nil
		}
		return []record{businessResponse(message, result, failure)}, nil
	}
	return nil, nil
}

// serveBusiness reuses the peer's strict native framing and hello parser before serving any business.
func serveBusiness(reader io.Reader, writer io.Writer, host bool, token string, bridge, bare bool) error {
	if bridge {
		if bare {
			for {
				body, err := bridgeBody(reader)
				if err == io.EOF {
					return nil
				}
				if err != nil {
					return err
				}
				// A10 charges one payload parse and serialization to the bare peer too.
				var payload any
				decoder := json.NewDecoder(bytes.NewReader(body))
				decoder.UseNumber()
				if err = decoder.Decode(&payload); err != nil {
					return err
				}
				if control, ok := payload.(map[string]any); ok && control["xrtReverse"] == true {
					result, err := xrtReverse(reader, writer, control, true)
					if err != nil {
						return err
					}
					if err = bridgeSend(writer, result); err != nil {
						return err
					}
					continue
				}
				encoded, err := json.Marshal(payload)
				if err != nil {
					return err
				}
				if err = bridgeWriteBody(writer, encoded); err != nil {
					return err
				}
			}
		}
		return serveBridge(reader, writer, host, token)
	}
	hello, err := receive(reader, true)
	if err != nil {
		return err
	}
	remote, err := parseHello(hello)
	if err != nil {
		return errHandshakeInvalid
	}
	local := businessOffer()
	chosen, ok := negotiate(remote, local)
	if !ok || !baselineAgreement(chosen) || token != "" && hello["auth"] != token {
		return send(writer, rejectRecord("AUTH_REJECTED", "authentication rejected"))
	}
	if err := send(writer, acceptRecord(chosen, local)); err != nil {
		return err
	}
	b := businessState{host: host, installed: !host, stream: slices.Contains(chosen.Capabilities, "stream@1"), received: []any{}, aborts: []any{}, waiting: map[string]record{}, streams: map[string]*businessStream{}}
	for {
		message, err := receive(reader, false)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		members, batched, frameErr := baselineMembers(message)
		if frameErr != nil {
			return frameErr
		}
		for _, message := range members {
			if memberErr := validateBaselineMember(message); memberErr != nil {
				if batched || errors.Is(memberErr, errUnsupportedRuntimeProfile) {
					fmt.Fprintln(os.Stderr, "PEER_ERROR PROTOCOL_INVALID")
					continue
				}
				return memberErr
			}
			method, _ := message["method"].(string)
			if method == "peer.busy" || method == "peer.pause" || method == "peer.crash" {
				if field(field(message["data"])["route"])["dispatchOnly"] != true {
					if err := send(writer, businessResponse(message, "ACK", nil)); err != nil {
						return err
					}
				}
				if method == "peer.crash" {
					os.Exit(17)
				}
				if method == "peer.pause" {
					if err := syscall.Kill(os.Getpid(), syscall.SIGSTOP); err != nil {
						return err
					}
				} else {
					for {
					}
				}
				continue
			}
			replies, err := b.native(message)
			if err != nil {
				if batched {
					fmt.Fprintln(os.Stderr, "PEER_ERROR PROTOCOL_INVALID")
					continue
				}
				return err
			}
			for _, reply := range replies {
				if err := send(writer, reply); err != nil {
					return err
				}
			}
		}
	}
}

// bridgeBody bounds header/body allocations before strict standard-library JSON decoding.
func bridgeBody(reader io.Reader) ([]byte, error) {
	header := []byte{}
	one := make([]byte, 1)
	for !strings.HasSuffix(string(header), "\r\n\r\n") {
		_, err := io.ReadFull(reader, one)
		if err == io.EOF && len(header) == 0 {
			return nil, io.EOF
		}
		if err != nil {
			return nil, err
		}
		if len(header) >= 1024 {
			return nil, fmt.Errorf("invalid bridge header")
		}
		header = append(header, one[0])
	}
	length, count := 0, 0
	for _, line := range strings.Split(string(header), "\r\n") {
		key, raw, ok := strings.Cut(line, ":")
		if ok && strings.EqualFold(key, "content-length") {
			count++
			value, err := strconv.Atoi(strings.TrimSpace(raw))
			if err != nil {
				return nil, err
			}
			length = value
		}
	}
	if count != 1 || length < 1 || length > maxFrameBytes {
		return nil, fmt.Errorf("invalid bridge length")
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	return body, nil
}

// bridgeWriteBody retains only the physical bare carrier used by the existing A10 payload baseline.
func bridgeWriteBody(writer io.Writer, body []byte) error {
	if _, err := fmt.Fprintf(writer, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		return err
	}
	return writeAll(writer, body)
}

// bridgeSend serializes a single response or its ordered JSON-RPC batch on the same physical carrier.
func bridgeSend(writer io.Writer, message any) error {
	body, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return bridgeWriteBody(writer, body)
}

// xrtReverse reuses the original framing/JSON writer and times only foreign logical business.
func xrtReverse(reader io.Reader, writer io.Writer, control record, bare bool) (any, error) {
	n := integerField(control, "count")
	payload, ok := control["payload"].(string)
	if !ok || n < 1 || n > 10000 {
		return nil, errors.New("INVALID_ENVELOPE")
	}
	// Keep one bounded inner-clock observation per actual completed request.
	latencies := make([]int64, 0, n)
	start := time.Now()
	for index := 0; index < n; index++ {
		round := time.Now()
		id := fmt.Sprintf("xrt-reverse-%d", index)
		var request any = payload
		if !bare {
			request = record{"jsonrpc": "2.0", "id": id, "method": "migaia.invoke", "params": record{"method": "bench.echo", "args": []any{payload}}}
		}
		if err := bridgeSend(writer, request); err != nil {
			return nil, err
		}
		reply, err := bridgeReceive(reader)
		if err != nil {
			return nil, err
		}
		valid := false
		if bare {
			text, ok := reply.(string)
			valid = ok && text == payload
		} else {
			message := field(reply)
			valid = message["id"] == id && message["result"] == payload && message["error"] == nil
		}
		if !valid {
			return nil, errors.New("INVALID_ENVELOPE")
		}
		latencies = append(latencies, time.Since(round).Nanoseconds())
	}
	return record{"xrtReceipt": true, "calls": n, "elapsedNs": time.Since(start).Nanoseconds(), "latenciesNs": latencies, "clientInFlightPeak": 1, "burstSize": 1}, nil
}

// serveBridge shares real business state while exposing only negotiated bridge extensions.
func serveBridge(reader io.Reader, writer io.Writer, host bool, token string) error {
	b := businessState{host: host, installed: !host, received: []any{}, aborts: []any{}, waiting: map[string]record{}, streams: map[string]*businessStream{}}
	authenticated := false
	for {
		body, err := bridgeBody(reader)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		var physical any
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.UseNumber()
		if err := decoder.Decode(&physical); err != nil {
			return err
		}
		members, batched := physical.([]any)
		if batched {
			if !authenticated || len(members) == 0 {
				return errors.New("invalid bridge batch")
			}
		} else {
			members = []any{physical}
		}
		replies := []any{}
		for _, member := range members {
			message, valid := member.(map[string]any)
			if !valid || message["jsonrpc"] != "2.0" {
				if batched {
					fmt.Fprintln(os.Stderr, "PEER_ERROR PROTOCOL_INVALID")
					continue
				}
				return errors.New("invalid bridge envelope")
			}
			params := field(message["params"])
			var result any
			var failure record
			switch message["method"] {
			case "migaia.hello":
				var hello record
				decoder := json.NewDecoder(strings.NewReader(params["hello"].(string)))
				decoder.UseNumber()
				if err := decoder.Decode(&hello); err != nil {
					return err
				}
				remote, err := parseHello(hello)
				if err != nil {
					return err
				}
				local := localOffer()
				local.Capabilities = []string{runtimeCapability, batchCapability, "abort@1", "jsonrpc-bridge@1", "wire-error@1", "deadline@1", "trace@1", "idempotency@1"}
				chosen, ok := negotiate(remote, local)
				authenticated = ok && baselineAgreement(chosen) && token != "" && hello["auth"] == token
				reply := rejectRecord("AUTH_REJECTED", "authentication rejected")
				if !ok || !baselineAgreement(chosen) {
					reply = rejectRecord("HANDSHAKE_INCOMPATIBLE", "rpc handshake incompatible: version")
				}
				if authenticated {
					reply = acceptRecord(chosen, local)
				}
				bytes, err := json.Marshal(reply)
				if err != nil {
					return err
				}
				result = record{"reply": string(bytes), "methods": []string{"migaia.hello", "migaia.describe", "migaia.invoke", "migaia.cancel"}}
			case "migaia.cancel":
				if !authenticated {
					return fmt.Errorf("authentication required")
				}
				id, _ := params["id"].(string)
				if _, ok := b.waiting[id]; ok {
					delete(b.waiting, id)
					b.aborts = append(b.aborts, params["reason"])
					replies = append(replies, record{"jsonrpc": "2.0", "id": id, "result": "late-after-cancel"})
				}
				continue
			case "migaia.describe":
				if !authenticated {
					return fmt.Errorf("authentication required")
				}
				result, failure = b.invoke(runtimeDescribeMethod, []any{}, nil)
				description := field(result)
				methods := []any{}
				for _, raw := range entries(description["methods"]) {
					name := stringField(field(raw), "name")
					if name != "peer.pause" && name != "peer.busy" && name != "peer.crash" {
						methods = append(methods, raw)
					}
				}
				// The bounded reverse initiator exists only on this Content-Length profile.
				// Native forward-only Go directories retain their original methods.
				methods = append(methods, record{"name": "peer.reverse", "supportedModes": []string{"request"}, "modeSource": "declared"})
				description["methods"] = methods
			case "migaia.invoke":
				if !authenticated {
					return fmt.Errorf("authentication required")
				}
				called, _ := params["method"].(string)
				args, _ := params["args"].([]any)
				if called == "peer.wait" || called == "p.f.request" && len(args) == 1 && args[0] == "__wait" {
					b.waiting[message["id"].(string)] = message
					continue
				}
				if called == "peer.reverse" && len(args) != 1 {
					result, failure = nil, runtimeFailure("PAYLOAD_INVALID", runtimePayloadInvalid)
				} else if called == "peer.reverse" {
					var err error
					result, err = xrtReverse(reader, writer, field(args[0]), false)
					if err != nil {
						return err
					}
				} else {
					result, failure = b.invoke(called, args, field(params["meta"])["trace"])
				}
			default:
				failure = wireError("METHOD_NOT_FOUND", "bridge peer method unavailable")
			}
			if id, exists := message["id"]; exists {
				reply := record{"jsonrpc": "2.0", "id": id}
				if failure == nil {
					reply["result"] = result
				} else {
					reply["error"] = record{"code": -32000, "message": failure["message"], "data": record{"migaiaWireError": failure}}
				}
				replies = append(replies, reply)
			}
		}
		if len(replies) > 0 {
			var response any = replies
			if !batched {
				response = replies[0]
			}
			if err := bridgeSend(writer, response); err != nil {
				return err
			}
		}
	}
}

// bridgeReceive reuses the exact Content-Length owner for single or batch responses.
func bridgeReceive(reader io.Reader) (any, error) {
	body, err := bridgeBody(reader)
	if err != nil {
		return nil, err
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	err = decoder.Decode(&value)
	return value, err
}

// initiateBridge proves v2 identity and ordered batch isolation using the existing bridge profile.
func initiateBridge(reader io.Reader, writer io.Writer, token string) error {
	if token == "" {
		return errors.New("AUTH_REQUIRED")
	}
	offer := localOffer()
	offer.Capabilities = []string{runtimeCapability, batchCapability, "jsonrpc-bridge@1", "abort@1", "wire-error@1"}
	hello := helloRecord(offer)
	hello["auth"] = token
	encoded, _ := json.Marshal(hello)
	if err := bridgeSend(writer, record{"jsonrpc": "2.0", "id": "hello", "method": "migaia.hello", "params": record{"hello": string(encoded)}}); err != nil {
		return err
	}
	reply, err := bridgeReceive(reader)
	if err != nil {
		return err
	}
	var accepted record
	if json.Unmarshal([]byte(stringField(field(field(reply)["result"]), "reply")), &accepted) != nil || accepted["step"] != "accept" {
		return errors.New("HANDSHAKE_INCOMPATIBLE")
	}
	caps := stringSlice(accepted["capabilities"])
	if !slices.Contains(caps, runtimeCapability) || !slices.Contains(caps, batchCapability) {
		return errors.New("HANDSHAKE_INCOMPATIBLE")
	}
	if err := bridgeSend(writer, record{"jsonrpc": "2.0", "id": "directory", "method": "migaia.describe", "params": record{"args": []any{}}}); err != nil {
		return err
	}
	reply, err = bridgeReceive(reader)
	if err != nil {
		return err
	}
	directory := field(field(reply)["result"])
	if integerField(directory, "schemaVersion") != 2 || field(directory["self"])["instanceId"] != field(accepted["peer"])["id"] {
		return errors.New("CONTRACT_INVALID")
	}
	request := func(id, method string, args []any) record {
		return record{"jsonrpc": "2.0", "id": id, "method": "migaia.invoke", "params": record{"method": method, "args": args}}
	}
	if err := bridgeSend(writer, []any{request("first", "echo", []any{"bridge-first"}), request("missing", "absent", []any{}), request("last", "echo", []any{"bridge-last"})}); err != nil {
		return err
	}
	reply, err = bridgeReceive(reader)
	if err != nil {
		return err
	}
	replies := entries(reply)
	if len(replies) != 3 || field(replies[0])["id"] != "first" || field(replies[1])["id"] != "missing" || field(replies[2])["id"] != "last" || !reflect.DeepEqual(field(replies[0])["result"], []any{"bridge-first"}) || !reflect.DeepEqual(field(replies[2])["result"], []any{"bridge-last"}) || field(field(field(replies[1])["error"])["data"])["migaiaWireError"] == nil {
		return errors.New("INVALID_ENVELOPE")
	}
	if field(field(field(field(replies[1])["error"])["data"])["migaiaWireError"])["code"] != "PROVIDER_NOT_FOUND" {
		return errors.New("INVALID_ENVELOPE")
	}
	fmt.Fprintln(os.Stderr, "RESULT ok")
	return nil
}

// runBusiness selects real owned stdio or a borrowed listener; only inherited/bootstrap bytes carry auth.
func runBusiness(stdio bool, address string, host bool, bootstrap string, authFD int, bridge, bare, descendant bool, initiator bool) error {
	token := ""
	if authFD >= 0 {
		auth := os.NewFile(uintptr(authFD), "auth")
		bytes, err := io.ReadAll(auth)
		auth.Close()
		if err != nil {
			return err
		}
		token = string(bytes)
	}
	if stdio {
		if bootstrap == "stdin" {
			bytes, err := readFrame(os.Stdin)
			if err != nil {
				return err
			}
			token = string(bytes)
		}
		// A real descendant makes EOF ownership observable rather than vacuously empty.
		if descendant {
			child := exec.Command("/bin/sleep", "600")
			if err := child.Start(); err != nil {
				return err
			}
			defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
		}
		fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
		if bridge && initiator {
			return initiateBridge(os.Stdin, os.Stdout, token)
		}
		return serveBusiness(os.Stdin, os.Stdout, host, token, bridge, bare)
	}
	if address == "" || token == "" {
		return fmt.Errorf("authentication required")
	}
	listener, err := net.Listen("unix", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		if err := serveBusiness(conn, conn, host, token, bridge, bare); err != nil {
			fmt.Fprintln(os.Stderr, "PEER_FAIL BUSINESS_SESSION")
		}
		conn.Close()
	}
}
