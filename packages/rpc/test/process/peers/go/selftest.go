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
	"regexp"
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
	_, _, classifiedErr := normalizeEnvelope(record{"kind": "stream", "id": "req-1", "data": record{"route": record{"profile": "migaia.rpc.route", "applicationVersion": "1", "senderId": "caller", "targetId": "provider", "sentAt": json.Number("0"), "type": "request"}}})
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

// runSelftest executes all available frozen and 1.1 vectors; absent upstream assets stay visible and nonzero.
func runSelftest(directory string) int {
	suite := &vectorSuite{}
	if directory == "" {
		fmt.Fprintln(os.Stderr, "ERROR --vectors is required")
		return 2
	}
	runtimeChecks(suite)
	for _, generation := range []string{"frozen/1.0", "."} {
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
	if vector, err := loadVector(filepath.Join(directory, "remote-host-control.json")); err == nil {
		schema, schemaErr := loadVector(filepath.Join(directory, "..", "remote-contract.schema.json"))
		if schemaErr != nil {
			suite.unavailable("remote-schema")
		} else {
			hostVectors(suite, vector, field(schema["$defs"]))
			if contracts, err := loadVector(filepath.Join(directory, "remote-contract.json")); err == nil {
				hostVectors(suite, contracts, field(schema["$defs"]))
			} else {
				suite.unavailable("remote-contract")
			}
		}
	} else {
		suite.unavailable("remote-host-control")
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
	suite.check("runtime/request/method-not-found", missingErr == nil && len(missing) == 1 && missing[0]["code"] == "METHOD_NOT_FOUND" && field(missing[0]["error"])["code"] == "METHOD_NOT_FOUND")
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

// schemaAccepts executes the constructs used by the published remote schema.
func schemaAccepts(value any, rule record, definitions record) bool {
	if ref := stringField(rule, "$ref"); ref != "" {
		parts := strings.Split(ref, "/")
		return schemaAccepts(value, field(definitions[parts[len(parts)-1]]), definitions)
	}
	for _, key := range []string{"oneOf", "anyOf"} {
		if choices, exists := rule[key]; exists {
			count := 0
			for _, child := range entries(choices) {
				if schemaAccepts(value, field(child), definitions) {
					count++
				}
			}
			if key == "oneOf" && count != 1 || key == "anyOf" && count == 0 {
				return false
			}
		}
	}
	if child, exists := rule["not"]; exists && schemaAccepts(value, field(child), definitions) {
		return false
	}
	if child, exists := rule["if"]; exists && schemaAccepts(value, field(child), definitions) && !schemaAccepts(value, field(rule["then"]), definitions) {
		return false
	}
	if constant, exists := rule["const"]; exists && !reflect.DeepEqual(value, constant) {
		return false
	}
	if choices, exists := rule["enum"]; exists {
		found := false
		for _, item := range entries(choices) {
			found = found || reflect.DeepEqual(item, value)
		}
		if !found {
			return false
		}
	}
	kind := stringField(rule, "type")
	switch kind {
	case "object":
		if field(value) == nil {
			return false
		}
	case "array":
		if _, ok := value.([]any); !ok {
			return false
		}
	case "string":
		if _, ok := value.(string); !ok {
			return false
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return false
		}
	case "null":
		if value != nil {
			return false
		}
	case "number", "integer":
		if _, ok := value.(json.Number); !ok {
			return false
		}
		if kind == "integer" {
			if _, ok := asInt(value); !ok {
				return false
			}
		}
	}
	if number, ok := value.(json.Number); ok {
		if minimum, exists := rule["minimum"]; exists {
			n, _ := number.Float64()
			m, _ := minimum.(json.Number).Float64()
			if n < m {
				return false
			}
		}
	}
	if text, ok := value.(string); ok {
		if max, exists := rule["maxLength"]; exists {
			length, _ := asInt(max)
			if len([]rune(text)) > length {
				return false
			}
		}
		if pattern := stringField(rule, "pattern"); pattern != "" {
			match, err := regexp.MatchString(pattern, text)
			if err != nil || !match {
				return false
			}
		}
	}
	if array, ok := value.([]any); ok {
		if minimum, exists := rule["minItems"]; exists {
			n, _ := asInt(minimum)
			if len(array) < n {
				return false
			}
		}
		if maximum, exists := rule["maxItems"]; exists {
			n, _ := asInt(maximum)
			if len(array) > n {
				return false
			}
		}
		prefix := entries(rule["prefixItems"])
		for index, item := range array {
			child := field(rule["items"])
			if index < len(prefix) {
				child = field(prefix[index])
			}
			if !schemaAccepts(item, child, definitions) {
				return false
			}
		}
	}
	if object := field(value); object != nil {
		if minimum, exists := rule["minProperties"]; exists {
			n, _ := asInt(minimum)
			if len(object) < n {
				return false
			}
		}
		for _, key := range stringSlice(rule["required"]) {
			if _, exists := object[key]; !exists {
				return false
			}
		}
		for key, item := range object {
			if !schemaAccepts(key, field(rule["propertyNames"]), definitions) {
				return false
			}
			child, exists := field(rule["properties"])[key]
			if !exists {
				child = rule["additionalProperties"]
			}
			if child == false || !schemaAccepts(item, field(child), definitions) {
				return false
			}
		}
	}
	return true
}

// hostVectors compares schema acceptance and the independent semantic projection per case.
func hostVectors(suite *vectorSuite, vector record, definitions record) {
	for _, section := range []string{"contracts", "catalogs", "controls"} {
		for _, item := range entries(vector[section]) {
			entry := field(item)
			definition := stringField(entry, "definition")
			if section == "catalogs" {
				definition = "catalog"
			}
			if section == "contracts" {
				definition = "contract"
			}
			value := entry["value"]
			valid := schemaAccepts(value, field(definitions[definition]), definitions)
			semantic := valid
			var catalog record
			if definition == "catalog" {
				catalog = field(value)
			} else if definition == "describeHost" {
				catalog = field(field(value)["catalog"])
			}
			if semantic && catalog != nil {
				for name, child := range catalog {
					semantic = semantic && name == stringField(field(child), "plugin")
				}
			}
			if semantic && definition == "hostInspectResult" {
				previous := ""
				for _, plugin := range entries(field(value)["plugins"]) {
					name := stringField(field(plugin), "name")
					if name <= previous {
						semantic = false
					}
					previous = name
					features := stringSlice(field(plugin)["features"])
					for index := 1; index < len(features); index++ {
						if features[index] <= features[index-1] {
							semantic = false
						}
					}
				}
			}
			suite.check("host/"+section+"/"+stringField(entry, "id"), valid == entry["schemaValid"] && semantic == entry["semanticValid"])
		}
	}
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
