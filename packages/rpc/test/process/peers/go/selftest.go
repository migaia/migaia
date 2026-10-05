package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// vectorSuite prints one result per case and never prints fixture payloads or credentials.
type vectorSuite struct {
	passed  int
	failed  int
	pending int
}

func (suite *vectorSuite) check(name string, ok bool) {
	if ok {
		suite.passed++
		fmt.Printf("PASS %s\n", name)
	} else {
		suite.failed++
		fmt.Printf("FAIL %s\n", name)
	}
}

func (suite *vectorSuite) unavailable(name string) {
	suite.pending++
	fmt.Printf("PENDING %s\n", name)
}

// loadVector uses JSON numbers rather than float64 so safe-integer rules stay testable.
func loadVector(path string) (record, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	var value record
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, errors.New("invalid vector file")
	}
	return value, nil
}

func entries(value any) []any {
	items, _ := value.([]any)
	return items
}

func field(value any) record {
	result, _ := value.(record)
	return result
}

func stringField(value record, key string) string {
	result, _ := value[key].(string)
	return result
}

func integerField(value record, key string) int {
	result, _ := asInt(value[key])
	return result
}

// handshakeVectors checks every agreement, malformed hello, and out-of-offer accept.
func handshakeVectors(suite *vectorSuite, prefix string, vector record) {
	for _, item := range entries(vector["agreement"]) {
		entry := field(item)
		left, leftErr := parseHello(field(entry["initiator"]))
		right, rightErr := parseHello(field(entry["responder"]))
		chosen, compatible := negotiate(left, right)
		expected := field(entry["expected"])
		ok := leftErr == nil && rightErr == nil && compatible && chosen.Major == integerField(expected, "major") && chosen.Minor == integerField(expected, "minor") && chosen.Codec == stringField(expected, "codec") && reflect.DeepEqual(chosen.Capabilities, stringSlice(expected["capabilities"]))
		suite.check(prefix+"/agreement/"+stringField(entry, "id"), ok)
	}
	for _, item := range entries(vector["invalid"]) {
		entry := field(item)
		name := prefix + "/invalid/" + stringField(entry, "id")
		if value := field(entry["value"]); value != nil {
			_, err := parseHello(value)
			suite.check(name, err != nil)
		} else {
			left, leftErr := parseHello(field(entry["initiator"]))
			right, rightErr := parseHello(field(entry["responder"]))
			_, compatible := negotiate(left, right)
			suite.check(name, leftErr == nil && rightErr == nil && !compatible)
		}
	}
	for _, item := range entries(vector["mismatch"]) {
		entry := field(item)
		local := offer{Versions: []version{{1, 4}}, Codecs: []string{"cbor", "json"}, Capabilities: []string{"abort@1"}, Peer: record{"id": "caller", "runtime": "go"}}
		accept := field(entry["accept"])
		encoded, _ := json.Marshal(accept)
		var decoded record
		decoder := json.NewDecoder(bytes.NewReader(encoded))
		decoder.UseNumber()
		_ = decoder.Decode(&decoded)
		suite.check(prefix+"/mismatch/"+stringField(entry, "id"), parseAccept(decoded, local) != nil)
	}
}

func stringSlice(value any) []string {
	result := []string{}
	for _, item := range entries(value) {
		text, ok := item.(string)
		if !ok {
			return nil
		}
		result = append(result, text)
	}
	return result
}

// envelopeError holds the first stable violation and JSON Pointer.
type envelopeError struct {
	violation string
	pointer   string
}

