package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/maphash"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// maxForwardRouteNodes admits the origin plus the canonical maximum of sixteen forwarding hosts.
const maxForwardRouteNodes = 17

// Runtime directory names share the current logical method grammar, without a second catalog.
var runtimeMethodName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,39}(\.[A-Za-z][A-Za-z0-9_-]{0,39})*$`)

// Schema fields and keywords are the closed optional directory extension shared by all peers.
var runtimeSchemaFields = []string{"input", "output", "yield"}
var runtimeSchemaKeys = []string{"type", "properties", "required", "items", "enum", "const", "anyOf", "$defs", "$ref"}
var runtimeSchemaTypes = []string{"null", "boolean", "object", "array", "number", "integer", "string"}
var runtimeSchemaBadEscape = regexp.MustCompile(`~($|[^01])`)

// schemaValue lends ordered fields and the actual JSON scalar representation without cloning values.
func schemaValue(value any) any {
	switch item := value.(type) {
	case *orderedRecord:
		return item.values
	case int:
		return float64(item)
	case int64:
		return float64(item)
	}
	return value
}

// runtimeSchemaData admits only portable JSON within the directory owner's recursion budget.
func runtimeSchemaData(value any, depth int) bool {
	value = schemaValue(value)
	if depth > 64 {
		return false
	}
	switch item := value.(type) {
	case nil, bool:
		return true
	case json.Number:
		number, err := strconv.ParseFloat(string(item), 64)
		return err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	case float64:
		return !math.IsNaN(item) && !math.IsInf(item, 0)
	case string:
		return utf8.ValidString(item)
	case []any:
		for _, member := range item {
			if !runtimeSchemaData(member, depth+1) {
				return false
			}
		}
		return true
	case record:
		for key, member := range item {
			if !utf8.ValidString(key) || !runtimeSchemaData(member, depth+1) {
				return false
			}
		}
		return true
	}
	return false
}

// runtimeSchemaEqual treats enum objects independently of key order and numbers by JSON value.
func runtimeSchemaEqual(left, right any) bool {
	left, right = schemaValue(left), schemaValue(right)
	switch item := left.(type) {
	case nil:
		return right == nil
	case bool:
		other, ok := right.(bool)
		return ok && item == other
	case string:
		other, ok := right.(string)
		return ok && item == other
	case json.Number:
		other, ok := right.(json.Number)
		if !ok {
			return false
		}
		a, _ := strconv.ParseFloat(string(item), 64)
		b, _ := strconv.ParseFloat(string(other), 64)
		return a == b
	case float64:
		other, ok := right.(float64)
		return ok && item == other
	case []any:
		other, ok := right.([]any)
		if !ok || len(item) != len(other) {
			return false
		}
		for index, member := range item {
			if !runtimeSchemaEqual(member, other[index]) {
				return false
			}
		}
		return true
	case record:
		other, ok := right.(record)
		if !ok || len(item) != len(other) {
			return false
		}
		for key, member := range item {
			candidate, present := other[key]
			if !present || !runtimeSchemaEqual(member, candidate) {
				return false
			}
		}
		return true
	}
	return false
}

// runtimeSchemaHashWord appends one fixed-width scalar to a private structural hash.
func runtimeSchemaHashWord(hash *maphash.Hash, value uint64) {
	// A fixed width keeps adjacent child digests unambiguous.
	var bytes [8]byte
	binary.LittleEndian.PutUint64(bytes[:], value)
	_, _ = hash.Write(bytes[:])
}

// runtimeSchemaHash indexes already-admitted JSON values; collision buckets retain exact equality.
// Array order participates, object field order does not, and both numeric forms use original float equality.
func runtimeSchemaHash(value any, seed maphash.Seed) uint64 {
	value = schemaValue(value)
	// Every node uses the validation owner's seed; no digest is serialized.
	var hash maphash.Hash
	hash.SetSeed(seed)
	switch item := value.(type) {
	case nil:
		_ = hash.WriteByte(0)
	case bool:
		_ = hash.WriteByte(1)
		if item {
			_ = hash.WriteByte(1)
		} else {
			_ = hash.WriteByte(0)
		}
	case string:
		_ = hash.WriteByte(2)
		_, _ = hash.WriteString(item)
	case json.Number:
		// Admission already proved a finite number; normalize signed zero for equality.
		number, _ := strconv.ParseFloat(string(item), 64)
		if number == 0 {
			number = 0
		}
		_ = hash.WriteByte(3)
		runtimeSchemaHashWord(&hash, math.Float64bits(number))
	case float64:
		if item == 0 {
			item = 0
		}
		_ = hash.WriteByte(3)
		runtimeSchemaHashWord(&hash, math.Float64bits(item))
	case []any:
		_ = hash.WriteByte(4)
		runtimeSchemaHashWord(&hash, uint64(len(item)))
		for _, member := range item {
			runtimeSchemaHashWord(&hash, runtimeSchemaHash(member, seed))
		}
	case record:
		_ = hash.WriteByte(5)
		runtimeSchemaHashWord(&hash, uint64(len(item)))
		// Seeded per-field hashes combine commutatively, preserving object key-order independence.
		var fields uint64
		for key, member := range item {
			// One keyed field digest prevents map iteration order from affecting the bucket.
			var field maphash.Hash
			field.SetSeed(seed)
			_, _ = field.WriteString(key)
			runtimeSchemaHashWord(&field, runtimeSchemaHash(member, seed))
			fields += field.Sum64()
		}
		runtimeSchemaHashWord(&hash, fields)
	}
	return hash.Sum64()
}

// runtimeSchemaContext owns one synchronous node/reference walk and its private enum hash seed.
type runtimeSchemaContext struct {
	// Nodes prove local reference targets without traversing the reference graph.
	nodes map[string]bool
	// References remain in their original encounter order until the walk completes.
	references []string
	// A private seed prevents an input from choosing structural-hash collision buckets.
	seed maphash.Seed
}

// validRuntimeSchema checks schema nodes and local pointers without resolving references recursively.
func validRuntimeSchema(value any) bool {
	// Directory.methods[index].schema contributes three original portable container levels.
	if !runtimeSchemaData(value, 3) {
		return false
	}
	// All mutable traversal state belongs to this one synchronous validation.
	context := runtimeSchemaContext{nodes: map[string]bool{}, seed: maphash.MakeSeed()}
	if !context.visit(value, "") {
		return false
	}
	for _, pointer := range context.references {
		if !context.nodes[pointer] {
			return false
		}
	}
	return true
}

// visit retains original schema validation and failure order while borrowing explicit walk state.
func (context *runtimeSchemaContext) visit(value any, path string) bool {
	schema := field(value)
	if schema == nil {
		return false
	}
	context.nodes[path] = true
	for key, child := range schema {
		if !slices.Contains(runtimeSchemaKeys, key) {
			return false
		}
		switch key {
		case "type", "required":
			values, array := child.([]any)
			if key == "type" && !array {
				values = []any{child}
			} else if !array {
				return false
			}
			if key == "type" && len(values) == 0 {
				return false
			}
			seen := map[string]bool{}
			for _, member := range values {
				text, ok := member.(string)
				if !ok || seen[text] || key == "type" && !slices.Contains(runtimeSchemaTypes, text) {
					return false
				}
				seen[text] = true
			}
		case "properties", "$defs":
			members := field(child)
			if members == nil {
				return false
			}
			for name, member := range members {
				pointer := strings.ReplaceAll(strings.ReplaceAll(name, "~", "~0"), "/", "~1")
				if !context.visit(member, path+"/"+key+"/"+pointer) {
					return false
				}
			}
		case "items":
			if !context.visit(child, path+"/items") {
				return false
			}
		case "enum", "anyOf":
			members, ok := child.([]any)
			if !ok || len(members) == 0 {
				return false
			}
			// Hash each member once; only actual hash collisions need structural equality.
			seen := map[uint64][]any{}
			for index, member := range members {
				if key == "anyOf" && !context.visit(member, path+"/anyOf/"+strconv.Itoa(index)) {
					return false
				}
				if key == "enum" {
					// Exact equality below remains authoritative even when hashes collide.
					digest := runtimeSchemaHash(member, context.seed)
					for _, earlier := range seen[digest] {
						if runtimeSchemaEqual(member, earlier) {
							return false
						}
					}
					seen[digest] = append(seen[digest], member)
				}
			}
		case "$ref":
			pointer, ok := child.(string)
			if !ok || !strings.HasPrefix(pointer, "#/$defs/") || runtimeSchemaBadEscape.MatchString(pointer) {
				return false
			}
			context.references = append(context.references, pointer[1:])
		}
	}
	return true
}

// hasFields reads only required known fields; unknown protocol metadata is ignored under R17.
func hasFields(value any, required []string) bool {
	fields := field(value)
	if fields == nil {
		return false
	}
	for _, name := range required {
		if _, exists := fields[name]; !exists {
			return false
		}
	}
	return true
}
func identifier(value any) bool {
	text, ok := value.(string)
	return ok && len(text) > 0 && utf8.RuneCountInString(text) <= 128
}
func stringList(value any, maximum int, pattern *regexp.Regexp, nonempty bool) bool {
	items, ok := value.([]any)
	if !ok || len(items) > maximum || nonempty && len(items) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, item := range items {
		text, ok := item.(string)
		if !ok || !pattern.MatchString(text) || seen[text] {
			return false
		}
		seen[text] = true
	}
	return true
}
func validGeneration(value any) bool {
	fields := field(value)
	_, number := asInt(fields["value"])
	return hasFields(value, []string{"kind", "value", "providerId"}) && (fields["kind"] == "restart" || fields["kind"] == "session") && number && identifier(fields["providerId"])
}

// validRuntimeDescription retains the original schema algorithm, now directly bound to schema3 identity.
func validRuntimeDescription(value any, remoteID string) bool {
	fields := field(value)
	identity := field(fields["self"])
	if !hasFields(value, []string{"schemaVersion", "self", "methods"}) || integerField(fields, "schemaVersion") != 3 || !hasFields(fields["self"], []string{"name", "instanceId", "generation"}) || !identifier(identity["name"]) || !identifier(identity["instanceId"]) || stringField(identity, "instanceId") != remoteID || !validGeneration(identity["generation"]) {
		return false
	}
	if node, present := fields["nodeId"]; present {
		text, ok := node.(string)
		if !ok || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(text) {
			return false
		}
	}
	methods, ok := fields["methods"].([]any)
	if !ok || len(methods) > 4096 {
		return false
	}
	seen := map[string]bool{}
	for _, raw := range methods {
		method := field(raw)
		name := stringField(method, "name")
		if !hasFields(raw, []string{"name", "supportedModes", "modeSource"}) || !identifier(name) || !runtimeMethodName.MatchString(name) || seen[name] {
			return false
		}
		seen[name] = true
		modes, ok := method["supportedModes"].([]any)
		if !ok || len(modes) == 0 || len(modes) > 3 {
			return false
		}
		accepted := map[string]bool{}
		for _, rawMode := range modes {
			mode, ok := rawMode.(string)
			if !ok || mode != "request" && mode != "notify" && mode != "stream" || accepted[mode] {
				return false
			}
			accepted[mode] = true
		}
		if method["modeSource"] != "declared" && method["modeSource"] != "generated-routes" {
			return false
		}
		if declaration, exists := method["idempotent"]; exists {
			if _, ok := declaration.(bool); !ok {
				return false
			}
		}
		if via, exists := method["forwardedVia"]; exists {
			text, ok := via.(string)
			if !ok || !regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,39}$`).MatchString(text) {
				return false
			}
		}
		for _, key := range runtimeSchemaFields {
			if schema, present := method[key]; present && !validRuntimeSchema(schema) {
				return false
			}
		}
	}
	return true
}

