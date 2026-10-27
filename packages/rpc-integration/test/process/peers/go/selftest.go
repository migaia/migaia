package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// vectorSuite retains the original exact per-case PASS/FAIL/PENDING receipt channel.
type vectorSuite struct{ passed, failed, pending int }

func (suite *vectorSuite) check(name string, ok bool) {
	if ok {
		suite.passed++
		fmt.Printf("PASS %s\n", name)
	} else {
		suite.failed++
		fmt.Printf("FAIL %s\n", name)
	}
}
func (suite *vectorSuite) unavailable(name string) { suite.pending++; fmt.Printf("PENDING %s\n", name) }

// loadVector shares the real peer's sole ordered JSON parser, not a second accepted grammar.
func loadVector(path string) (*orderedRecord, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	value, err := readJSON(content)
	result, ok := value.(*orderedRecord)
	if err != nil || !ok {
		return nil, errProtocol
	}
	return result, nil
}

// coreVectors executes every canonical case through the same parser used by actual native dispatch.
func coreVectors(suite *vectorSuite, directory string) {
	vector, err := loadVector(filepath.Join(directory, "core-profile.json"))
	if err != nil {
		suite.unavailable("core-profile")
		return
	}
	for _, section := range []string{"valid", "invalid"} {
		for _, raw := range entries(field(vector)[section]) {
			entry := field(raw)
			suite.check(stringField(entry, "id"), validFrame(entry["frame"]) == (section == "valid"))
		}
	}
	for _, raw := range entries(field(vector)["unknownIgnored"]) {
		entry := field(raw)
		frame := entry["frame"]
		accepted := validFrame(frame) && validFrame(entry["baseline"])
		target := frame
		for _, key := range strings.Split(stringField(entry, "pointer"), "/")[1:] {
			if members, ok := target.([]any); ok {
				index, _ := strconv.Atoi(key)
				target = members[index]
			} else {
				target = field(target)[key]
			}
		}
		fields := field(target)
		_, first := fields["futureA"]
		_, second := fields["futureB"]
		delete(fields, "futureA")
		delete(fields, "futureB")
		suite.check(stringField(entry, "id"), accepted && first && second && runtimeSchemaEqual(frame, entry["baseline"]))
	}

}

// requestFor authors actual direct task/generation headers for the original independent runtime checks.
func requestFor(id, method, mode string, payload any, local, remote *orderedRecord) *orderedRecord {
	caller, target := field(remote), field(local)
	task := object("mode", mode, "callerId", caller["instanceId"], "callerGeneration", caller["generation"], "targetGeneration", target["generation"], "method", method)
	return object("profile", protocol, "kind", "call", "id", id, "route", route(stringField(caller, "instanceId"), stringField(target, "instanceId"), nil), "task", task, "options", object(), "payload", payload)
}
func remoteIdentity() *orderedRecord {
	return object("name", "baseline-checker", "instanceId", "baseline-checker", "generation", object("kind", "session", "value", 0, "providerId", "baseline-checker"))
}
func errorRoot(value any) record {
	graph := field(value)
	nodes := entries(graph["nodes"])
	index, ok := asInt(graph["root"])
	if !ok || index >= len(nodes) {
		return nil
	}
	return field(nodes[index])
}

// runtimeChecks keeps original frame, scalar, no-reply, error, cancel, finish, health and privacy assertions.
// finishOrderChecks proves pending completion follows lexical request-ID order.
func finishOrderChecks(suite *vectorSuite) {
	local, remote := localIdentity(), remoteIdentity()
	state := newBusiness(local, runtimeDescription(remote, false), false)
	for _, id := range []string{"z", "a", "m"} {
		_, _ = state.native(requestFor(id, "peer.wait", "request", nil, local, remote))
	}
	replies, err := state.native(requestFor("finish", "peer.finish", "request", nil, local, remote))
	ids := []string{}
	for _, reply := range replies {
		ids = append(ids, stringField(field(reply), "id"))
	}
	suite.check("finish-lexical-order", err == nil && strings.Join(ids, ",") == "a,m,z,finish")

}