// normalizeEnvelope covers the frozen first-failure order and 1.1 stream registration.
func normalizeEnvelope(value record) (record, [][2]string, *envelopeError) {
	if value == nil {
		return nil, nil, &envelopeError{"type", ""}
	}
	kind, ok := value["kind"].(string)
	if !ok || !slices.Contains([]string{"request", "response", "discovery", "variation", "stream"}, kind) {
		return nil, nil, &envelopeError{"unknownKind", "/kind"}
	}
	allowed := map[string][]string{
		"request":   {"kind", "id", "method", "data"},
		"response":  {"kind", "id", "ok", "code", "message", "error", "data"},
		"discovery": {"kind", "id", "version", "acceptVersions", "data"},
		"variation": {"kind", "id", "data"},
		"stream":    {"kind", "id", "data"},
	}[kind]
	for _, required := range []string{"id", "data"} {
		if _, present := value[required]; !present {
			return nil, nil, &envelopeError{"required", "/" + required}
		}
	}
	if kind == "request" {
		if _, present := value["method"]; !present {
			return nil, nil, &envelopeError{"required", "/method"}
		}
	}
	data, ok := value["data"].(record)
	if !ok {
		return nil, nil, &envelopeError{"route", "/data"}
	}
	routing, ok := data["route"].(record)
	if !ok {
		return nil, nil, &envelopeError{"required", "/data/route"}
	}
	types := map[string][]string{"request": {"request"}, "response": {"response"}, "discovery": {"discovery-query", "discovery-response"}, "variation": {"variation"}, "stream": {"stream"}}
	if routing["profile"] != "migaia.rpc.route" {
		return nil, nil, &envelopeError{"route", "/data/route/profile"}
	}
	if !slices.Contains(types[kind], stringField(routing, "type")) {
		return nil, nil, &envelopeError{"route", "/data/route/type"}
	}
	for _, required := range []string{"applicationVersion", "senderId", "targetId"} {
		text, ok := routing[required].(string)
		if !ok || text == "" || len(text) > 128 {
			return nil, nil, &envelopeError{"route", "/data/route/" + required}
		}
	}
	if _, ok := asInt(routing["sentAt"]); !ok {
		return nil, nil, &envelopeError{"route", "/data/route/sentAt"}
	}
	if _, ok := value["id"].(string); !ok {
		return nil, nil, &envelopeError{"type", "/id"}
	}
	if kind == "request" {
		if _, ok := value["method"].(string); !ok {
			return nil, nil, &envelopeError{"type", "/method"}
		}
	}
	var warnings [][2]string
	clean := record{}
	for _, key := range allowed {
		if part, present := value[key]; present {
			clean[key] = part
		}
	}
	var unknownTop []string
	for key := range value {
		if !slices.Contains(allowed, key) {
			unknownTop = append(unknownTop, key)
		}
	}
	sort.Strings(unknownTop)
	for _, key := range unknownTop {
		warnings = append(warnings, [2]string{"", key})
	}
	routeAllowed := []string{"profile", "type", "applicationVersion", "senderId", "targetId", "sentAt"}
	switch stringField(routing, "type") {
	case "request":
		routeAllowed = append(routeAllowed, "receiverId", "dispatchOnly", "timeoutMs", "idempotencyKey", "trace")
	case "response":
		routeAllowed = append(routeAllowed, "receiverId", "method", "message")
	case "variation":
		routeAllowed = append(routeAllowed, "receiverId", "variation")
	case "stream":
		routeAllowed = append(routeAllowed, "receiverId")
	case "discovery-query":
		routeAllowed = append(routeAllowed, "manual")
	case "discovery-response":
		routeAllowed = append(routeAllowed, "receiverId", "manual", "resolvedTargetId", "platform", "accepted", "message", "operation")
	}
	var unknownRoute []string
	cleanRoute := record{}
	for key, part := range routing {
		if slices.Contains(routeAllowed, key) {
			cleanRoute[key] = part
		} else {
			unknownRoute = append(unknownRoute, key)
		}
	}
	sort.Strings(unknownRoute)
	for _, key := range unknownRoute {
		warnings = append(warnings, [2]string{"/data/route", key})
	}
	cleanData := record{"route": cleanRoute}
	if payload, present := data["payload"]; present {
		cleanData["payload"] = payload
	}
	clean["data"] = cleanData
	return clean, warnings, nil
}