// validFlatError admits shared/cyclic integer graph references without recursively following causes.
func validFlatError(value any) bool {
	fields := field(value)
	nodes, ok := fields["nodes"].([]any)
	root, rootOK := asInt(fields["root"])
	if !hasFields(value, []string{"root", "nodes"}) || !ok || len(nodes) == 0 || len(nodes) > 1024 || !rootOK || root >= len(nodes) {
		return false
	}
	totalBytes := 0
	for _, raw := range nodes {
		node := field(raw)
		if !hasFields(raw, []string{"source", "code", "name", "message", "stack"}) {
			return false
		}
		for _, name := range []string{"source", "code", "name", "message", "stack"} {
			text, ok := node[name].(string)
			if !ok || name != "message" && text == "" || len(text) > 65_536 {
				return false
			}
			totalBytes += len(text)
		}
		if cause, exists := node["cause"]; exists {
			index, ok := asInt(cause)
			if !ok || index >= len(nodes) {
				return false
			}
		}
		if children, exists := node["errors"]; exists {
			items, ok := children.([]any)
			if !ok || len(items) == 0 {
				return false
			}
			for _, child := range items {
				index, ok := asInt(child)
				if !ok || index >= len(nodes) {
					return false
				}
			}
		}
		if data, exists := node["data"]; exists {
			if errorDataTextBytes(data, 17) < 0 {
				return false
			}
			encoded, err := appendJSON(nil, data)
			if err != nil {
				return false
			}
			totalBytes += len(encoded)
		}
		if route, exists := node["route"]; exists {
			items, ok := route.([]any)
			if !ok || len(items) < 1 || len(items) > maxForwardRouteNodes {
				return false
			}
			for _, item := range items {
				text, ok := item.(string)
				if !ok || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(text) {
					return false
				}
				totalBytes += len(item.(string))
			}
		}
		if totalBytes > 1_048_576 {
			return false
		}
		if truncated, exists := node["truncated"]; exists && truncated != true {
			return false
		}
	}
	return true
}

