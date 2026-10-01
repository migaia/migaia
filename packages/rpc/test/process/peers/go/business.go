package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
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

// businessState owns one authenticated session's actual Host definition and call receipts.
type businessState struct {
	host, installed, closing bool
	revision, pongs, closes  int
	received, aborts         []any
	waiting                  map[string]record
	streams                  map[string]*businessStream
	contract                 any
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
	case "migaia.remote.describe":
		if b.host {
			return record{"schemaVersion": 1, "catalog": record{"p": b.contract}}, nil
		}
		return b.contract, nil
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
	if !b.installed {
		failure := wireError("REMOTE_CLOSED", "remote is closed")
		failure["source"] = "@migaia/rpc/remote"
		return nil, failure
	}
	if method == "p.f.request" {
		return args[0], nil
	}
	if method == "p.f.oneWay" {
		b.received = append(b.received, args[0])
		return nil, nil
	}
	return nil, wireError("METHOD_NOT_FOUND", "native peer method unavailable")
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
			reply := businessRoute(message, "discovery-response")
			reply["resolvedTargetId"] = header["targetId"]
			reply["receiverId"] = header["targetId"]
			reply["platform"] = "Process"
			return []record{{"kind": "discovery", "id": id, "version": message["version"], "acceptVersions": message["acceptVersions"], "data": record{"route": reply}}}, nil
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
			b.waiting[id] = message
			return nil, nil
		}
		if method == "p.f.generator" || method == "p.f.asyncGenerator" {
			args, _ := payload.([]any)
			items, _ := args[0].([]any)
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
func serveBusiness(reader io.Reader, writer io.Writer, host bool, token string, contract any, bridge, bare bool) error {
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
				if err = bridgeWriteBody(writer, body); err != nil {
					return err
				}
			}
		}
		return serveBridge(reader, writer, host, token, contract)
	}
	hello, err := receive(reader, true)
	if err != nil {
		return err
	}
	remote, err := parseHello(hello)
	if err != nil {
		return errHandshakeInvalid
	}
	chosen, ok := negotiate(remote, localOffer())
	if !ok || token != "" && hello["auth"] != token {
		return send(writer, rejectRecord("AUTH_REJECTED", "authentication rejected"))
	}
	if err := send(writer, acceptRecord(chosen, localOffer())); err != nil {
		return err
	}
	b := businessState{host: host, installed: !host, received: []any{}, aborts: []any{}, waiting: map[string]record{}, streams: map[string]*businessStream{}, contract: contract}
	for {
		message, err := receive(reader, false)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		method, _ := message["method"].(string)
		if method == "peer.busy" || method == "peer.pause" || method == "peer.crash" {
			if err := send(writer, businessResponse(message, "ACK", nil)); err != nil {
				return err
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
			return err
		}
		for _, reply := range replies {
			if err := send(writer, reply); err != nil {
				return err
			}
		}
	}
}

// bridgeReceive bounds header/body allocations before strict standard-library JSON decoding.
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

// bridgeReceive decodes JSON only for RPC; bare echoes the original physical body unchanged.
func bridgeReceive(reader io.Reader) (record, error) {
	body, err := bridgeBody(reader)
	if err != nil {
		return nil, err
	}
	var message record
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&message); err != nil {
		return nil, err
	}
	if message["jsonrpc"] != "2.0" {
		return nil, fmt.Errorf("invalid bridge envelope")
	}
	return message, nil
}

// bridgeSend writes one byte-counted Content-Length response without native control packets.
func bridgeSend(writer io.Writer, message record) error {
	body, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return bridgeWriteBody(writer, body)
}

// bridgeWriteBody is the common carrier writer for physical echo and serialized RPC responses.
func bridgeWriteBody(writer io.Writer, body []byte) error {
	if _, err := fmt.Fprintf(writer, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		return err
	}
	return writeAll(writer, body)
}

// serveBridge shares real business state while exposing only the negotiated bridge extension surface.
func serveBridge(reader io.Reader, writer io.Writer, host bool, token string, contract any) error {
	methods := field(field(field(contract)["features"])["f"])["methods"].(map[string]any)
	delete(methods, "generator")
	delete(methods, "asyncGenerator")
	b := businessState{host: host, installed: !host, received: []any{}, aborts: []any{}, waiting: map[string]record{}, streams: map[string]*businessStream{}, contract: contract}
	authenticated := false
	for {
		message, err := bridgeReceive(reader)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
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
			local.Capabilities = []string{"abort@1", "jsonrpc-bridge@1", "wire-error@1", "deadline@1", "trace@1", "idempotency@1"}
			chosen, ok := negotiate(remote, local)
			authenticated = ok && token != "" && hello["auth"] == token
			reply := rejectRecord("AUTH_REJECTED", "authentication rejected")
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
				if err := bridgeSend(writer, record{"jsonrpc": "2.0", "id": id, "result": "late-after-cancel"}); err != nil {
					return err
				}
			}
			continue
		case "migaia.describe":
			if !authenticated {
				return fmt.Errorf("authentication required")
			}
			result, failure = b.invoke("migaia.remote.describe", []any{}, nil)
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
			result, failure = b.invoke(called, args, field(params["meta"])["trace"])
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
			if err := bridgeSend(writer, reply); err != nil {
				return err
			}
		}
	}
}

// runBusiness selects real owned stdio or a borrowed listener; only inherited/bootstrap bytes carry auth.
func runBusiness(stdio bool, address string, host bool, bootstrap string, authFD int, contractPath string, bridge, bare, descendant bool) error {
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		return err
	}
	var vector record
	if err = json.Unmarshal(raw, &vector); err != nil {
		return err
	}
	contract := field(vector["contracts"].([]any)[0])["value"]
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
		return serveBusiness(os.Stdin, os.Stdout, host, token, contract, bridge, bare)
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
		if err := serveBusiness(conn, conn, host, token, contract, bridge, bare); err != nil {
			fmt.Fprintln(os.Stderr, "PEER_FAIL BUSINESS_SESSION")
		}
		conn.Close()
	}
}