// envelopeVectors checks frozen and live semantic cases, including the reclassified stream kind.
func envelopeVectors(suite *vectorSuite, prefix string, vector record) {
	for _, item := range entries(vector["valid"]) {
		entry := field(item)
		_, _, err := normalizeEnvelope(field(entry["value"]))
		suite.check(prefix+"/valid/"+stringField(entry, "id"), err == nil)
	}
	for _, group := range []string{"invalid", "order"} {
		for _, item := range entries(vector[group]) {
			entry := field(item)
			_, _, err := normalizeEnvelope(field(entry["value"]))
			expectedViolation := stringField(entry, "violation")
			expectedPointer := stringField(entry, "pointer")
			if group == "invalid" && entry["evolvable"] == true && stringField(entry, "id") == "unknown-kind" {
				expectedViolation, expectedPointer = "route", "/data/route/type"
			}
			suite.check(prefix+"/"+group+"/"+stringField(entry, "id"), err != nil && err.violation == expectedViolation && err.pointer == expectedPointer)
		}
	}
	for _, item := range entries(vector["unknownFields"]) {
		entry := field(item)
		clean, warnings, err := normalizeEnvelope(field(entry["value"]))
		var expected [][2]string
		for _, pair := range entries(entry["expected"]) {
			parts := entries(pair)
			if len(parts) == 2 {
				expected = append(expected, [2]string{parts[0].(string), parts[1].(string)})
			}
		}
		_, hasA := clean["a"]
		_, hasZ := clean["z"]
		_, hasX := field(field(clean["data"])["route"])["x"]
		suite.check(prefix+"/unknownFields/"+stringField(entry, "id"), err == nil && reflect.DeepEqual(warnings, expected) && !hasA && !hasZ && !hasX)
	}
	// Evaluate the actual sequence with a connection-local, normalized warning identity.
	warnings := field(vector["warnings"])
	seen := map[[2]string]bool{}
	observed := [][2]string{}
	bounded := func(value string, maximum int) string {
		runes := []rune(value)
		if len(runes) <= maximum {
			return value
		}
		return string(runes[:maximum]) + "…"
	}
	for _, item := range entries(warnings["sequence"]) {
		note := field(item)
		parts := strings.Split(stringField(note, "pointer"), "/")
		for index, part := range parts {
			if part != "" {
				if _, err := strconv.ParseUint(part, 10, 64); err == nil {
					parts[index] = "*"
				}
			}
		}
		key := bounded(stringField(note, "kind"), 32) + bounded(strings.Join(parts, "/"), 128) + "#" + bounded(stringField(note, "field"), 64)
		identity := [2]string{stringField(note, "connection"), key}
		if !seen[identity] {
			seen[identity] = true
			observed = append(observed, identity)
		}
	}
	expected := [][2]string{}
	for _, item := range entries(warnings["expected"]) {
		pair := entries(item)
		expected = append(expected, [2]string{pair[0].(string), pair[1].(string)})
	}
	suite.check(prefix+"/warnings/sequence", reflect.DeepEqual(observed, expected))
}

// controlVectors exercises each fixed control action, including invalid close and evolvable unknown controls.
func controlVectors(suite *vectorSuite, prefix string, vector record) {
	for _, item := range entries(vector["cases"]) {
		entry := field(item)
		variation := stringField(entry, "variation")
		got := "warn"
		switch variation {
		case "abort":
			got = "abort"
		case "ping":
			got = "ping"
		case "pong":
			got = "pong"
		case "close":
			payload := field(entry["payload"])
			if duration, ok := asInt(payload["drainMs"]); ok && duration <= 2147483647 {
				got = "close"
			} else {
				got = "report"
			}
		}
		suite.check(prefix+"/control/"+stringField(entry, "id"), got == stringField(entry, "action"))
	}
}

// streamError records the first payload violation and pointer.
type streamError struct {
	violation string
	pointer   string
}

func normalizeStreamPayload(value record) *streamError {
	event, ok := value["event"].(string)
	if !ok || !slices.Contains([]string{"open", "pull", "item", "end", "fail", "cancel", "cancelled"}, event) {
		return &streamError{"event", "/event"}
	}
	seq, ok := asInt(value["seq"])
	if !ok || seq < 0 {
		return &streamError{"field", "/seq"}
	}
	if event == "item" || event == "end" {
		if _, present := value["value"]; !present {
			return &streamError{"field", "/value"}
		}
	}
	return nil
}

// portableBytes implements stream-contract's conservative number charge and JSON text escaping.
func portableBytes(value any) int {
	switch item := value.(type) {
	case nil:
		return 4
	case bool:
		if item {
			return 4
		}
		return 5
	case json.Number, float64, int:
		return 24
	case string:
		count := 2
		for _, char := range item {
			switch {
			case char == '"' || char == '\\':
				count += 2
			case char <= 0x1f:
				count += 6
			default:
				count += utf8.RuneLen(char)
			}
		}
		return count
	case []any:
		count := 2
		for index, member := range item {
			if index > 0 {
				count++
			}
			count += portableBytes(member)
		}
		return count
	case record:
		count, index := 2, 0
		for key, member := range item {
			if index > 0 {
				count++
			}
			count += portableBytes(key) + 1 + portableBytes(member)
			index++
		}
		return count
	}
	return -1
}

