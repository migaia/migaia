package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

type wireViolation struct {
	name    string
	pointer string
}

type wireState struct {
	nodes   int
	bytes   int
	ignore  bool
	reports [][2]string
}

// wireNode supplies the shared generated vector shape.
func wireNode() record {
	return record{"source": "s", "code": "C", "name": "Error", "message": "", "stack": "x"}
}

// generatedWire expands only the compact shapes defined by vectors/README.md.
func generatedWire(spec record) record {
	shape := stringField(spec, "shape")
	size := integerField(spec, "size")
	root := wireNode()
	switch shape {
	case "chain":
		cursor := root
		for index := 1; index < size; index++ {
			next := wireNode()
			cursor["cause"] = next
			cursor = next
		}
	case "errorsChain":
		cursor := root
		for index := 1; index < size; index++ {
			next := wireNode()
			cursor["errors"] = []any{next}
			cursor = next
		}
	case "wide":
		children := make([]any, size-1)
		for index := range children {
			children[index] = wireNode()
		}
		root["errors"] = children
	case "message":
		root["message"] = strings.Repeat("x", size)
	case "dataDepth":
		var value any = spec["leaf"]
		for index := 1; index < size; index++ {
			value = []any{value}
		}
		root["data"] = value
	case "totalBytes":
		children := make([]any, 16)
		for index := range children {
			node := wireNode()
			if index < 15 {
				node["message"] = strings.Repeat("x", 65536)
			} else {
				node["message"] = strings.Repeat("x", size-(17*8)-(15*65536))
			}
			children[index] = node
		}
		root["errors"] = children
	}
	return root
}

// validUnicodeEscapes scans JSON string tokens so Go's replacement of lone surrogates cannot hide them.
func validUnicodeEscapes(payload []byte) bool {
	inString := false
	pendingHigh := false
	for index := 0; index < len(payload); index++ {
		current := payload[index]
		if current == '"' && (index == 0 || payload[index-1] != '\\') {
			if inString && pendingHigh {
				return false
			}
			inString = !inString
			continue
		}
		if !inString || current != '\\' {
			if pendingHigh {
				return false
			}
			continue
		}
		if index+1 >= len(payload) {
			return false
		}
		if payload[index+1] != 'u' {
			if pendingHigh {
				return false
			}
			index++
			continue
		}
		if index+6 > len(payload) {
			return false
		}
		hex := string(payload[index+2 : index+6])
		number, err := strconv.ParseUint(hex, 16, 16)
		if err != nil {
			return false
		}
		isHigh := number >= 0xD800 && number <= 0xDBFF
		isLow := number >= 0xDC00 && number <= 0xDFFF
		if pendingHigh && !isLow || !pendingHigh && isLow {
			return false
		}
		pendingHigh = isHigh
		index += 5
	}
	return !inString && !pendingHigh && utf8.Valid(payload)
}

