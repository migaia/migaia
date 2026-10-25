package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"slices"
	"sort"
	"syscall"
	"time"
)

// Actual provider declarations remain independent of semantic protocol and native connection state.
var businessRequestIdempotent = true

const runtimeMethodUnavailable = "Runtime method is not provided by this peer"
const runtimeCapabilityUnavailable = "Runtime operation is not supported by this peer"
const runtimePayloadInvalid = "Runtime method payload is invalid"

// businessStream borrows its fixed task header and the remaining credited generator values only.
type businessStream struct {
	request *orderedRecord
	items   []any
	seq     int
}

// businessState owns the original native session's provider receipts, waits and pull-credit streams.
type businessState struct {
	identity *orderedRecord
	remote   *orderedRecord
	business bool
	closing  bool
	// Only admitted work may arm a native fault after the response handoff.
	pendingFault     string
	pongs, closes    int
	received, aborts []any
	waiting          map[string]*orderedRecord
	streams          map[string]*businessStream
}

// providerModes names actual providers in stable registration order, never map enumeration order.
func providerModes(business bool) []struct {
	name  string
	modes []any
} {
	names := []string{"echo", "peer.echo", "peer.wait", "peer.finish", "peer.error"}
	if business {
		names = []string{"echo", "peer.echo", "peer.received", "peer.aborts", "peer.stats", "peer.trace", "peer.error", "peer.wait", "peer.busy", "peer.pause", "peer.crash", "p.f.request", "p.f.oneWay", "p.f.generator", "p.f.asyncGenerator"}
	}
	methods := make([]struct {
		name  string
		modes []any
	}, 0, len(names))
	for _, name := range names {
		modes := []any{"request", "notify"}
		if name == "peer.wait" || name == "p.f.request" {
			modes = []any{"request"}
		}
		if name == "p.f.oneWay" {
			modes = []any{"notify"}
		}
		if name == "p.f.generator" || name == "p.f.asyncGenerator" {
			modes = []any{"stream"}
		}
		methods = append(methods, struct {
			name  string
			modes []any
		}{name, modes})
	}
	return methods
}

// runtimeDescription derives schema3 directly from the same real provider declaration.
func runtimeDescription(identity *orderedRecord, business bool) *orderedRecord {
	methods := []any{}
	for _, provider := range providerModes(business) {
		method := object("name", provider.name, "supportedModes", provider.modes, "modeSource", "declared")
		if provider.name == "p.f.request" {
			method.set("idempotent", businessRequestIdempotent)
		}
		methods = append(methods, method)
	}
	return object("schemaVersion", 3, "self", identity, "methods", methods)
}

// wireError is the sole flat error constructor; original native fields stay exact.
func wireError(code, message, source string) *orderedRecord {
	return object("root", 0, "nodes", []any{object("source", source, "code", code, "name", "Error", "message", message, "stack", "Error: "+message)})
}
func runtimeFailure(code, message string) *orderedRecord {
	return wireError(code, message, "rpc.endpoint")
}

// operationHeader drops payload/options once the original call has entered pending work.
func operationHeader(message *orderedRecord) *orderedRecord {
	value := field(message)
	return object("id", value["id"], "route", value["route"], "task", value["task"])
}
func businessRoute(message *orderedRecord) *orderedRecord {
	incoming := field(field(message)["route"])
	return route(stringField(incoming, "receiverId"), stringField(incoming, "senderId"), incoming["trace"])
}

// businessResponse echoes the exact selected task, with no legacy response or local error wrapper.
func businessResponse(message *orderedRecord, value any, present bool, failure *orderedRecord) *orderedRecord {
	original := field(message)
	kind := "result"
	if failure != nil {
		kind = "error"
	}
	result := object("profile", protocol, "kind", kind, "id", original["id"], "route", businessRoute(message), "task", original["task"])
	if failure != nil {
		result.set("error", failure)
	} else if present {
		result.set("result", value)
	}
	return result
}
func businessStreamFrame(message *orderedRecord, event string, seq int, value any) *orderedRecord {
	original := field(message)
	payload := object("event", event, "seq", seq)
	if event == "item" {
		payload.set("value", value)
	}
	return object("profile", protocol, "kind", "stream", "id", original["id"], "route", businessRoute(message), "task", original["task"], "stream", payload)
}

