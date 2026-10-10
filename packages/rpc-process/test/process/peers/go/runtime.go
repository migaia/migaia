package main

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Runtime directory names share the current logical method grammar, without a second catalog.
var runtimeMethodName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,39}(\.[A-Za-z][A-Za-z0-9_-]{0,39})*$`)

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
			if key != "name" && key != "supportedModes" && key != "modeSource" && key != "idempotent" {
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
	return true
}

// U36 uses one baseline directory and physical batch contract, independent of optional runtime profiles.
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
	failure["source"] = "@migaia/rpc/core"
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
	// New U25/binary profiles are not installed and cannot be silently treated as ordinary calls.
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