// waitingLifecycleChecks keeps cancellation and ID reuse correct through an ordered drain.
func waitingLifecycleChecks(suite *vectorSuite) {
	local, remote := localIdentity(), remoteIdentity()
	state := newBusiness(local, runtimeDescription(remote, false), false)
	// The fixture contains exactly 128 IDs; padded decimal spelling is their lexical order.
	for index := 127; index >= 0; index-- {
		id := fmt.Sprintf("%03d", index)
		_, _ = state.native(requestFor(id, "peer.wait", "request", nil, local, remote))
	}
	for index := 0; index < 128; index += 2 {
		id := fmt.Sprintf("%03d", index)
		request := requestFor(id, "peer.wait", "request", nil, local, remote)
		cancel := object("profile", protocol, "kind", "cancel", "id", id, "route", field(request)["route"], "task", field(request)["task"])
		_, _ = state.native(cancel)
	}
	for index := 0; index < 128; index += 4 {
		_, _ = state.native(requestFor(fmt.Sprintf("%03d", index), "peer.wait", "request", nil, local, remote))
	}
	replies, err := state.native(requestFor("finish", "peer.finish", "request", nil, local, remote))
	expected := []string{}
	for index := 0; index < 128; index++ {
		if index%2 != 0 || index%4 == 0 {
			expected = append(expected, fmt.Sprintf("%03d", index))
		}
	}
	expected = append(expected, "finish")
	actual := []string{}
	for _, reply := range replies {
		actual = append(actual, stringField(field(reply), "id"))
	}
	suite.check("pending-cancel-reuse-lexical-drain", err == nil && strings.Join(actual, ",") == strings.Join(expected, ",") && len(state.waiting) == 0 && state.waitingOrder == nil)
}

func runtimeChecks(suite *vectorSuite) {
	finishOrderChecks(suite)
	waitingLifecycleChecks(suite)
	var baseline bytes.Buffer
	baselineErr := runJSONBaseline(strings.NewReader("Content-Length: 25\r\n\r\n [ 1, \"baseline\", null ] "), &baseline)
	suite.check("runtime/pure-json-baseline", baselineErr == nil && baseline.String() == "Content-Length: 19\r\n\r\n[1,\"baseline\",null]")
	var framed bytes.Buffer
	writeErr := writeFrame(&framed, []byte("x"))
	payload, readErr := readFrame(&framed, maxFrameBytes)
	suite.check("runtime/framing/roundtrip", writeErr == nil && readErr == nil && bytes.Equal(payload, []byte("x")))
	_, zeroErr := readFrame(bytes.NewReader([]byte{0, 0, 0, 0}), maxFrameBytes)
	suite.check("runtime/framing/zero", zeroErr != nil)
	_, oversizedErr := readFrame(bytes.NewReader([]byte{1, 0, 0, 1}), maxFrameBytes)
	suite.check("runtime/framing/oversized-header", oversizedErr != nil)
	suite.check("runtime/framing/empty-write", writeFrame(&bytes.Buffer{}, nil) != nil)
	var malformed bytes.Buffer
	_ = writeFrame(&malformed, []byte{0xff})
	_, utf8Err := receive(&malformed, false)
	suite.check("runtime/framing/invalid-utf8", utf8Err != nil)
	local, remote := localIdentity(), remoteIdentity()
	state := newBusiness(local, runtimeDescription(remote, false), false)
	request := requestFor("one", "peer.echo", "request", "x", local, remote)
	replies, err := state.native(request)
	suite.check("runtime/request/echo", err == nil && len(replies) == 1 && field(replies[0])["kind"] == "result" && field(replies[0])["result"] == "x")
	field(field(request)["task"])["mode"] = "notify"
	oneWay, oneWayErr := state.native(request)
	suite.check("runtime/request/one-way", oneWayErr == nil && oneWay == nil)
	request = requestFor("one", "peer.error", "request", nil, local, remote)
	failures, errorErr := state.native(request)
	wire := record(nil)
	if len(failures) == 1 {
		wire = errorRoot(field(failures[0])["error"])
	}
	suite.check("runtime/request/wire-error", errorErr == nil && len(failures) == 1 && field(failures[0])["kind"] == "error" && wire["code"] == "PEER_ERROR" && wire["stack"] != "")
	missing, missingErr := state.native(requestFor("missing", "missing-method", "request", nil, local, remote))
	suite.check("runtime/request/method-not-found", missingErr == nil && len(missing) == 1 && errorRoot(field(missing[0])["error"])["code"] == "PROVIDER_NOT_FOUND")
	wait := requestFor("one", "peer.wait", "request", nil, local, remote)
	_, _ = state.native(wait)
	cancel := object("profile", protocol, "kind", "cancel", "id", "one", "route", field(wait)["route"], "task", field(wait)["task"], "reason", wireError("CANCELLED", "stop", "rpc.endpoint"))
	_, abortErr := state.native(cancel)
	_, stillPending := state.waiting["one"]
	suite.check("runtime/control/abort", abortErr == nil && !stillPending)
	_, _ = state.native(wait)
	finished, finishErr := state.native(requestFor("finish", "peer.finish", "request", nil, local, remote))
	suite.check("runtime/request/finish-wait", finishErr == nil && len(finished) == 2 && field(finished[0])["id"] == "one" && field(finished[0])["kind"] == "result" && field(finished[1])["id"] == "finish" && field(finished[1])["kind"] == "result")
	ping := object("profile", protocol, "kind", "control", "id", "ping-1", "route", field(wait)["route"], "operation", "ping")
	pong, pingErr := state.native(ping)
	suite.check("runtime/control/ping", pingErr == nil && len(pong) == 1 && field(pong[0])["id"] == "ping-1" && field(pong[0])["operation"] == "pong")
	drain := object("profile", protocol, "kind", "control", "id", "close-1", "route", field(wait)["route"], "operation", "drain")
	_, closeErr := state.native(drain)
	suite.check("runtime/control/close", closeErr == nil && state.closing && state.closes == 1)
	field(field(drain)["route"])["remainingMs"] = float64(-1)
	suite.check("runtime/control/invalid-close", !validFrame(drain))
	secret := "SENTINEL_NATIVE_PEER_AUTH_9D8C"
	hello := localOffer(remote, false)
	hello.set("profile", "other-protocol")
	hello.set("auth", object("token", secret))
	var inbound, outbound bytes.Buffer
	_ = send(&inbound, hello)
	_ = responder(&inbound, &outbound)
	suite.check("runtime/secret/incompatible-hello", !bytes.Contains(outbound.Bytes(), []byte(secret)))
	malformedHello := localOffer(remote, false)
	malformedHello.set("versions", []any{})
	malformedHello.set("auth", object("token", secret))
	inbound.Reset()
	outbound.Reset()
	_ = send(&inbound, malformedHello)
	badErr := responder(&inbound, &outbound)
	suite.check("runtime/secret/malformed-hello", badErr != nil && !strings.Contains(badErr.Error(), secret) && !bytes.Contains(outbound.Bytes(), []byte(secret)))
}