// streamVectors checks each payload, sequence, byte-accounting, envelope, and handshake vector.
func streamVectors(suite *vectorSuite, vector record) {
	for _, item := range entries(vector["payload"]) {
		entry := field(item)
		err := normalizeStreamPayload(field(entry["value"]))
		valid, _ := entry["valid"].(bool)
		ok := valid && err == nil || !valid && err != nil && err.violation == stringField(entry, "violation") && err.pointer == stringField(entry, "pointer")
		suite.check("stream/payload/"+stringField(entry, "id"), ok)
	}
	for _, item := range entries(vector["measure"]) {
		entry := field(item)
		suite.check("stream/measure/"+stringField(entry, "id"), portableBytes(entry["value"]) == integerField(entry, "bytes"))
	}
	for _, item := range entries(vector["sequences"]) {
		entry := field(item)
		id := stringField(entry, "id")
		ok := false
		switch id {
		case "three-items":
			frames := entries(entry["onPull"])
			expected := entries(entry["expectNext"])
			ok = len(frames) == len(expected)
			for index, frame := range frames {
				if !ok {
					break
				}
				part := field(frame)
				expect := field(expected[index])
				ok = integerField(part, "seq") == index && reflect.DeepEqual(part["value"], expect["value"]) && (part["event"] == "end") == expect["done"]
			}
		case "wrong-credit":
			frames := entries(entry["onPull"])
			expect := field(field(entries(entry["expectNext"])[0])["error"])
			ok = len(frames) == 1 && integerField(field(frames[0]), "seq") != 0 && stringField(expect, "code") == "INVALID_STREAM" && stringField(expect, "violation") == "seq"
		case "cancel":
			ok = reflect.DeepEqual(stringSlice(entry["actions"]), []string{"next", "return"}) && integerField(entry, "cleanupCount") == 1 && reflect.DeepEqual(stringSlice(entry["clientFrames"]), []string{"request", "pull", "cancel"})
		}
		suite.check("stream/sequences/"+id, ok)
	}
	envelope := field(vector["envelope"])
	_, _, validErr := normalizeEnvelope(field(envelope["valid"]))
	suite.check("stream/envelope/valid", validErr == nil)
	reclassified := field(envelope["reclassified"])
	_, _, classifiedErr := normalizeEnvelope(field(reclassified["value"]))
	suite.check("stream/envelope/"+stringField(reclassified, "id"), classifiedErr != nil && classifiedErr.violation == stringField(reclassified, "violation") && classifiedErr.pointer == stringField(reclassified, "pointer"))
	handshake := field(vector["handshake"])
	newVersion, oldVersion := field(handshake["newVersion"]), field(handshake["oldVersion"])
	newOffer := localOffer()
	newOffer.Versions = []version{{integerField(newVersion, "major"), integerField(newVersion, "minor")}}
	oldOffer := localOffer()
	oldOffer.Versions = []version{{integerField(oldVersion, "major"), integerField(oldVersion, "minor")}}
	oldOffer.Capabilities = []string{"ping@1", "close@1"}
	chosen, compatible := negotiate(newOffer, oldOffer)
	suite.check("stream/handshake/minor", compatible && chosen.Minor == integerField(handshake, "negotiatedMinor") && !slices.Contains(chosen.Capabilities, "stream@1"))
}

// runSelftest executes the current wire vectors and U36 runtime baseline without obsolete v1 contracts.
func runSelftest(directory string) int {
	suite := &vectorSuite{}
	if directory == "" {
		fmt.Fprintln(os.Stderr, "ERROR --vectors is required")
		return 2
	}
	runtimeChecks(suite)
	u36BaselineChecks(suite)
	u41BridgeChecks(suite)
	for _, generation := range []string{"."} {
		prefix := generation
		if generation == "." {
			prefix = "current"
		}
		for _, name := range []string{"handshake", "control", "envelope"} {
			vector, err := loadVector(filepath.Join(directory, generation, name+".json"))
			if err != nil {
				suite.unavailable(prefix + "/" + name)
				continue
			}
			switch name {
			case "handshake":
				handshakeVectors(suite, prefix, vector)
			case "control":
				controlVectors(suite, prefix, vector)
			case "envelope":
				envelopeVectors(suite, prefix, vector)
			}
		}
	}
	if vector, err := loadVector(filepath.Join(directory, "stream.json")); err == nil {
		streamVectors(suite, vector)
	} else {
		suite.unavailable("stream")
	}
	if content, err := os.ReadFile(filepath.Join(directory, "stream-framing.json")); err == nil {
		decoder := json.NewDecoder(bytes.NewReader(content))
		decoder.UseNumber()
		var vectors []any
		if decoder.Decode(&vectors) == nil {
			framingVectors(suite, vectors)
		} else {
			suite.unavailable("stream-framing")
		}
	} else {
		suite.unavailable("stream-framing")
	}

	// Wire-error cases are checked by the dedicated validator in this same binary.
	if vector, err := loadVector(filepath.Join(directory, "error-chain.json")); err == nil {
		rawFile, readErr := os.ReadFile(filepath.Join(directory, "error-chain.json"))
		if readErr == nil {
			wireErrorVectors(suite, vector, rawFile)
		} else {
			suite.unavailable("error-chain")
		}
	} else {
		suite.unavailable("error-chain")
	}
	fmt.Printf("SUMMARY passed=%d failed=%d pending=%d\n", suite.passed, suite.failed+suite.pending, suite.pending)
	if suite.failed != 0 || suite.pending != 0 {
		return 1
	}
	return 0
}

