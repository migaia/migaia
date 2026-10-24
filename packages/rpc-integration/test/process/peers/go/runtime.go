package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/maphash"
	"math"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Runtime directory names share the current logical method grammar, without a second catalog.
var runtimeMethodName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,39}(\.[A-Za-z][A-Za-z0-9_-]{0,39})*$`)

// Schema fields and keywords are the closed optional directory extension shared by all peers.
var runtimeSchemaFields = []string{"input", "output", "yield"}
var runtimeSchemaKeys = []string{"type", "properties", "required", "items", "enum", "const", "anyOf", "$defs", "$ref"}
var runtimeSchemaTypes = []string{"null", "boolean", "object", "array", "number", "integer", "string"}
var runtimeSchemaBadEscape = regexp.MustCompile(`~($|[^01])`)

// runtimeSchemaData admits only portable JSON within the directory owner's recursion budget.
func runtimeSchemaData(value any, depth int) bool {
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
	if !runtimeSchemaData(value, 0) {
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
	schema, ok := value.(record)
	if !ok {
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
			members, ok := child.(record)
			if !ok {
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

// validRuntimeDescription admits only a closed v2 directory bound to the authenticated peer.
func validRuntimeDescription(value record, remoteID string) bool {
	if len(value) != 3 || integerField(value, "schemaVersion") != 2 {
		return false
	}
	identity := field(value["self"])
	name, nameOK := identity["name"].(string)
	id, idOK := identity["instanceId"].(string)
	if len(identity) != 2 || !nameOK || !idOK || len(name) == 0 || utf8.RuneCountInString(name) > 128 || len(id) == 0 || utf8.RuneCountInString(id) > 128 || id != remoteID {
		return false
	}
	methods, ok := value["methods"].([]any)
	if !ok || len(methods) > 4096 {
		return false
	}
	seen := map[string]bool{}
	for _, raw := range methods {
		method := field(raw)
		for key := range method {
			if key != "name" && key != "supportedModes" && key != "modeSource" && key != "idempotent" && !slices.Contains(runtimeSchemaFields, key) {
				return false
			}
		}
		for _, key := range runtimeSchemaFields {
			if schema, present := method[key]; present && !validRuntimeSchema(schema) {
				return false
			}
		}
		name, ok := method["name"].(string)
		if !ok || len(name) > 128 || !runtimeMethodName.MatchString(name) || seen[name] {
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
	}
	// Method schemas consume the complete directory's existing portable nesting budget.
	return runtimeSchemaData(value, 0)
}

// The runtime baseline uses one directory and physical batch contract, independent of optional runtime profiles.
const (
	runtimeCapability            = "runtime-api@1"
	batchCapability              = "batch@1"
	runtimeDescribeMethod        = "migaia.remote.runtime.describe"
	runtimeStreamPrefix          = "migaia.remote.runtime.stream."
	runtimeMethodUnavailable     = "Runtime method is not provided by this peer"
	runtimeCapabilityUnavailable = "Runtime operation is not supported by this peer"
	runtimePayloadInvalid        = "Runtime method payload is invalid"
)

// An unnegotiated optional profile is reported without executing it or retiring unrelated baseline calls.
var errUnsupportedRuntimeProfile = errors.New("unsupported runtime profile")

// CLI freezes this conservative declaration before any business session is admitted.
var businessRequestIdempotent = true

// baselineAgreement admits only the implemented network baseline; the pure negotiation oracle stays unchanged.
func baselineAgreement(chosen agreement) bool {
	return chosen.Major == 1 && chosen.Minor == 1 && chosen.Codec == "json" && slices.Contains(chosen.Capabilities, runtimeCapability) && slices.Contains(chosen.Capabilities, batchCapability)
}

// runtimeFailure uses registered core codes rather than introducing language-fixture provider codes.
func runtimeFailure(code, message string) record {
	failure := wireError(code, message)
	failure["source"] = "rpc.endpoint"
	return failure
}

// runtimeDescription lists exactly installed logical routes; stream routes retain their reserved wire names.
func runtimeDescription(business, host, stream bool) record {
	// The scalar methods are registered by the matching basic or business dispatcher, never inferred from types.
	names := []string{"echo", "peer.echo", "peer.wait", "peer.finish", "peer.error"}
	if business {
		names = []string{"echo", "peer.echo", "peer.received", "peer.aborts", "peer.stats", "peer.trace", "peer.error", "peer.wait", "peer.busy", "peer.pause", "peer.crash", "p.f.request", "p.f.oneWay"}
		if host {
			names = append(names, "migaia.remote.host.use", "migaia.remote.host.unUse", "migaia.remote.host.inspect")
		}
	}
	// Only the safe cold directory is serialized; credentials, handlers and business values remain local.
	methods := make([]any, 0, len(names)+2)
	for _, name := range names {
		modes := []string{"request", "notify"}
		if name == "peer.wait" || name == "p.f.request" || strings.HasPrefix(name, "migaia.remote.host.") {
			modes = []string{"request"}
		}
		if name == "p.f.oneWay" {
			modes = []string{"notify"}
		}
		method := record{"name": name, "supportedModes": modes, "modeSource": "declared"}
		if name == "p.f.request" {
			method["idempotent"] = businessRequestIdempotent
		}
		methods = append(methods, method)
	}
	if business && stream {
		for _, name := range []string{"p.f.generator", "p.f.asyncGenerator"} {
			methods = append(methods, record{"name": name, "supportedModes": []string{"stream"}, "modeSource": "declared"})
		}
	}
	return record{"schemaVersion": 2, "self": record{"name": "go-peer", "instanceId": "go-peer"}, "methods": methods}
}

// baselineMembers recognizes only the native physical batch; malformed siblings are reported individually.
func baselineMembers(frame record) ([]record, bool, error) {
	if frame["kind"] != "batch" {
		return []record{frame}, false, nil
	}
	// A batch's closed outer shape and nonempty member array belong to the physical protocol.
	values, ok := frame["envelopes"].([]any)
	if !ok || len(values) == 0 || len(frame) != 2 {
		return nil, true, errors.New("invalid batch frame")
	}
	// Record order is preserved even when an invalid member cannot enter dispatch.
	members := make([]record, 0, len(values))
	for _, value := range values {
		member, ok := value.(record)
		if !ok || member["kind"] == "batch" {
			fmt.Fprintln(os.Stderr, "PEER_ERROR PROTOCOL_INVALID")
			continue
		}
		members = append(members, member)
	}
	return members, true, nil
}

// validateBaselineMember rejects malformed supported envelopes before a handler can inspect their payload.
func validateBaselineMember(message record) error {
	// New runtime-api/binary profiles are not installed and cannot be silently treated as ordinary calls.
	kind, _ := message["kind"].(string)
	if strings.HasPrefix(kind, "runtime-") || strings.HasPrefix(kind, "rpc.runtime-api.") || strings.HasPrefix(kind, "rpc.native-binary.") {
		return errUnsupportedRuntimeProfile
	}
	expected := kind
	if kind == "discovery" {
		expected = stringField(field(field(message["data"])["route"]), "type")
		if expected != "discovery-query" && expected != "discovery-response" {
			return errors.New("invalid discovery route")
		}
	}
	if kind != "request" && kind != "variation" && kind != "discovery" && kind != "stream" && kind != "response" {
		return nil
	}
	if _, err := routeOf(message, expected); err != nil {
		return err
	}
	if id, ok := message["id"].(string); !ok || id == "" {
		return errors.New("invalid envelope identifier")
	}
	if kind == "request" {
		if method, ok := message["method"].(string); !ok || method == "" {
			return errors.New("invalid request method")
		}
	}
	return nil
}

// baselineDiscovery replies with the selected receiver identity used by the production core.
func baselineDiscovery(message record) record {
	header := businessRoute(message, "discovery-response")
	incoming := field(field(message["data"])["route"])
	header["resolvedTargetId"] = incoming["targetId"]
	header["receiverId"] = incoming["targetId"]
	header["platform"] = "Process"
	return record{"kind": "discovery", "id": message["id"], "version": message["version"], "acceptVersions": message["acceptVersions"], "data": record{"route": header}}
}