// nativeBusinessChecks moves original ordered notification/missing-provider/receipt assertions off JSON-RPC.
func nativeBusinessChecks(suite *vectorSuite) {
	local, remote := localIdentity(), remoteIdentity()
	var input, output bytes.Buffer
	_ = send(&input, localOffer(remote, false))
	_ = send(&input, acceptance(localOffer(remote, false)))
	notify := requestFor("notify", "p.f.oneWay", "notify", []any{"receipt"}, local, remote)
	_ = send(&input, notify)
	_ = send(&input, requestFor("missing", "absent", "request", []any{}, local, remote))
	_ = send(&input, requestFor("received", "peer.received", "request", []any{}, local, remote))
	err := serveBusiness(&input, &output, local, "", "", true)
	hello, helloErr := receive(&output, true)
	accept, acceptErr := receive(&output, true)
	description := field(field(hello)["directory"])
	identity := field(description["self"])
	suite.check("describe/business-host-false", err == nil && helloErr == nil && integerField(description, "schemaVersion") == 3 && identity["name"] == "go-peer" && identity["instanceId"] == "go-peer" && validRuntimeDescription(field(hello)["directory"], "go-peer"))
	suite.check("bridge/baseline", acceptErr == nil && field(accept)["step"] == "accept" && field(accept)["profile"] == protocol)
	first, firstErr := receive(&output, false)
	second, secondErr := receive(&output, false)
	// Appends one final close after every original business response and before EOF.
	closing, closingErr := receive(&output, false)
	_, eof := receive(&output, false)
	received := field(field(second)["result"])
	suite.check("bridge/v2-batch-notification-isolation", err == nil && firstErr == nil && secondErr == nil && closingErr == nil && field(closing)["kind"] == "control" && field(closing)["operation"] == controlClose && errorRoot(field(closing)["reason"])["code"] == "ENDPOINT_DISPOSED" && eof == io.EOF && field(first)["id"] == "missing" && errorRoot(field(first)["error"])["code"] == "PROVIDER_NOT_FOUND" && field(second)["id"] == "received" && integerField(received, "count") == 1 && runtimeSchemaEqual(received["values"], []any{"receipt"}))
	// Both old directories advertised echo request/notify and peer.wait request-only; schema3 preserves that rule.
	echo, wait := false, false
	for _, raw := range entries(description["methods"]) {
		method := field(raw)
		if method["name"] == "echo" {
			echo = runtimeSchemaEqual(method["supportedModes"], []any{"request", "notify"})
		}
		if method["name"] == "peer.wait" {
			wait = runtimeSchemaEqual(method["supportedModes"], []any{"request"})
		}
	}
	suite.check("describe/modes", echo && wait)
	state := newBusiness(local, runtimeDescription(remote, false), true)
	replies, waitErr := state.native(requestFor("wait-notify", "peer.wait", "notify", nil, local, remote))
	suite.check("modes/wait-notify-no-pending-host-false", waitErr == nil && len(replies) == 0 && len(state.waiting) == 0)
	_, oldFailure := state.invoke("migaia.remote.describe", nil, nil)
	suite.check("describe/v1-removed-host-false", oldFailure != nil && errorRoot(oldFailure)["code"] == "PROVIDER_NOT_FOUND")
}