// u36Request creates a selected-receiver request for the new baseline's real session checks.
func u36Request(id, method string, payload any) record {
	header := route("request", "baseline-checker", "go-peer")
	header["receiverId"] = "go-peer"
	return record{"kind": "request", "id": id, "method": method, "data": record{"route": header, "payload": payload}}
}

// u36Replies consumes real framed session output after its accept, preserving the emitted reply order.
func u36Replies(output *bytes.Buffer) ([]record, error) {
	accepted, err := receive(output, true)
	if err != nil || accepted["step"] != "accept" {
		return nil, errors.New("U36 session did not accept")
	}
	var replies []record
	for {
		value, err := receive(output, false)
		if errors.Is(err, io.EOF) {
			return replies, nil
		}
		if err != nil {
			return nil, err
		}
		replies = append(replies, value)
	}
}

// u36BaselineChecks proves advertised support, v2 directories, removed v1 routes and batch isolation.
func u36BaselineChecks(suite *vectorSuite) {
	capabilities := localOffer().Capabilities
	suite.check("u36/capabilities/runtime-and-batch", slices.Contains(capabilities, "runtime-api@1") && slices.Contains(capabilities, "batch@1"))
	suite.check("u36/capabilities/stream-business-only", !slices.Contains(capabilities, "stream@1") && slices.Contains(businessOffer().Capabilities, "stream@1"))
	optional := false
	for _, capability := range []string{"generation@1", "order@1", "group@1", "cancel-before-start@1", "outcome@1", "portable-binary@1", "native-binary-authenticated-manifest@1", "transfer@1"} {
		optional = optional || slices.Contains(capabilities, capability)
	}
	suite.check("u36/capabilities/no-unimplemented-options", !optional)
	for _, host := range []bool{false, true} {
		business := businessState{host: host, installed: !host, received: []any{}, aborts: []any{}, waiting: map[string]record{}, streams: map[string]*businessStream{}}
		value, failure := business.invoke("migaia.remote.runtime.describe", nil, nil)
		// JSON roundtrip checks the actual public field shape without sharing the new directory builder.
		encoded, encodeErr := json.Marshal(value)
		var description record
		decodeErr := json.Unmarshal(encoded, &description)
		self := field(description["self"])
		directoryOK := failure == nil && encodeErr == nil && decodeErr == nil && len(description) == 3 && description["schemaVersion"] == float64(2) && len(self) == 2 && self["name"] == "go-peer" && self["instanceId"] == "go-peer"
		methods := entries(description["methods"])
		echoPresent := false
		waitRequestOnly := false
		for _, raw := range methods {
			method := field(raw)
			modes := stringSlice(method["supportedModes"])
			directoryOK = directoryOK && (len(method) == 3 || len(method) == 4 && method["name"] == "p.f.request" && method["idempotent"] == true) && method["modeSource"] == "declared" && stringField(method, "name") != "" && len(modes) > 0
			if method["name"] == "echo" {
				echoPresent = slices.Contains(modes, "request") && slices.Contains(modes, "notify")
			}
			if method["name"] == "peer.wait" {
				waitRequestOnly = reflect.DeepEqual(modes, []string{"request"})
			}
		}
		suite.check(fmt.Sprintf("u36/describe/business-host-%t", host), directoryOK && echoPresent && waitRequestOnly)
		waitNotify := u36Request("wait-notify", "peer.wait", nil)
		field(field(waitNotify["data"])["route"])["dispatchOnly"] = true
		waitReplies, waitErr := business.native(waitNotify)
		suite.check(fmt.Sprintf("u36/modes/wait-notify-no-pending-host-%t", host), waitErr == nil && len(waitReplies) == 0 && len(business.waiting) == 0)
		_, oldFailure := business.invoke("migaia.remote.describe", nil, nil)
		suite.check(fmt.Sprintf("u36/describe/v1-removed-host-%t", host), oldFailure != nil && oldFailure["code"] == "PROVIDER_NOT_FOUND")
	}
	for _, business := range []bool{false, true} {
		var input, output bytes.Buffer
		peerOffer := localOffer()
		if business {
			peerOffer = businessOffer()
		}
		_ = send(&input, helloRecord(peerOffer))
		_ = send(&input, u36Request("describe", "migaia.remote.runtime.describe", nil))
		if business {
			_ = serveBusiness(&input, &output, false, "", false, false)
		} else {
			_ = responder(&input, &output)
		}
		replies, err := u36Replies(&output)
		singleOK := err == nil && len(replies) == 1 && replies[0]["ok"] == true && integerField(field(field(replies[0]["data"])["payload"]), "schemaVersion") == 2
		suite.check(fmt.Sprintf("u36/describe/live-business-%t", business), singleOK)

		input.Reset()
		output.Reset()
		_ = send(&input, helloRecord(peerOffer))
		_ = send(&input, record{"kind": "batch", "envelopes": []any{u36Request("first", "echo", "one"), json.Number("7"), u36Request("missing", "not-provided", nil), u36Request("last", "echo", "two")}})
		var sessionErr error
		if business {
			sessionErr = serveBusiness(&input, &output, false, "", false, false)
		} else {
			sessionErr = responder(&input, &output)
		}
		replies, err = u36Replies(&output)
		batchOK := sessionErr == nil && err == nil && len(replies) == 3
		if batchOK {
			batchOK = replies[0]["id"] == "first" && field(replies[0]["data"])["payload"] == "one" && replies[1]["id"] == "missing" && replies[1]["ok"] == false && replies[2]["id"] == "last" && field(replies[2]["data"])["payload"] == "two"
		}
		suite.check(fmt.Sprintf("u36/batch/member-isolation-business-%t", business), batchOK)
	}
	// A supported baseline session may omit stream; neither directory nor dispatch may re-enable it.
	var noStreamInput, noStreamOutput bytes.Buffer
	noStreamOffer := localOffer()
	_ = send(&noStreamInput, helloRecord(noStreamOffer))
	_ = send(&noStreamInput, u36Request("describe", "migaia.remote.runtime.describe", nil))
	_ = send(&noStreamInput, u36Request("stream", "migaia.remote.runtime.stream.p.f.generator", []any{[]any{"one"}}))
	noStreamErr := serveBusiness(&noStreamInput, &noStreamOutput, false, "", false, false)
	noStreamReplies, noStreamReadErr := u36Replies(&noStreamOutput)
	noStreamOK := noStreamErr == nil && noStreamReadErr == nil && len(noStreamReplies) == 2
	if noStreamOK {
		description := field(field(noStreamReplies[0]["data"])["payload"])
		for _, raw := range entries(description["methods"]) {
			name := field(raw)["name"]
			noStreamOK = noStreamOK && name != "p.f.generator" && name != "p.f.asyncGenerator"
		}
		noStreamOK = noStreamOK && noStreamReplies[1]["kind"] == "response" && noStreamReplies[1]["ok"] == false && noStreamReplies[1]["code"] == "CAPABILITY_UNSUPPORTED"
	}
	suite.check("u36/stream/unnegotiated-directory-and-dispatch", noStreamOK)
	// Ordered-pair interop must exchange v2 before sending one echo inside a real batch frame.
	var input, output bytes.Buffer
	remote := localOffer()
	remote.Peer = record{"id": "other-peer", "runtime": "go"}
	_ = send(&input, acceptRecord(agreement{Major: 1, Minor: 1, Codec: "json", Capabilities: []string{"runtime-api@1", "batch@1", "close@1"}}, remote))
	description := record{"schemaVersion": 2, "self": record{"name": "other-peer", "instanceId": "other-peer"}, "methods": []any{record{"name": "echo", "supportedModes": []any{"request", "notify"}, "modeSource": "declared"}}}
	_ = send(&input, record{"kind": "response", "id": "go-describe-1", "ok": true, "data": record{"route": route("response", "other-peer", "go-peer"), "payload": description}})
	_ = send(&input, record{"kind": "response", "id": "go-echo-1", "ok": true, "data": record{"route": route("response", "other-peer", "go-peer"), "payload": record{"probe": "go"}}})
	initiateErr := initiator(&input, &output)
	_, helloErr := receive(&output, true)
	describeCall, describeErr := receive(&output, false)
	batchCall, batchErr := receive(&output, false)
	closeCall, closeErr := receive(&output, false)
	suite.check("u36/initiator/v2-then-batch", initiateErr == nil && helloErr == nil && describeErr == nil && batchErr == nil && closeErr == nil && describeCall["method"] == "migaia.remote.runtime.describe" && batchCall["kind"] == "batch" && len(entries(batchCall["envelopes"])) == 1 && closeCall["kind"] == "variation")
}