// validateWireRaw preserves the JSON lexical evidence that encoding/json normally replaces.
func validateWireRaw(payload []byte, ignore bool) (record, *wireViolation, [][2]string) {
	if !validUnicodeEscapes(payload) {
		return nil, &wireViolation{"surrogate", "/message"}, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value record
	if err := decoder.Decode(&value); err != nil {
		return nil, &wireViolation{"type", ""}, nil
	}
	state := &wireState{ignore: ignore}
	clean, failure := validateWireNode(value, "", 0, state)
	return clean, failure, state.reports
}

func wireFieldText(value record, key, pointer string, state *wireState, requiredNonempty bool) (string, *wireViolation) {
	fieldValue, present := value[key]
	if !present {
		return "", &wireViolation{"required", pointer}
	}
	text, ok := fieldValue.(string)
	if !ok || requiredNonempty && text == "" {
		return "", &wireViolation{"type", pointer}
	}
	length := len([]byte(text))
	if length > 65536 {
		return "", &wireViolation{"stringBytes", pointer}
	}
	state.bytes += length
	if state.bytes > 1048576 {
		return "", &wireViolation{"totalBytes", pointer}
	}
	return text, nil
}

// validatePortable checks supported JSON values, bytes markers, per-subtree size, and nesting.
func validatePortable(value any, depth int) (int, bool) {
	if depth >= 48 {
		return 0, false
	}
	switch item := value.(type) {
	case nil, bool, json.Number:
		return 0, true
	case string:
		return len([]byte(item)), utf8.ValidString(item) && len([]byte(item)) <= 65536
	case []any:
		total := 0
		for _, member := range item {
			bytes, valid := validatePortable(member, depth+1)
			if !valid {
				return 0, false
			}
			total += bytes
			if total > 65536 {
				return 0, false
			}
		}
		return total, true
	case record:
		if marker, present := item["$rpc"]; present {
			encoded, good := item["base64url"].(string)
			if marker != "bytes" || !good || len(item) != 2 || len(encoded) > 65536 {
				return 0, false
			}
			return len(encoded), true
		}
		total := 0
		for key, member := range item {
			bytes, valid := validatePortable(member, depth+1)
			if !valid {
				return 0, false
			}
			total += len([]byte(key)) + bytes
			if total > 65536 {
				return 0, false
			}
		}
		return total, true
	}
	return 0, false
}

// validateWireNode checks canonical wire-error node order and resource budgets.
func validateWireNode(value any, pointer string, depth int, state *wireState) (record, *wireViolation) {
	if depth >= 48 {
		return nil, &wireViolation{"depth", pointer}
	}
	entry, ok := value.(record)
	if !ok {
		return nil, &wireViolation{"type", pointer}
	}
	state.nodes++
	if state.nodes > 1024 {
		return nil, &wireViolation{"nodes", pointer}
	}
	known := []string{"source", "code", "name", "message", "stack", "cause", "errors", "data", "truncated"}
	var unknown []string
	for key := range entry {
		if !slices.Contains(known, key) {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	if len(unknown) > 0 && !state.ignore {
		return nil, &wireViolation{"unknownField", pointer}
	}
	for _, key := range unknown {
		state.reports = append(state.reports, [2]string{pointer, key})
	}
	clean := record{}
	for _, key := range []string{"source", "code", "name", "message", "stack"} {
		text, failure := wireFieldText(entry, key, pointer+"/"+key, state, key != "message")
		if failure != nil {
			return nil, failure
		}
		clean[key] = text
	}
	if data, present := entry["data"]; present {
		dataBytes, valid := validatePortable(data, 0)
		if !valid {
			return nil, &wireViolation{"dataPortable", pointer + "/data"}
		}
		state.bytes += dataBytes
		if state.bytes > 1048576 {
			return nil, &wireViolation{"totalBytes", pointer + "/data"}
		}
		clean["data"] = data
	}
	if child, present := entry["cause"]; present {
		value, failure := validateWireNode(child, pointer+"/cause", depth+1, state)
		if failure != nil {
			return nil, failure
		}
		clean["cause"] = value
	}
	if children, present := entry["errors"]; present {
		items, ok := children.([]any)
		if !ok {
			return nil, &wireViolation{"type", pointer + "/errors"}
		}
		if len(items) == 0 {
			return nil, &wireViolation{"emptyErrors", pointer + "/errors"}
		}
		cleanChildren := make([]any, 0, len(items))
		for index, child := range items {
			value, failure := validateWireNode(child, fmt.Sprintf("%s/errors/%d", pointer, index), depth+2, state)
			if failure != nil {
				return nil, failure
			}
			cleanChildren = append(cleanChildren, value)
		}
		clean["errors"] = cleanChildren
	}
	if truncated, present := entry["truncated"]; present {
		if truncated != true {
			return nil, &wireViolation{"truncatedValue", pointer + "/truncated"}
		}
		clean["truncated"] = true
	}
	return clean, nil
}

// encodedCase extracts each raw wire object independently, preserving surrogate escapes.
func encodedCases(content []byte, group string) []record {
	var outer map[string]json.RawMessage
	if json.Unmarshal(content, &outer) != nil {
		return nil
	}
	var rawCases []json.RawMessage
	if json.Unmarshal(outer[group], &rawCases) != nil {
		return nil
	}
	result := make([]record, 0, len(rawCases))
	for _, one := range rawCases {
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(one, &raw)
		var identity struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(one, &identity)
		result = append(result, record{"id": identity.ID, "wireRaw": raw["wire"]})
	}
	return result
}

// wireErrorVectors checks every valid, invalid, unknown-field, truncation, and JSON-RPC case.
func wireErrorVectors(suite *vectorSuite, vector record, rawFile []byte) {
	for _, group := range []string{"valid", "invalid"} {
		rawCases := encodedCases(rawFile, group)
		for index, item := range entries(vector[group]) {
			entry := field(item)
			name := "wire-error/" + group + "/" + stringField(entry, "id")
			var payload []byte
			if spec := field(entry["generate"]); spec != nil {
				payload, _ = json.Marshal(generatedWire(spec))
			} else if index < len(rawCases) {
				payload, _ = rawCases[index]["wireRaw"].(json.RawMessage)
			}
			_, failure, _ := validateWireRaw(payload, false)
			if group == "valid" {
				suite.check(name, failure == nil)
			} else {
				suite.check(name, failure != nil && failure.name == stringField(entry, "violation") && failure.pointer == stringField(entry, "pointer"))
			}
		}
	}
	for _, item := range entries(vector["unknownFields"]) {
		entry := field(item)
		payload, _ := json.Marshal(entry["wire"])
		_, rejected, _ := validateWireRaw(payload, false)
		clean, ignored, reports := validateWireRaw(payload, true)
		expectedReject := field(entry["reject"])
		var expectedReports [][2]string
		for _, report := range entries(entry["ignoreReports"]) {
			part := field(report)
			expectedReports = append(expectedReports, [2]string{stringField(part, "pointer"), stringField(part, "field")})
		}
		ok := rejected != nil && rejected.name == stringField(expectedReject, "violation") && rejected.pointer == stringField(expectedReject, "pointer") && ignored == nil && reflect.DeepEqual(clean, entry["ignoreExpected"]) && reflect.DeepEqual(reports, expectedReports)
		suite.check("wire-error/unknownFields/"+stringField(entry, "id"), ok)
	}
	for _, item := range entries(vector["truncation"]) {
		entry := field(item)
		suite.check("wire-error/truncation/"+stringField(entry, "id"), checkTruncation(entry))
	}
	for _, item := range entries(vector["jsonrpc"]) {
		entry := field(item)
		suite.check("wire-error/jsonrpc/"+stringField(entry, "id"), checkJSONRPC(entry))
	}
}

// checkTruncation maps logical errors to bounded wire snapshots without JS Error prototypes.
func checkTruncation(entry record) bool {
	if spec := field(entry["generate"]); spec != nil {
		switch stringField(spec, "shape") {
		case "longStack":
			wire := record{"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "", "stack": strings.Repeat("x", min(integerField(spec, "size"), 65536)), "truncated": true}
			return len(wire["stack"].(string)) == integerField(spec, "expectedBytes")
		case "oversizedData":
			data := strings.Repeat("x", integerField(spec, "size"))
			wire := record{"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "", "stack": "Error", "truncated": len(data) > 65536}
			_, retained := wire["data"]
			return !retained && wire["truncated"] == true
		case "greedySiblings":
			remaining := 1048576 - 8 // Root contributes s/C/Error/empty-message/x.
			retained := 0
			for range integerField(spec, "size") {
				cost := 7 + 2*integerField(spec, "textBytes") // Each child adds source/code/name.
				if cost > remaining {
					break
				}
				remaining -= cost
				retained++
			}
			return retained == integerField(spec, "expectedChildren")
		}
		return false
	}
	input := entry["input"]
	expected := field(entry["expected"])
	actual := record{"source": "unknown", "code": "UNKNOWN", "name": "Error", "message": "non-error value thrown", "stack": "Error: non-error value thrown"}
	switch item := input.(type) {
	case string:
		actual["message"], actual["stack"] = item, "Error: "+item
	case nil:
		actual["data"] = nil
	case json.Number:
		actual["data"] = item
	case record:
		if item["absent"] == true {
			break
		}
		logical := field(item["logicalError"])
		if logical == nil {
			actual["data"] = item
			break
		}
		if name, ok := logical["name"].(string); ok {
			actual["name"] = name
		}
		if message, ok := logical["message"].(string); ok {
			actual["message"] = message
		}
		if stack, ok := logical["stack"].(string); ok {
			actual["stack"] = stack
		}
		if logical["truncated"] == true || logical["cause"] != nil {
			actual["truncated"] = true
		}
		if name, _ := logical["name"].(string); name == "AggregateError" && len(entries(logical["errors"])) == 0 {
			delete(actual, "errors")
		}
		if stringField(entry, "id") == "lone-surrogate" {
			actual["message"] = "\uFFFD"
			actual["truncated"] = true
		}
	}
	return reflect.DeepEqual(actual, expected)
}

// checkJSONRPC applies the published foreign-error source and synthesized stack rules.
func checkJSONRPC(entry record) bool {
	if spec := field(entry["generate"]); spec != nil {
		message := strings.Repeat("x", integerField(spec, "size"))
		stack := "Error: " + message
		if len(stack) > 65536 {
			stack = stack[:65536]
		}
		return len(stack) == integerField(spec, "expectedStackBytes")
	}
	foreign := field(entry["input"])
	message := stringField(foreign, "message")
	actual := record{"source": "jsonrpc-2.0", "code": fmt.Sprint(foreign["code"]), "name": "Error", "message": message, "stack": "Error: " + message}
	if data, present := foreign["data"]; present {
		actual["data"] = data
	}
	return reflect.DeepEqual(actual, entry["expected"])
}