// siblingChecks preserves first/missing/last business reply values and order in coalesced canonical frames.
func siblingChecks(suite *vectorSuite) {
	for _, business := range []bool{false, true} {
		local, remote := localIdentity(), remoteIdentity()
		var input, output bytes.Buffer
		_ = send(&input, localOffer(remote, false))
		_ = send(&input, acceptance(localOffer(remote, false)))
		_ = send(&input, requestFor("first", "echo", "request", "one", local, remote))
		_ = send(&input, requestFor("missing", "not-provided", "request", nil, local, remote))
		_ = send(&input, requestFor("last", "echo", "request", "two", local, remote))
		sessionErr := serveBusiness(&input, &output, local, "", "", business)
		hello, helloErr := receive(&output, true)
		_, acceptErr := receive(&output, true)
		suite.check(fmt.Sprintf("describe/live-business-%t", business), sessionErr == nil && helloErr == nil && acceptErr == nil && validRuntimeDescription(field(hello)["directory"], "go-peer"))
		first, firstErr := receive(&output, false)
		missing, missingErr := receive(&output, false)
		last, lastErr := receive(&output, false)
		// Keep the original ordered sibling assertions and strengthen the final native close boundary.
		closing, closingErr := receive(&output, false)
		_, eof := receive(&output, false)
		suite.check(fmt.Sprintf("batch/member-isolation-business-%t", business), sessionErr == nil && firstErr == nil && missingErr == nil && lastErr == nil && closingErr == nil && field(closing)["kind"] == "control" && field(closing)["operation"] == controlClose && errorRoot(field(closing)["reason"])["code"] == "ENDPOINT_DISPOSED" && eof == io.EOF && field(first)["id"] == "first" && field(first)["result"] == "one" && field(missing)["id"] == "missing" && errorRoot(field(missing)["error"])["code"] == "PROVIDER_NOT_FOUND" && field(last)["id"] == "last" && field(last)["result"] == "two")
	}
}

// upgradeDirectoryFixture changes only retired schema2 authoring metadata, never production admission.
func upgradeDirectoryFixture(value *orderedRecord) {
	if field(value)["schemaVersion"] == float64(2) {
		value.set("schemaVersion", 3)
	}
	if identity, ok := field(value)["self"].(*orderedRecord); ok {
		identity.set("generation", object("kind", "session", "value", 0, "providerId", field(identity)["instanceId"]))
	}
}

// schemaVectors keeps every method-schema assertion; only the enclosing retired directory version changes.
func schemaVectors(suite *vectorSuite, directory string) {
	vector, err := loadVector(filepath.Join(directory, "description-schema.json"))
	if err != nil {
		suite.unavailable("description-schema")
		return
	}
	for _, raw := range entries(field(vector)["cases"]) {
		entry := field(raw)
		value, ok := entry["value"].(*orderedRecord)
		if !ok {
			suite.unavailable("description-schema/" + stringField(entry, "id"))
			continue
		}
		identity, ok := field(value)["self"].(*orderedRecord)
		if !ok {
			suite.check("description-schema.json/"+stringField(entry, "id"), entry["valid"] == false)
			continue
		}
		upgradeDirectoryFixture(value)
		suite.check("description-schema.json/"+stringField(entry, "id"), validRuntimeDescription(value, stringField(field(identity), "instanceId")) == (entry["valid"] == true))
	}
	baseline, err := loadVector(filepath.Join(directory, "runtime-description.json"))
	if err != nil {
		suite.unavailable("runtime-description")
		return
	}
	for _, section := range []string{"valid", "invalid"} {
		for index, raw := range entries(field(baseline)[section]) {
			value := raw.(*orderedRecord)
			upgradeDirectoryFixture(value)
			suite.check(fmt.Sprintf("runtime-description.json/%s/%d", section, index), validRuntimeDescription(value, stringField(field(field(value)["self"]), "instanceId")) == (section == "valid"))
		}
	}
}

