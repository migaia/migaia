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
	"slices"
	"strconv"
	"strings"
	"syscall"
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
				encoded, err := json.Marshal(payload)
				if err != nil {
					return err
				}
				if err = bridgeWriteBody(writer, encoded); err != nil {
					return err
				}
			}
		}
		return errors.New("UNSUPPORTED")
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

// runBusiness selects real owned stdio or a borrowed listener; only inherited/bootstrap bytes carry auth.
func runBusiness(stdio bool, address string, host bool, bootstrap string, authFD int, bridge, bare, descendant bool) error {
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