// newBusiness reserves no second pending owner; the same native loop drives all operations.
func newBusiness(identity, remote *orderedRecord, business bool) *businessState {
	return &businessState{identity: identity, remote: remote, business: business, received: []any{}, aborts: []any{}, waiting: map[string]*orderedRecord{}, streams: map[string]*businessStream{}}
}

// invoke retains original scalar/notification/error behavior and original supported payload guards.
func (state *businessState) invoke(method string, payload, trace any) (any, *orderedRecord) {
	args, _ := payload.([]any)
	switch method {
	case "echo", "peer.echo":
		return payload, nil
	case "peer.received":
		return object("count", len(state.received), "values", state.received), nil
	case "peer.aborts":
		return state.aborts, nil
	case "peer.stats":
		return object("pongs", state.pongs, "closes", state.closes, "pid", os.Getpid()), nil
	case "peer.trace":
		return trace, nil
	case "peer.error":
		if !state.business {
			return nil, wireError("PEER_ERROR", "peer requested error", "rpc.transport.process")
		}
		cause := object("source", "rpc.endpoint", "code", "INTERNAL", "name", "Error", "message", "peer cause", "stack", "Error: peer cause")
		root := object("source", "rpc.endpoint", "code", "INTERNAL", "name", "RpcError", "message", "peer error", "stack", "RpcError: peer error", "cause", 1)
		return nil, object("root", 0, "nodes", []any{root, cause})
	case "p.f.request":
		if len(args) != 1 {
			return nil, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid)
		}
		return args[0], nil
	case "p.f.oneWay":
		if len(args) != 1 {
			return nil, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid)
		}
		state.received = append(state.received, args[0])
		return nil, nil
	}
	return nil, runtimeFailure("PROVIDER_NOT_FOUND", runtimeMethodUnavailable)
}

// admitted checks the actual native source, final receiver/target and the selected task generations.
func (state *businessState) admitted(message *orderedRecord) bool {
	value := field(message)
	routing := field(value["route"])
	localID := field(state.identity)["instanceId"]
	remoteSelf := field(field(state.remote)["self"])
	if routing["senderId"] != remoteSelf["instanceId"] || routing["receiverId"] != localID || routing["targetId"] != localID {
		return false
	}
	if value["kind"] == "call" || value["kind"] == "group" || value["kind"] == "cancel" || value["kind"] == "stream" {
		task := field(value["task"])
		return task["callerId"] == remoteSelf["instanceId"] && runtimeSchemaEqual(task["callerGeneration"], remoteSelf["generation"]) && runtimeSchemaEqual(task["targetGeneration"], field(state.identity)["generation"])
	}
	return true
}