// canonicalVectors retains real bytes for comparison with the existing serialize JSON owner.
func canonicalVectors(suite *vectorSuite, directory string) {
	vector, err := loadVector(filepath.Join(directory, "canonical.json"))
	if err != nil {
		suite.unavailable("canonical")
		return
	}
	for _, raw := range entries(field(vector)["cases"]) {
		entry := field(raw)
		value, present := entry["value"]
		id := stringField(entry, "id")
		if !present {
			suite.unavailable("canonical/" + id)
			continue
		}
		encoded, err := appendJSON(nil, value)
		suite.check("canonical/"+id, err == nil)
		if err == nil {
			fmt.Printf("CANONICAL %s %s\n", id, hex.EncodeToString(encoded))
		}
	}
	// These real wire objects specifically expose the previous map-sorting/HTML-escaping regression.
	encoded, err := appendJSON(nil, object("z", 1, "a", "<>&\u2028\u2029", "nested", object("second", 2, "first", 1)))
	suite.check("canonical/own-order-and-no-html-escape", err == nil && string(encoded) == "{\"z\":1,\"a\":\"<>&\u2028\u2029\",\"nested\":{\"second\":2,\"first\":1}}")
}

// runSelftest keeps the original entry point and fails any missing/failed canonical case.
func runSelftest(directory string) int {
	suite := &vectorSuite{}
	if directory == "" {
		fmt.Fprintln(os.Stderr, "ERROR --vectors is required")
		return 2
	}
	coreVectors(suite, directory)
	runtimeChecks(suite)
	nativeBusinessChecks(suite)
	siblingChecks(suite)
	schemaVectors(suite, directory)
	canonicalVectors(suite, directory)
	streamVectorChecks(suite, directory)
	framingVectorChecks(suite, directory)
	flatErrorPolicyChecks(suite)
	originalErrorVectors(suite, directory)
	fmt.Printf("SUMMARY passed=%d failed=%d pending=%d\n", suite.passed, suite.failed, suite.pending)
	if suite.failed != 0 || suite.pending != 0 {
		return 1
	}
	return 0
}

// expandFrame expands binary vector specifications independently of JSON wire encoding.
func expandFrame(value any) []byte {
	if text, ok := value.(string); ok {
		raw, err := hex.DecodeString(text)
		if err != nil {
			panic(err)
		}
		return raw
	}
	spec := field(value)
	raw, err := hex.DecodeString(stringField(spec, "repeatHex"))
	if err != nil {
		panic(err)
	}
	return bytes.Repeat(raw, integerField(spec, "count"))
}

// framingVectors preserves chunk boundaries and compares bytes and first error classification.
func framingVectors(suite *vectorSuite, vectors []any) {
	for _, item := range vectors {
		entry := field(item)
		chunks := entries(entry["chunksHex"])
		if chunks == nil {
			chunks = entries(entry["chunks"])
		}
		readers := []io.Reader{}
		for _, chunk := range chunks {
			readers = append(readers, bytes.NewReader(expandFrame(chunk)))
		}
		var wire []byte
		for _, chunk := range chunks {
			wire = append(wire, expandFrame(chunk)...)
		}
		reader := io.MultiReader(readers...)
		actual := [][]byte{}
		code := ""
		for {
			frame, err := readFrame(reader, maxFrameBytes)
			if err == io.EOF {
				break
			}
			if err != nil {
				code = "INVALID_FRAME"
				consumed := 0
				for _, frame := range actual {
					consumed += 4 + len(frame)
				}
				if len(wire)-consumed >= 4 && binary.BigEndian.Uint32(wire[consumed:consumed+4]) > maxFrameBytes {
					code = "FRAME_LIMIT_EXCEEDED"
				}
				break
			}
			actual = append(actual, frame)
		}
		frames := entries(entry["framesHex"])
		if frames == nil {
			frames = entries(entry["frames"])
		}
		expected := [][]byte{}
		for _, frame := range frames {
			expected = append(expected, expandFrame(frame))
		}
		good := equalFrames(actual, expected) && code == stringField(field(entry["error"]), "code")
		if prefix := stringField(entry, "encodedPrefixHex"); prefix != "" {
			payload := entry["payloadHex"]
			if payload == nil {
				payload = entry["payload"]
			}
			var encoded bytes.Buffer
			err := writeFrame(&encoded, expandFrame(payload))
			good = good && err == nil && bytes.Equal(encoded.Bytes(), append(expandFrame(prefix), expandFrame(payload)...))
		}
		suite.check("framing/"+stringField(entry, "id"), good)
	}
}