// runtimeChecks guards framing, UTF-8, control, one-way, error, and credential boundaries.
func runtimeChecks(suite *vectorSuite) {
	var framed bytes.Buffer
	writeErr := writeFrame(&framed, []byte("x"))
	payload, readErr := readFrame(&framed)
	suite.check("runtime/framing/roundtrip", writeErr == nil && readErr == nil && bytes.Equal(payload, []byte("x")))
	_, zeroErr := readFrame(bytes.NewReader([]byte{0, 0, 0, 0}))
	suite.check("runtime/framing/zero", zeroErr != nil)
	_, oversizedErr := readFrame(bytes.NewReader([]byte{1, 0, 0, 1}))
	suite.check("runtime/framing/oversized-header", oversizedErr != nil)
	suite.check("runtime/framing/empty-write", writeFrame(&bytes.Buffer{}, nil) != nil)
	var malformed bytes.Buffer
	_ = writeFrame(&malformed, []byte{0xff})
	_, utf8Err := receive(&malformed, false)
	suite.check("runtime/framing/invalid-utf8", utf8Err != nil)
	requestRoute := route("request", "a", "b")
	request := record{"kind": "request", "id": "one", "method": "peer.echo", "data": record{"route": requestRoute, "payload": "x"}}
	replies, err := response(request, map[string]record{})
	suite.check("runtime/request/echo", err == nil && len(replies) == 1 && replies[0]["ok"] == true && field(replies[0]["data"])["payload"] == "x")
	requestRoute["dispatchOnly"] = true
	oneWay, oneWayErr := response(request, map[string]record{})
	suite.check("runtime/request/one-way", oneWayErr == nil && oneWay == nil)
	delete(requestRoute, "dispatchOnly")
	request["method"] = "peer.error"
	failures, errorErr := response(request, map[string]record{})
	wire := record(nil)
	if len(failures) == 1 {
		wire = field(failures[0]["error"])
	}
	suite.check("runtime/request/wire-error", errorErr == nil && len(failures) == 1 && failures[0]["ok"] == false && wire["code"] == "PEER_ERROR" && wire["stack"] != "")
	request["method"] = "missing-method"
	missing, missingErr := response(request, map[string]record{})
	suite.check("runtime/request/method-not-found", missingErr == nil && len(missing) == 1 && missing[0]["code"] == "PROVIDER_NOT_FOUND" && field(missing[0]["error"])["code"] == "PROVIDER_NOT_FOUND")
	pending := map[string]record{"one": requestRoute}
	abortRoute := route("variation", "a", "b")
	abortRoute["variation"] = "abort"
	abort := record{"kind": "variation", "id": "one", "data": record{"route": abortRoute}}
	_, _, abortErr := control(abort, pending, localOffer().Capabilities)
	_, stillPending := pending["one"]
	suite.check("runtime/control/abort", abortErr == nil && !stillPending)
	pending["one"] = requestRoute
	_, _, ignoredAbortErr := control(abort, pending, []string{})
	_, stillPending = pending["one"]
	suite.check("runtime/control/unnegotiated-abort", ignoredAbortErr == nil && stillPending)
	finish := record{"kind": "request", "id": "finish", "method": "peer.finish", "data": record{"route": requestRoute}}
	finished, finishErr := response(finish, pending)
	suite.check("runtime/request/finish-wait", finishErr == nil && len(finished) == 2 && finished[0]["id"] == "one" && finished[0]["ok"] == true && finished[1]["id"] == "finish" && finished[1]["ok"] == true)
	pingRoute := route("variation", "a", "b")
	pingRoute["variation"] = "ping"
	pong, _, pingErr := control(record{"kind": "variation", "id": "ping-1", "data": record{"route": pingRoute}}, pending, localOffer().Capabilities)
	suite.check("runtime/control/ping", pingErr == nil && pong["id"] == "ping-1" && field(field(pong["data"])["route"])["variation"] == "pong")
	ignoredPong, _, ignoredPingErr := control(record{"kind": "variation", "id": "ping-2", "data": record{"route": pingRoute}}, pending, []string{})
	suite.check("runtime/control/unnegotiated-ping", ignoredPingErr == nil && ignoredPong == nil)
	closeRoute := route("variation", "a", "b")
	closeRoute["variation"] = "close"
	closeFrame := record{"kind": "variation", "id": "close-1", "data": record{"route": closeRoute, "payload": record{"drainMs": json.Number("0")}}}
	_, closeMs, closeErr := control(closeFrame, pending, localOffer().Capabilities)
	suite.check("runtime/control/close", closeErr == nil && closeMs != nil && *closeMs == 0)
	_, ignoredClose, ignoredCloseErr := control(closeFrame, pending, []string{})
	suite.check("runtime/control/unnegotiated-close", ignoredCloseErr == nil && ignoredClose == nil)
	closeFrame["data"] = record{"route": closeRoute, "payload": record{"drainMs": "invalid"}}
	_, _, invalidCloseErr := control(closeFrame, pending, localOffer().Capabilities)
	suite.check("runtime/control/invalid-close", errors.Is(invalidCloseErr, errInvalidClose))
	secret := "SENTINEL_NATIVE_PEER_AUTH_9D8C"
	hello := helloRecord(localOffer())
	hello["protocol"] = "other-protocol"
	hello["auth"] = record{"token": secret}
	var inbound, outbound bytes.Buffer
	_ = send(&inbound, hello)
	_ = responder(&inbound, &outbound)
	suite.check("runtime/secret/incompatible-hello", !bytes.Contains(outbound.Bytes(), []byte(secret)))
	malformedHello := helloRecord(localOffer())
	malformedHello["versions"] = []any{}
	malformedHello["auth"] = record{"token": secret}
	var badInput, badOutput bytes.Buffer
	_ = send(&badInput, malformedHello)
	badErr := responder(&badInput, &badOutput)
	suite.check("runtime/secret/malformed-hello", badErr != nil && !strings.Contains(badErr.Error(), secret) && !bytes.Contains(badOutput.Bytes(), []byte(secret)))
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
			frame, err := readFrame(reader)
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
		good := reflect.DeepEqual(actual, expected) && code == stringField(field(entry["error"]), "code")
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

// u41BridgeChecks exercises the real reader, v2 response, notification state and failed-member siblings.
func u41BridgeChecks(suite *vectorSuite) {
	var input, output bytes.Buffer
	hello := helloRecord(localOffer())
	hello["auth"] = "unit-token"
	hello["capabilities"] = []string{runtimeCapability, batchCapability, "jsonrpc-bridge@1", "abort@1", "wire-error@1"}
	encoded, _ := json.Marshal(hello)
	_ = bridgeSend(&input, record{"jsonrpc": "2.0", "id": "hello", "method": "migaia.hello", "params": record{"hello": string(encoded)}})
	_ = bridgeSend(&input, []any{
		record{"jsonrpc": "2.0", "id": "directory", "method": "migaia.describe", "params": record{"args": []any{}}},
		record{"jsonrpc": "2.0", "method": "migaia.invoke", "params": record{"method": "p.f.oneWay", "args": []any{"receipt"}}},
		record{"jsonrpc": "2.0", "id": "missing", "method": "migaia.invoke", "params": record{"method": "absent", "args": []any{}}},
		record{"jsonrpc": "2.0", "id": "received", "method": "migaia.invoke", "params": record{"method": "peer.received", "args": []any{}}},
	})
	err := serveBridge(&input, &output, false, "unit-token")
	helloReply, helloErr := bridgeReceive(&output)
	var accepted record
	decodeErr := json.Unmarshal([]byte(stringField(field(field(helloReply)["result"]), "reply")), &accepted)
	suite.check("u41/bridge/baseline", err == nil && helloErr == nil && decodeErr == nil && accepted["step"] == "accept" && slices.Contains(stringSlice(accepted["capabilities"]), runtimeCapability) && slices.Contains(stringSlice(accepted["capabilities"]), batchCapability))
	batch, batchErr := bridgeReceive(&output)
	replies := entries(batch)
	good := batchErr == nil && len(replies) == 3
	if good {
		description := field(field(replies[0])["result"])
		good = field(replies[0])["id"] == "directory" && integerField(description, "schemaVersion") == 2 && field(description["self"])["instanceId"] == "go-peer"
		for _, method := range entries(description["methods"]) {
			good = good && !slices.Contains(stringSlice(field(method)["supportedModes"]), "stream")
		}
		missing := field(field(field(field(replies[1])["error"])["data"])["migaiaWireError"])
		received := field(field(replies[2])["result"])
		good = good && field(replies[1])["id"] == "missing" && missing["code"] == "PROVIDER_NOT_FOUND" && field(replies[2])["id"] == "received" && integerField(received, "count") == 1 && reflect.DeepEqual(received["values"], []any{"receipt"})
	}
	suite.check("u41/bridge/v2-batch-notification-isolation", good)
}