// native dispatch owns request/notify completion, original cancel reasons, and one credit per item.
func (state *businessState) native(message *orderedRecord) ([]*orderedRecord, error) {
	if !state.admitted(message) {
		return nil, nil
	}
	value := field(message)
	id := stringField(value, "id")
	task := field(value["task"])
	switch value["kind"] {
	case "control":
		if value["operation"] == "ping" {
			state.pongs++
			return []*orderedRecord{object("profile", protocol, "kind", "control", "id", id, "route", businessRoute(message), "operation", "pong")}, nil
		}
		if value["operation"] == "drain" {
			state.closes++
			state.closing = true
		}
		return nil, nil
	case "directory":
		incoming := field(value["directory"])
		if !runtimeSchemaEqual(incoming["self"], field(state.remote)["self"]) {
			return nil, errProtocol
		}
		state.remote = value["directory"].(*orderedRecord)
		return nil, nil
	case "cancel":
		if pending := state.waiting[id]; pending != nil && runtimeSchemaEqual(field(pending)["task"], value["task"]) {
			delete(state.waiting, id)
			reason := field(value["reason"])
			if reason != nil {
				state.aborts = append(state.aborts, entries(reason["nodes"])[integerField(reason, "root")])
			} else {
				state.aborts = append(state.aborts, nil)
			}
		}
		if pending := state.streams[id]; pending != nil && runtimeSchemaEqual(field(pending.request)["task"], value["task"]) {
			delete(state.streams, id)
			return []*orderedRecord{businessStreamFrame(pending.request, "cancelled", pending.seq, nil)}, nil
		}
		return nil, nil
	case "stream":
		return state.streamControl(message)
	case "call", "group":
		if state.closing {
			return nil, nil
		}
		if value["kind"] == "group" {
			outcomes := []any{}
			failed := false
			for _, raw := range entries(value["steps"]) {
				if failed {
					outcomes = append(outcomes, object("state", "not-executed"))
					continue
				}
				step := field(raw)
				result, failure := state.invoke(stringField(step, "method"), step["payload"], field(value["route"])["trace"])
				if failure != nil {
					failed = true
					outcomes = append(outcomes, object("state", "failure", "error", failure))
				} else {
					outcomes = append(outcomes, object("state", "success", "result", result))
				}
			}
			return []*orderedRecord{businessResponse(message, outcomes, true, nil)}, nil
		}
		method, mode := stringField(task, "method"), stringField(task, "mode")
		declared := false
		supported := false
		for _, provider := range providerModes(state.business) {
			if provider.name == method {
				declared = true
				supported = slices.Contains(provider.modes, any(mode))
				break
			}
		}
		if !supported {
			failure := runtimeFailure("PROVIDER_NOT_FOUND", runtimeMethodUnavailable)
			if declared {
				failure = runtimeFailure("CAPABILITY_UNSUPPORTED", runtimeCapabilityUnavailable)
			}
			if mode == "notify" {
				return nil, nil
			}
			return []*orderedRecord{businessResponse(message, nil, false, failure)}, nil
		}
		if method == "peer.wait" {
			state.waiting[id] = operationHeader(message)
			return nil, nil
		}
		if mode == "stream" {
			args := entries(value["payload"])
			if len(args) != 1 {
				return []*orderedRecord{businessResponse(message, nil, false, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid))}, nil
			}
			items, ok := args[0].([]any)
			if !ok {
				return []*orderedRecord{businessResponse(message, nil, false, runtimeFailure("CONTRACT_INVALID", runtimePayloadInvalid))}, nil
			}
			state.streams[id] = &businessStream{request: operationHeader(message), items: items}
			return []*orderedRecord{businessStreamFrame(message, "open", 0, nil)}, nil
		}
		if method == "peer.finish" {
			ids := make([]string, 0, len(state.waiting))
			for id := range state.waiting {
				ids = append(ids, id)
			}
			// Original independent fixture ordering: sort only pending IDs at explicit peer.finish, never wire keys.
			sort.Strings(ids)
			replies := []*orderedRecord{}
			for _, id := range ids {
				replies = append(replies, businessResponse(state.waiting[id], nil, false, nil))
				delete(state.waiting, id)
			}
			payload, present := value["payload"]
			if mode != "notify" {
				replies = append(replies, businessResponse(message, payload, present, nil))
			}
			return replies, nil
		}
		if method == "peer.busy" || method == "peer.pause" || method == "peer.crash" {
			state.pendingFault = method
			if mode != "notify" {
				return []*orderedRecord{businessResponse(message, "ACK", true, nil)}, nil
			}
			return nil, nil
		}
		result, failure := state.invoke(method, value["payload"], field(value["route"])["trace"])
		if mode == "notify" {
			return nil, nil
		}
		present := true
		if !state.business && (method == "echo" || method == "peer.echo") {
			_, present = value["payload"]
		}
		return []*orderedRecord{businessResponse(message, result, present, failure)}, nil
	}
	return nil, nil
}

// streamControl owns only original pull-credit state; source/task admission remains in native.
func (state *businessState) streamControl(message *orderedRecord) ([]*orderedRecord, error) {
	value := field(message)
	id := stringField(value, "id")
	pending := state.streams[id]
	if pending == nil || !runtimeSchemaEqual(field(pending.request)["task"], value["task"]) {
		return nil, nil
	}
	control := field(value["stream"])
	if control["event"] == "finish-without-items" {
		delete(state.streams, id)
		return []*orderedRecord{businessStreamFrame(pending.request, "end", pending.seq, nil)}, nil
	}
	if control["event"] != "pull" || integerField(control, "seq") != pending.seq {
		return nil, errProtocol
	}
	if pending.seq < len(pending.items) {
		result := businessStreamFrame(pending.request, "item", pending.seq, pending.items[pending.seq])
		pending.seq++
		return []*orderedRecord{result}, nil
	}
	delete(state.streams, id)
	return []*orderedRecord{businessStreamFrame(pending.request, "end", pending.seq, nil)}, nil
}

// nativeRead owns the original bounded reader slot and the old drain timer's explicit cancellation.
type nativeRead struct {
	message *orderedRecord
	err     error
}