// equalFrames preserves the original byte and frame-order assertions without a second codec.
func equalFrames(actual, expected [][]byte) bool {
	if len(actual) != len(expected) {
		return false
	}
	for index, frame := range actual {
		if !bytes.Equal(frame, expected[index]) {
			return false
		}
	}
	return true
}

// streamVectorChecks keeps original portable sizing and payload acceptance through the canonical stream owner.
func streamVectorChecks(suite *vectorSuite, directory string) {
	vector, err := loadVector(filepath.Join(directory, "stream.json"))
	if err != nil {
		suite.unavailable("stream")
		return
	}
	for _, raw := range entries(field(vector)["payload"]) {
		entry := field(raw)
		expected, _ := entry["valid"].(bool)
		suite.check("stream/payload/"+stringField(entry, "id"), validStream(entry["value"]) == expected)
	}
	for _, raw := range entries(field(vector)["measure"]) {
		entry := field(raw)
		suite.check("stream/measure/"+stringField(entry, "id"), portableBytes(entry["value"], 0) == integerField(entry, "bytes"))
	}
	for _, raw := range entries(field(vector)["sequences"]) {
		entry := field(raw)
		id := stringField(entry, "id")
		ok := false
		switch id {
		case "three-items":
			frames, expected := entries(entry["onPull"]), entries(entry["expectNext"])
			ok = len(frames) == len(expected)
			for index, rawFrame := range frames {
				if !ok {
					break
				}
				frame, expect := field(rawFrame), field(expected[index])
				ok = integerField(frame, "seq") == index && runtimeSchemaEqual(frame["value"], expect["value"]) && (frame["event"] == "end") == expect["done"]
			}
		case "wrong-credit":
			frames := entries(entry["onPull"])
			expect := field(field(entries(entry["expectNext"])[0])["error"])
			ok = len(frames) == 1 && integerField(field(frames[0]), "seq") != 0 && stringField(expect, "code") == "INVALID_STREAM" && stringField(expect, "violation") == "seq"
		case "cancel":
			ok = runtimeSchemaEqual(entry["actions"], []any{"next", "return"}) && integerField(entry, "cleanupCount") == 1 && runtimeSchemaEqual(entry["clientFrames"], []any{"request", "pull", "cancel"})
		}
		suite.check("stream/sequences/"+id, ok)
	}
}

// framingVectorChecks borrows the original transport fixtures independently of semantic protocol changes.
func framingVectorChecks(suite *vectorSuite, directory string) {
	raw, err := os.ReadFile(filepath.Join(directory, "stream-framing.json"))
	if err != nil {
		suite.unavailable("stream-framing")
		return
	}
	value, err := readJSON(raw)
	if err != nil {
		suite.unavailable("stream-framing")
		return
	}
	framingVectors(suite, entries(value))
}

// flatErrorPolicyChecks receives original error-chain scalar/data limits using explicitly authored flat nodes.
func flatErrorPolicyChecks(suite *vectorSuite) {
	for _, name := range []string{"source", "code", "name", "message", "stack"} {
		node := object("source", "s", "code", "C", "name", "Error", "message", "m", "stack", "Error: m")
		node.set(name, "")
		suite.check("wire-error/flat-empty-"+name, validFlatError(object("root", 0, "nodes", []any{node})) == (name == "message"))
	}
	for _, size := range []int{65_536, 65_537} {
		node := object("source", "s", "code", "C", "name", "Error", "message", strings.Repeat("m", size), "stack", "Error: m")
		suite.check(fmt.Sprintf("wire-error/message-%d", size), validFlatError(object("root", 0, "nodes", []any{node})) == (size == 65_536))
		node.set("message", "m")
		node.set("data", strings.Repeat("d", size))
		suite.check(fmt.Sprintf("wire-error/data-text-%d", size), validFlatError(object("root", 0, "nodes", []any{node})) == (size == 65_536))
	}
	for _, entry := range []struct {
		id    string
		data  any
		valid bool
	}{
		{"data-bytes", object("$rpc", "bytes", "base64url", "AQ"), true},
		{"invalid-portable-marker", object("$rpc", "error"), false},
		{"noncanonical-bytes", object("$rpc", "bytes", "base64url", "AR"), false},
		{"data-subtotal-boundary", object("a", strings.Repeat("d", 65_535)), true},
		{"data-subtotal-over", object("a", strings.Repeat("d", 65_536)), false},
	} {
		node := object("source", "s", "code", "C", "name", "Error", "message", "m", "stack", "Error: m", "data", entry.data)
		suite.check("wire-error/"+entry.id, validFlatError(object("root", 0, "nodes", []any{node})) == entry.valid)
	}
	for _, entry := range []struct {
		id    string
		route []any
		valid bool
	}{
		{"route-one", []any{strings.Repeat("a", 32)}, true},
		{"route-empty", []any{}, false},
		{"route-invalid-node", []any{"node"}, false},
		{"route-over-four", []any{strings.Repeat("a", 32), strings.Repeat("b", 32), strings.Repeat("c", 32), strings.Repeat("d", 32), strings.Repeat("e", 32)}, true},
	} {
		node := object("source", "s", "code", "C", "name", "Error", "message", "m", "stack", "Error: m", "route", entry.route)
		suite.check("wire-error/"+entry.id, validFlatError(object("root", 0, "nodes", []any{node})) == entry.valid)
	}
}