// errorDataTextBytes reuses the original per-data text charge while admitting only canonical portable records.
func errorDataTextBytes(value any, depth int) int {
	if depth > 64 {
		return -1
	}
	total := 0
	switch item := value.(type) {
	case nil, bool:
	case float64:
		if math.IsInf(item, 0) || math.IsNaN(item) {
			return -1
		}
	case int, int64:
	case string:
		total = len(item)
	case []any:
		for _, child := range item {
			count := errorDataTextBytes(child, depth+1)
			if count < 0 {
				return -1
			}
			total += count
		}
	case *orderedRecord:
		if marker, exists := item.values["$rpc"]; exists {
			text, ok := item.values["base64url"].(string)
			if marker != "bytes" || len(item.names) != 2 || !ok {
				return -1
			}
			decoded, err := base64.RawURLEncoding.Strict().DecodeString(text)
			if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != text {
				return -1
			}
			total = len(text)
		} else {
			for _, key := range item.names {
				count := errorDataTextBytes(item.values[key], depth+1)
				if count < 0 {
					return -1
				}
				total += len(key) + count
			}
		}
	default:
		return -1
	}
	if total > 65_536 {
		return -1
	}
	return total
}

// validHandshake validates pure fields only; actual version/extension/auth selection stays in handshake.
func validHandshake(value any) bool {
	fields := field(value)
	if fields["profile"] != protocol || fields["kind"] != "handshake" {
		return false
	}
	step := fields["step"]
	if step == "reject" {
		return hasFields(value, []string{"profile", "kind", "step", "error"}) && validFlatError(fields["error"])
	}
	required := []string{"profile", "kind", "step", "peer", "directory", "extensions"}
	if step == "hello" {
		required = append(required, "versions", "codecs")
	} else if step == "accept" {
		required = append(required, "major", "minor", "codec")
	} else if step == "pending" {
		required = []string{"profile", "kind", "step", "peer", "remainingMs"}
	} else {
		return false
	}
	peer := field(fields["peer"])
	if !hasFields(value, required) || !hasFields(fields["peer"], []string{"id", "runtime"}) || !identifier(peer["id"]) || !runtimePattern.MatchString(stringField(peer, "runtime")) || step != "pending" && (!validRuntimeDescription(fields["directory"], stringField(peer, "id")) || !stringList(fields["extensions"], 64, extensionPattern, false)) {
		return false
	}
	if version, exists := peer["runtimeVersion"]; exists {
		if _, ok := version.(string); !ok {
			return false
		}
	}
	if implementation, exists := peer["implementation"]; exists {
		if !hasFields(implementation, []string{"name", "version"}) {
			return false
		}
		for _, name := range []string{"name", "version"} {
			if _, ok := field(implementation)[name].(string); !ok {
				return false
			}
		}
	}
	if auth, exists := fields["auth"]; exists && !runtimeSchemaData(auth, 0) {
		return false
	}
	if step == "pending" {
		remaining := schemaValue(fields["remainingMs"])
		if encoded, ok := remaining.(json.Number); ok {
			parsed, err := strconv.ParseFloat(string(encoded), 64)
			if err != nil {
				return false
			}
			remaining = parsed
		}
		number, ok := remaining.(float64)
		return ok && !math.IsNaN(number) && !math.IsInf(number, 0) && number >= 0 && number <= 2_147_483_647
	}
	if step == "accept" {
		_, major := asInt(fields["major"])
		_, minor := asInt(fields["minor"])
		return major && minor && fields["codec"] == "json"
	}
	versions, ok := fields["versions"].([]any)
	if !ok || len(versions) == 0 || len(versions) > 8 || !stringList(fields["codecs"], 16, codecPattern, true) || !slices.Contains(entries(fields["codecs"]), any("json")) {
		return false
	}
	seen := map[int]bool{}
	for _, raw := range versions {
		version := field(raw)
		major, majorOK := asInt(version["major"])
		_, minorOK := asInt(version["minor"])
		if !hasFields(raw, []string{"major", "minor"}) || !majorOK || major < 1 || !minorOK || seen[major] {
			return false
		}
		seen[major] = true
	}
	if required, exists := fields["requiredExtensions"]; exists {
		if !stringList(required, 64, extensionPattern, false) {
			return false
		}
		for _, extension := range entries(required) {
			if !slices.Contains(entries(fields["extensions"]), extension) {
				return false
			}
		}
	}
	return true
}
func supportsVersion(value record) bool {
	for _, raw := range entries(value["versions"]) {
		version := field(raw)
		if integerField(version, "major") == 2 && integerField(version, "minor") >= 0 {
			return slices.Contains(entries(value["codecs"]), any("json"))
		}
	}
	return false
}