// readNative keeps the old single reader; closing a session cannot leave it blocked publishing a result.
func readNative(reader io.Reader, inbound chan<- nativeRead, done <-chan struct{}) {
	for {
		message, err := receive(reader, false)
		select {
		case inbound <- nativeRead{message, err}:
		case <-done:
			return
		}
		if err != nil {
			return
		}
	}
}

// serveBusiness migrates the original reader/drain select loop; native work still owns one pending table.
func serveBusiness(reader io.Reader, writer io.Writer, identity *orderedRecord, token, parent string, business bool) error {
	remote, err := handshake(reader, writer, localOffer(identity, business), token, parent)
	if err != nil {
		return err
	}
	state := newBusiness(identity, field(remote)["directory"].(*orderedRecord), business)
	defer clear(state.waiting)
	defer clear(state.streams)
	inbound := make(chan nativeRead, 1)
	done := make(chan struct{})
	defer close(done)
	go readNative(reader, inbound, done)
	var timer *time.Timer
	var deadline <-chan time.Time
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	for {
		var received nativeRead
		select {
		case received = <-inbound:
		case <-deadline:
			return nil
		}
		if received.err == io.EOF {
			return nil
		}
		if received.err != nil {
			return received.err
		}
		message := received.message
		if !validFrame(message) {
			return errProtocol
		}
		replies, err := state.native(message)
		if err != nil {
			return err
		}
		for _, reply := range replies {
			if err := send(writer, reply); err != nil {
				return err
			}
		}
		method := state.pendingFault
		state.pendingFault = ""
		if method == "peer.crash" {
			os.Exit(17)
		}
		if method == "peer.pause" {
			if err := syscall.Kill(os.Getpid(), syscall.SIGSTOP); err != nil {
				return err
			}
		}
		if method == "peer.busy" {
			for {
			}
		}
		if state.closing {
			if len(state.waiting) == 0 && len(state.streams) == 0 {
				return nil
			}
			if timer == nil {
				remaining, _ := field(field(message)["route"])["remainingMs"].(float64)
				if remaining <= 0 {
					return nil
				}
				timer = time.NewTimer(time.Duration(remaining * float64(time.Millisecond)))
				deadline = timer.C
			}
		}
	}
}

// nativeBootstrap adopts only the actual private version1 launch record, never semantic v1.
func nativeBootstrap(reader io.Reader) (*orderedRecord, string, string, error) {
	value, err := receive(reader, true)
	if err != nil {
		return nil, "", "", err
	}
	fields := field(value)
	identity := field(fields["self"])
	if !hasFields(value, []string{"kind", "version", "self", "parentInstanceId", "token"}) || fields["kind"] != "rpc-runtime-api-bootstrap" || integerField(fields, "version") != 1 || !hasFields(fields["self"], []string{"name", "instanceId"}) || !identifier(identity["name"]) || !identifier(identity["instanceId"]) || !identifier(fields["parentInstanceId"]) || stringField(fields, "token") == "" {
		return nil, "", "", errHandshakeInvalid
	}
	generation, present := fields["generation"]
	if !present {
		generation = object("kind", "session", "value", 0, "providerId", identity["instanceId"])
	}
	if !validGeneration(generation) {
		return nil, "", "", errProtocol
	}
	return object("name", identity["name"], "instanceId", identity["instanceId"], "generation", generation), stringField(fields, "token"), stringField(fields, "parentInstanceId"), nil
}

// runBusiness preserves original owned stdio/descendant and reusable borrowed listener lifetimes.
func runBusiness(stdio bool, address, bootstrap string, authFD int, descendant, bareJSON bool) error {
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
		if bareJSON {
			fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
			return runJSONBaseline(os.Stdin, os.Stdout)
		}
		identity, parent := localIdentity(), ""
		if bootstrap == "stdin" {
			var err error
			identity, token, parent, err = nativeBootstrap(os.Stdin)
			if err != nil {
				return err
			}
		}
		if descendant {
			child := exec.Command("/bin/sleep", "600")
			if err := child.Start(); err != nil {
				return err
			}
			defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
		}
		fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
		return serveBusiness(os.Stdin, os.Stdout, identity, token, parent, true)
	}
	if address == "" || token == "" {
		return errHandshakeInvalid
	}
	listener, err := net.Listen("unix", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
	for {
		connection, err := listener.Accept()
		if err != nil {
			return err
		}
		if err := serveBusiness(connection, connection, localIdentity(), token, "", true); err != nil {
			fmt.Fprintln(os.Stderr, "PEER_FAIL BUSINESS_SESSION")
		}
		connection.Close()
	}
}