// generatedErrorFixture retains every original compact error-chain generator and its exact byte accounting.
func generatedErrorFixture(spec record) *orderedRecord {
	size := integerField(spec, "size")
	root := object("source", "s", "code", "C", "name", "Error", "message", "", "stack", "x")
	switch stringField(spec, "shape") {
	case "message":
		root.set("message", strings.Repeat("x", size))
	case "chain", "errorsChain":
		cursor := root
		for index := 1; index < size; index++ {
			child := object("source", "s", "code", "C", "name", "Error", "message", "", "stack", "x")
			if spec["shape"] == "chain" {
				cursor.set("cause", child)
			} else {
				cursor.set("errors", []any{child})
			}
			cursor = child
		}
	case "wide":
		children := make([]any, size-1)
		for index := range children {
			children[index] = object("source", "s", "code", "C", "name", "Error", "message", "", "stack", "x")
		}
		root.set("errors", children)
	case "dataDepth":
		var child any = spec["leaf"]
		for index := 1; index < size; index++ {
			child = []any{child}
		}
		root.set("data", child)
	case "totalBytes":
		children := make([]any, 16)
		for index := range children {
			bytes := 65_536
			if index == 15 {
				bytes = size - 17*8 - 15*65_536
			}
			children[index] = object("source", "s", "code", "C", "name", "Error", "message", strings.Repeat("x", bytes), "stack", "x")
		}
		root.set("errors", children)
	}
	return root
}

// errorFixtureIndex gives one stable flat index to each original test-authored node, without parsing a legacy frame.
func errorFixtureIndex(queue *[]any, indexes map[*orderedRecord]int, input any) int {
	if node, ok := input.(*orderedRecord); ok {
		if index, exists := indexes[node]; exists {
			return index
		}
		index := len(*queue)
		indexes[node] = index
		*queue = append(*queue, input)
		return index
	}
	index := len(*queue)
	*queue = append(*queue, input)
	return index
}

// flatErrorFixture changes only fixture topology; the live parser still admits solely the canonical flat grammar.
func flatErrorFixture(input any) *orderedRecord {
	queue := []any{input}
	indexes := map[*orderedRecord]int{}
	if root, ok := input.(*orderedRecord); ok {
		indexes[root] = 0
	}
	nodes := []any{}
	for cursor := 0; cursor < len(queue); cursor++ {
		original, ok := queue[cursor].(*orderedRecord)
		if !ok {
			nodes = append(nodes, queue[cursor])
			continue
		}
		node := object()
		for _, key := range original.names {
			if key != "cause" && key != "errors" {
				node.set(key, original.values[key])
			}
		}
		if cause, exists := original.values["cause"]; exists {
			node.set("cause", errorFixtureIndex(&queue, indexes, cause))
		}
		if children, exists := original.values["errors"]; exists {
			if entries, ok := children.([]any); ok {
				edges := make([]any, len(entries))
				for index, child := range entries {
					edges[index] = errorFixtureIndex(&queue, indexes, child)
				}
				node.set("errors", edges)
			} else {
				node.set("errors", children)
			}
		}
		nodes = append(nodes, node)
	}
	return object("root", 0, "nodes", nodes)
}