// validRoute and validTask validate known correlation fields without projecting native input.
func validRoute(value any) bool {
	fields := field(value)
	if !hasFields(value, []string{"applicationVersion", "senderId", "receiverId", "targetId", "sentAt"}) {
		return false
	}
	for _, key := range []string{"applicationVersion", "senderId", "receiverId", "targetId"} {
		if !identifier(fields[key]) {
			return false
		}
	}
	for _, key := range []string{"sentAt", "remainingMs"} {
		if number, exists := fields[key]; exists {
			value, ok := number.(float64)
			if !ok {
				if integer, ok := number.(int64); ok {
					value = float64(integer)
				} else if integer, ok := number.(int); ok {
					value = float64(integer)
				} else {
					return false
				}
			}
			if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) || key == "remainingMs" && value > 2_147_483_647 {
				return false
			}
		}
	}
	if trace, exists := fields["trace"]; exists {
		text, ok := trace.(string)
		if !ok || !regexp.MustCompile(`^[ -~]{1,256}$`).MatchString(text) {
			return false
		}
	}
	if route, exists := fields["forwardRoute"]; exists {
		items, ok := route.([]any)
		if !ok || len(items) > maxForwardRouteNodes {
			return false
		}
		for _, item := range items {
			if !identifier(item) {
				return false
			}
		}
	}
	return true
}
func validTask(value any) bool {
	fields := field(value)
	mode := fields["mode"]
	if !hasFields(value, []string{"mode", "callerId", "callerGeneration", "targetGeneration"}) || !identifier(fields["callerId"]) || !validGeneration(fields["callerGeneration"]) || !validGeneration(fields["targetGeneration"]) {
		return false
	}
	if mode == "request" || mode == "notify" || mode == "stream" {
		name := stringField(fields, "method")
		return identifier(name) && runtimeMethodName.MatchString(name)
	}
	return mode == "group" || mode == "outcome"
}
func validOptions(value any, mode any) bool {
	fields := field(value)
	if !hasFields(value, nil) {
		return false
	}
	for _, key := range []string{"orderKey", "idempotencyKey"} {
		if value, exists := fields[key]; exists && !identifier(value) {
			return false
		}
	}
	if cancel, exists := fields["cancel"]; exists && cancel != "before-start" {
		return false
	}
	_, key := fields["idempotencyKey"]
	return mode != "notify" || !key || fields["cancel"] == "before-start"
}

// validStepOutcomes retains failure-stop ordering rather than treating a group as independent batch siblings.
func validStepOutcomes(value any) bool {
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return false
	}
	failed := false
	for _, raw := range items {
		outcome := field(raw)
		switch outcome["state"] {
		case "success":
			if failed || !hasFields(raw, []string{"state"}) {
				return false
			}
			if result, exists := outcome["result"]; exists && !runtimeSchemaData(result, 0) {
				return false
			}
		case "failure":
			if failed || !hasFields(raw, []string{"state", "error"}) || !validFlatError(outcome["error"]) {
				return false
			}
			failed = true
		case "not-executed":
			if !failed || !hasFields(raw, []string{"state"}) {
				return false
			}
		default:
			return false
		}
	}
	return true
}
func validCompletion(value any, mode string) bool {
	fields := field(value)
	if fields["ok"] == false {
		return hasFields(value, []string{"ok", "error"}) && validFlatError(fields["error"])
	}
	if fields["ok"] != true || !hasFields(value, []string{"ok"}) {
		return false
	}
	if mode == "group" {
		return validStepOutcomes(fields["result"])
	}
	if result, exists := fields["result"]; exists {
		return runtimeSchemaData(result, 0)
	}
	return true
}
func validOutcomeStore(value any) bool {
	fields := field(value)
	if fields["kind"] == "unavailable" {
		return hasFields(value, []string{"kind", "continuity"}) && fields["continuity"] == "unavailable"
	}
	return hasFields(value, []string{"kind", "epoch", "continuity"}) && (fields["kind"] == "memory" || fields["kind"] == "external") && identifier(fields["epoch"]) && (fields["continuity"] == "retained" || fields["continuity"] == "lost-since-restart")
}