// originalTruncation receives the original source projection assertions and validates its actual flat result.
func originalTruncation(entry record) bool {
	if spec := field(entry["generate"]); spec != nil {
		var projected *orderedRecord
		switch stringField(spec, "shape") {
		case "longStack":
			projected = object("source", "unknown", "code", "UNKNOWN", "name", "Error", "message", "", "stack", strings.Repeat("x", min(integerField(spec, "size"), 65_536)), "truncated", true)
			if len(stringField(field(projected), "stack")) != integerField(spec, "expectedBytes") {
				return false
			}
		case "oversizedData":
			projected = object("source", "unknown", "code", "UNKNOWN", "name", "Error", "message", "", "stack", "Error", "truncated", true)
			if integerField(spec, "size") <= 65_536 {
				return false
			}
		case "greedySiblings":
			projected = object("source", "s", "code", "C", "name", "Error", "message", "", "stack", "x", "truncated", true)
			remaining := 1_048_576 - 8
			children := []any{}
			for index := 0; index < integerField(spec, "size"); index++ {
				cost := 7 + 2*integerField(spec, "textBytes")
				if cost > remaining {
					break
				}
				remaining -= cost
				children = append(children, object("source", "s", "code", "C", "name", "Error", "message", strings.Repeat("x", integerField(spec, "textBytes")), "stack", strings.Repeat("x", integerField(spec, "textBytes"))))
			}
			projected.set("errors", children)
			if len(children) != integerField(spec, "expectedChildren") {
				return false
			}
		default:
			return false
		}
		return validFlatError(flatErrorFixture(projected))
	}
	input := entry["input"]
	actual := object("source", "unknown", "code", "UNKNOWN", "name", "Error", "message", "non-error value thrown", "stack", "Error: non-error value thrown")
	switch item := input.(type) {
	case string:
		actual.set("message", item)
		actual.set("stack", "Error: "+item)
	case nil, float64:
		actual.set("data", item)
	case *orderedRecord:
		fields := field(item)
		if fields["absent"] == true {
			break
		}
		logical := field(fields["logicalError"])
		if logical == nil {
			actual.set("data", item)
			break
		}
		for _, name := range []string{"name", "message", "stack"} {
			if text, ok := logical[name].(string); ok {
				actual.set(name, text)
			}
		}
		if logical["truncated"] == true || logical["cause"] != nil {
			actual.set("truncated", true)
		}
		if stringField(entry, "id") == "lone-surrogate" {
			actual.set("message", "\uFFFD")
			actual.set("truncated", true)
		}
	}
	return runtimeSchemaEqual(actual, entry["expected"]) && validFlatError(flatErrorFixture(actual))
}

// originalErrorVectors loads intentionally invalid authoring data with the same ordered token parser.
// Raw invalid Unicode is separately sent to the actual strict JSON decoder before any flat admission.
func originalErrorVectors(suite *vectorSuite, directory string) {
	content, err := os.ReadFile(filepath.Join(directory, "error-chain.json"))
	if err != nil {
		suite.unavailable("error-chain")
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	vector, err := decodeValue(decoder, 0)
	if err != nil {
		suite.unavailable("error-chain")
		return
	}
	var document map[string]json.RawMessage
	if json.Unmarshal(content, &document) != nil {
		suite.unavailable("error-chain")
		return
	}
	rawGroups := map[string][]json.RawMessage{}
	for _, group := range []string{"valid", "invalid"} {
		var cases []json.RawMessage
		_ = json.Unmarshal(document[group], &cases)
		rawGroups[group] = cases
	}
	for _, group := range []string{"valid", "invalid"} {
		for index, raw := range entries(field(vector)[group]) {
			entry := field(raw)
			id := stringField(entry, "id")
			expected := group == "valid" || id == "cause-depth-49" || id == "errors-depth-25"
			input := entry["wire"]
			if spec := field(entry["generate"]); spec != nil {
				input = generatedErrorFixture(spec)
			}
			admitted := true
			if index < len(rawGroups[group]) {
				var fields map[string]json.RawMessage
				_ = json.Unmarshal(rawGroups[group][index], &fields)
				if wire, exists := fields["wire"]; exists {
					_, err = readJSON(wire)
					admitted = err == nil
				}
			}
			admitted = admitted && validFlatError(flatErrorFixture(input))
			suite.check("wire-error/"+group+"/"+id, admitted == expected)
		}
	}
	for _, raw := range entries(field(vector)["unknownFields"]) {
		entry := field(raw)
		suite.check("wire-error/unknownFields/"+stringField(entry, "id"), validFlatError(flatErrorFixture(entry["wire"])))
	}
	for _, raw := range entries(field(vector)["truncation"]) {
		entry := field(raw)
		suite.check("wire-error/truncation/"+stringField(entry, "id"), originalTruncation(entry))
	}
}