// validStream keeps the canonical event-owned value/error/reason field and original semantic byte budget.
func validStream(value any) bool {
	event := field(value)
	seq, ok := asInt(event["seq"])
	if !ok {
		return false
	}
	fieldName := ""
	required := false
	switch event["event"] {
	case "open":
		if seq != 0 {
			return false
		}
	case "pull":
	case "item":
		fieldName, required = "value", true
	case "end":
		fieldName = "value"
	case "fail":
		fieldName, required = "error", true
	case "cancelled":
		fieldName = "error"
	case "finish-without-items":
		fieldName = "reason"
	default:
		return false
	}
	if !hasFields(value, []string{"event", "seq"}) {
		return false
	}
	member, present := event[fieldName]
	if required && !present {
		return false
	}
	if !present {
		return true
	}
	if fieldName == "value" {
		size := portableBytes(member, 0)
		return size >= 0 && size <= 16_384
	}
	return validFlatError(member)
}

// validFrame is the only operational grammar used by actual dispatch and independent vector checks.
func validFrame(value any) bool {
	fields := field(value)
	kind := fields["kind"]
	if fields["profile"] != protocol {
		return false
	}
	if kind == "handshake" {
		return validHandshake(value)
	}
	required := []string{"profile", "kind", "id", "route"}
	switch kind {
	case "call":
		required = append(required, "task", "options")
	case "group":
		required = append(required, "task", "options", "steps")
	case "result":
		required = append(required, "task")
	case "error":
		required = append(required, "task", "error")
	case "cancel":
		required = append(required, "task")
	case "stream":
		required = append(required, "task", "stream")
	case "control":
		required = append(required, "operation")
	case "directory":
		required = append(required, "directory")
	case "outcome":
		required = append(required, "task", "operation")
	default:
		return false
	}
	if !hasFields(value, required) || !identifier(fields["id"]) || !validRoute(fields["route"]) {
		return false
	}
	task := field(fields["task"])
	if kind != "control" && kind != "directory" && !validTask(fields["task"]) {
		return false
	}
	if extensions, exists := fields["extensions"]; exists && kind != "control" && kind != "directory" {
		if field(extensions) == nil || !runtimeSchemaData(extensions, 0) {
			return false
		}
	}
	for _, key := range []string{"error", "reason"} {
		if graph, exists := fields[key]; exists && (key == "error" && kind == "error" || key == "reason" && (kind == "cancel" || kind == "control")) && !validFlatError(graph) {
			return false
		}
	}
	if payload, exists := fields["payload"]; exists && kind == "call" && !runtimeSchemaData(payload, 0) {
		return false
	}
	switch kind {
	case "call":
		return (task["mode"] == "request" || task["mode"] == "notify" || task["mode"] == "stream") && validOptions(fields["options"], task["mode"])
	case "group":
		steps, ok := fields["steps"].([]any)
		if !ok || len(steps) == 0 || task["mode"] != "group" || !validOptions(fields["options"], task["mode"]) {
			return false
		}
		for _, raw := range steps {
			step := field(raw)
			if !hasFields(raw, []string{"method"}) || !runtimeMethodName.MatchString(stringField(step, "method")) {
				return false
			}
			if payload, exists := step["payload"]; exists && !runtimeSchemaData(payload, 0) {
				return false
			}
		}
		return true
	case "result":
		if task["mode"] == "group" {
			return validStepOutcomes(fields["result"])
		}
		if result, exists := fields["result"]; exists {
			return runtimeSchemaData(result, 0)
		}
		return true
	case "stream":
		return task["mode"] == "stream" && validStream(fields["stream"])
	case "control":
		return fields["operation"] == "ping" || fields["operation"] == "pong" || fields["operation"] == "drain"
	case "directory":
		return validRuntimeDescription(fields["directory"], stringField(field(field(fields["directory"])["self"]), "instanceId"))
	case "outcome":
		if task["mode"] != "outcome" {
			return false
		}
		if fields["operation"] == "lookup" {
			return identifier(fields["idempotencyKey"])
		}
		if fields["operation"] != "result" || !validOutcomeStore(fields["store"]) {
			return false
		}
		if fields["state"] == "pending" || fields["state"] == "unknown" {
			return true
		}
		outcome := field(fields["outcome"])
		mode := stringField(outcome, "mode")
		return fields["state"] == "done" && hasFields(fields["outcome"], []string{"mode", "targetGeneration", "completion"}) && (mode == "request" || mode == "notify" || mode == "stream" || mode == "group") && validGeneration(outcome["targetGeneration"]) && validCompletion(outcome["completion"], mode)
	}
	return true
}

// portableBytes migrates the original stream value counter; validation and accounting share one walk.
func portableBytes(value any, depth int) int {
	if depth > 64 {
		return -1
	}
	value = schemaValue(value)
	switch item := value.(type) {
	case nil:
		return 4
	case bool:
		if item {
			return 4
		}
		return 5
	case float64:
		if math.IsNaN(item) || math.IsInf(item, 0) {
			return -1
		}
		return 24
	case string:
		if !utf8.ValidString(item) {
			return -1
		}
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
			size := portableBytes(member, depth+1)
			if size < 0 {
				return -1
			}
			count += size
		}
		return count
	case record:
		count, index := 2, 0
		for key, member := range item {
			if index > 0 {
				count++
			}
			size := portableBytes(member, depth+1)
			if size < 0 {
				return -1
			}
			count += portableBytes(key, depth+1) + 1 + size
			index++
		}
		return count
	}
	return -1
}
