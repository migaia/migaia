// Independent native RPC peer. Standard-library IO and one ordered JSON owner carry migaia.rpc/2.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const maxFrameBytes = 16 * 1024 * 1024
const maxHandshakeBytes = 65536
const protocol = "migaia.rpc/2"

var errProtocol = errors.New("PROTOCOL_INVALID")
var errHandshakeInvalid = errors.New("HANDSHAKE_INVALID")
var errHandshakeIncompatible = errors.New("HANDSHAKE_INCOMPATIBLE")
var codecPattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,31}$`)
var extensionPattern = regexp.MustCompile(`^[a-z][a-z0-9.-]*@[1-9][0-9]*$`)
var runtimePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// Lookup maps never determine serialized key order.
type record = map[string]any

// orderedRecord stores each own field once and lends the same lookup to metadata admission.
type orderedRecord struct {
	// names retain the order supplied by the actual parser or constructor, without lexicographic sorting.
	names []string
	// values support O(1) field admission and business lookup on that same object.
	values record
}

// object constructs an actual wire object from explicitly ordered name/value pairs.
func object(pairs ...any) *orderedRecord {
	value := &orderedRecord{values: record{}}
	for index := 0; index < len(pairs); index += 2 {
		value.set(pairs[index].(string), pairs[index+1])
	}
	return value
}

// set replaces a duplicate JSON own field without changing its first insertion position.
func (value *orderedRecord) set(name string, member any) {
	if _, exists := value.values[name]; !exists {
		value.names = append(value.names, name)
	}
	value.values[name] = member
}

// field borrows an existing lookup; validators do not project or clone the business graph.
func field(value any) record {
	switch item := value.(type) {
	case *orderedRecord:
		if item != nil {
			return item.values
		}
	case record:
		return item
	}
	return nil
}
func entries(value any) []any                     { result, _ := value.([]any); return result }
func stringField(value record, key string) string { result, _ := value[key].(string); return result }
func integerField(value record, key string) int   { result, _ := asInt(value[key]); return result }

// readFrame checks the unsigned payload length before allocation. EOF between frames ends a session.
func readFrame(reader io.Reader, maximum int) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	length := binary.BigEndian.Uint32(header[:])
	if length == 0 || length > uint32(maximum) {
		return nil, errors.New("invalid frame length")
	}
	payload := make([]byte, int(length))
	_, err := io.ReadFull(reader, payload)
	return payload, err
}

// writeFrame writes exactly one bounded nonempty payload with its four-byte big-endian header.
func writeFrame(writer io.Writer, payload []byte) error {
	if len(payload) == 0 || len(payload) > maxFrameBytes {
		return errors.New("invalid frame length")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(payload)))
	if err := writeAll(writer, header[:]); err != nil {
		return err
	}
	return writeAll(writer, payload)
}

// writeAll handles short writes without silently dropping any payload bytes.
func writeAll(writer io.Writer, payload []byte) error {
	for len(payload) > 0 {
		written, err := writer.Write(payload)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		payload = payload[written:]
	}
	return nil
}

// readBaselineBody retains the original bounded Content-Length accounting fixture, without RPC admission.
func readBaselineBody(reader io.Reader) ([]byte, error) {
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
			return nil, errProtocol
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
		return nil, errProtocol
	}
	body := make([]byte, length)
	_, err := io.ReadFull(reader, body)
	return body, err
}

// runJSONBaseline parses and writes each payload once through the same ordered JSON owner as native RPC.
func runJSONBaseline(reader io.Reader, writer io.Writer) error {
	for {
		body, err := readBaselineBody(reader)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		value, err := readJSON(body)
		if err != nil {
			return err
		}
		if field(value)["xrtReverse"] == true {
			value, err = baselineReverse(reader, writer, field(value))
			if err != nil {
				return err
			}
		}
		if err = writeBaselineJSON(writer, value); err != nil {
			return err
		}
	}
}

// writeBaselineJSON lends the sole ordered encoder to both ordinary echo and the original bare reverse loop.
func writeBaselineJSON(writer io.Writer, value any) error {
	body, err := appendJSON(nil, value)
	if err != nil {
		return err
	}
	if _, err = fmt.Fprintf(writer, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		return err
	}
	return writeAll(writer, body)
}

// baselineReverse keeps the existing bounded accounting algorithm without dispatching any RPC profile or method.
func baselineReverse(reader io.Reader, writer io.Writer, control record) (any, error) {
	count := integerField(control, "count")
	payload, ok := control["payload"].(string)
	if !ok || count < 1 || count > 10000 {
		return nil, errProtocol
	}
	latencies := make([]any, 0, count)
	start := time.Now()
	for index := 0; index < count; index++ {
		round := time.Now()
		if err := writeBaselineJSON(writer, payload); err != nil {
			return nil, err
		}
		body, err := readBaselineBody(reader)
		if err != nil {
			return nil, err
		}
		reply, err := readJSON(body)
		if err != nil || reply != payload {
			return nil, errProtocol
		}
		latencies = append(latencies, time.Since(round).Nanoseconds())
	}
	return object("xrtReceipt", true, "calls", count, "elapsedNs", time.Since(start).Nanoseconds(), "latenciesNs", latencies, "clientInFlightPeak", 1, "burstSize", 1), nil
}

// readJSON uses the existing native decoder once; token order is retained instead of sorted by maps.
func readJSON(payload []byte) (any, error) {
	if !utf8.Valid(payload) || !validUnicodeEscapes(payload) {
		return nil, errProtocol
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	value, err := decodeValue(decoder, 0)
	if err != nil {
		return nil, errProtocol
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errProtocol
	}
	return value, nil
}

// decodeValue builds one ordered JSON graph directly from the standard decoder's tokens.
func decodeValue(decoder *json.Decoder, depth int) (any, error) {
	if depth > 128 {
		return nil, errProtocol
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, errProtocol
	}
	switch item := token.(type) {
	case json.Delim:
		if item == '{' {
			result := object()
			for decoder.More() {
				name, err := decoder.Token()
				if err != nil {
					return nil, errProtocol
				}
				key, ok := name.(string)
				if !ok {
					return nil, errProtocol
				}
				value, err := decodeValue(decoder, depth+1)
				if err != nil {
					return nil, err
				}
				result.set(key, value)
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return nil, errProtocol
			}
			return result, nil
		}
		if item == '[' {
			result := []any{}
			for decoder.More() {
				value, err := decodeValue(decoder, depth+1)
				if err != nil {
					return nil, err
				}
				result = append(result, value)
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return nil, errProtocol
			}
			return result, nil
		}
		return nil, errProtocol
	case json.Number:
		number, err := strconv.ParseFloat(string(item), 64)
		if err != nil || math.IsInf(number, 0) || math.IsNaN(number) {
			return nil, errProtocol
		}
		return number, nil
	default:
		return token, nil
	}
}

// appendString follows JSON.stringify's portable scalar escaping, without HTML or separator escaping.
func appendString(output []byte, value string) ([]byte, error) {
	if !utf8.ValidString(value) {
		return nil, errProtocol
	}
	output = append(output, '"')
	for _, char := range value {
		switch char {
		case '"', '\\':
			output = append(output, '\\', byte(char))
		case '\b':
			output = append(output, `\b`...)
		case '\f':
			output = append(output, `\f`...)
		case '\n':
			output = append(output, `\n`...)
		case '\r':
			output = append(output, `\r`...)
		case '\t':
			output = append(output, `\t`...)
		default:
			if char < 0x20 {
				const hex = "0123456789abcdef"
				output = append(output, '\\', 'u', '0', '0', hex[byte(char)>>4], hex[byte(char)&15])
			} else {
				output = utf8.AppendRune(output, char)
			}
		}
	}
	return append(output, '"'), nil
}

// appendNumber preserves finite IEEE-754 values and JSON.stringify's decimal/exponent thresholds.
func appendNumber(output []byte, value float64) ([]byte, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nil, errProtocol
	}
	if value == 0 {
		return append(output, '0'), nil
	}
	format := byte('f')
	absolute := math.Abs(value)
	if absolute < 1e-6 || absolute >= 1e21 {
		format = 'e'
	}
	text := strconv.FormatFloat(value, format, -1, 64)
	text = strings.ReplaceAll(strings.ReplaceAll(text, "e+0", "e+"), "e-0", "e-")
	return append(output, text...), nil
}

// appendJSON is the sole writer; no fallback map encoder silently sorts keys or copies the graph.
func appendJSON(output []byte, value any) ([]byte, error) {
	switch item := value.(type) {
	case nil:
		return append(output, "null"...), nil
	case bool:
		return strconv.AppendBool(output, item), nil
	case string:
		return appendString(output, item)
	case float64:
		return appendNumber(output, item)
	case int:
		return appendNumber(output, float64(item))
	case int64:
		return appendNumber(output, float64(item))
	case *orderedRecord:
		if item == nil {
			return append(output, "null"...), nil
		}
		output = append(output, '{')
		for index, name := range item.names {
			if index > 0 {
				output = append(output, ',')
			}
			var err error
			output, err = appendString(output, name)
			if err != nil {
				return nil, err
			}
			output = append(output, ':')
			output, err = appendJSON(output, item.values[name])
			if err != nil {
				return nil, err
			}
		}
		return append(output, '}'), nil
	case []any:
		output = append(output, '[')
		for index, member := range item {
			if index > 0 {
				output = append(output, ',')
			}
			var err error
			output, err = appendJSON(output, member)
			if err != nil {
				return nil, err
			}
		}
		return append(output, ']'), nil
	}
	return nil, errProtocol
}

// receive keeps the original native length and handshake ceilings before one semantic JSON parse.
func receive(reader io.Reader, handshake bool) (*orderedRecord, error) {
	maximum := maxFrameBytes
	if handshake {
		maximum = maxHandshakeBytes
	}
	payload, err := readFrame(reader, maximum)
	if err != nil {
		return nil, err
	}
	if handshake && len(payload) > maxHandshakeBytes {
		return nil, errHandshakeInvalid
	}
	value, err := readJSON(payload)
	result, ok := value.(*orderedRecord)
	if err != nil || !ok {
		return nil, errProtocol
	}
	return result, nil
}

// send writes the actual ordered object through the original length-frame owner.
func send(writer io.Writer, value *orderedRecord) error {
	payload, err := appendJSON(nil, value)
	if err != nil {
		return err
	}
	return writeFrame(writer, payload)
}

// asInt retains the existing nonnegative safe-integer metadata domain after native JSON number parsing.
func asInt(value any) (int, bool) {
	switch item := value.(type) {
	case int:
		return item, item >= 0 && item <= 9007199254740991
	case float64:
		return int(item), item >= 0 && item <= 9007199254740991 && math.Trunc(item) == item
	}
	return 0, false
}

// route constructs direct metadata; trace is supplied only by the current operation.
func route(sender, target string, trace any) *orderedRecord {
	result := object("applicationVersion", "1", "senderId", sender, "targetId", target, "receiverId", target, "sentAt", time.Now().UnixMilli())
	if trace != nil {
		result.set("trace", trace)
	}
	return result
}

// localIdentity is explicit for borrowed/standalone peers; owned launch uses its real bootstrap identity.
func localIdentity() *orderedRecord {
	return object("name", "go-peer", "instanceId", "go-peer", "generation", object("kind", "session", "value", 0, "providerId", "go-peer"))
}

// localOffer publishes the actual installed provider directory rather than reserved discovery methods.
func localOffer(identity *orderedRecord, business bool) *orderedRecord {
	return object("profile", protocol, "kind", "handshake", "step", "hello", "versions", []any{object("major", 2, "minor", 0)}, "codecs", []any{"json"}, "extensions", []any{}, "peer", object("id", field(identity)["instanceId"], "runtime", "go"), "directory", runtimeDescription(identity, business))
}

// acceptance reuses this side's original identity, directory and configured credential.
func acceptance(local *orderedRecord) *orderedRecord {
	value := object("profile", protocol, "kind", "handshake", "step", "accept", "major", 2, "minor", 0, "codec", "json", "extensions", []any{}, "peer", field(local)["peer"], "directory", field(local)["directory"])
	if auth, present := field(local)["auth"]; present {
		value.set("auth", auth)
	}
	return value
}

// handshake exchanges true bilateral hello and keeps the original strict configured token check.
func handshake(reader io.Reader, writer io.Writer, local *orderedRecord, token, parent string) (*orderedRecord, error) {
	if err := send(writer, local); err != nil {
		return nil, err
	}
	var remoteHello, selected *orderedRecord
	for {
		remote, err := receive(reader, true)
		if err != nil || !validHandshake(remote) {
			return nil, errHandshakeInvalid
		}
		value := field(remote)
		if value["step"] == "reject" {
			return nil, errHandshakeInvalid
		}
		remoteID, localID := stringField(field(value["peer"]), "id"), stringField(field(field(local)["peer"]), "id")
		if remoteID == localID || parent != "" && remoteID != parent {
			return nil, errHandshakeInvalid
		}
		if token != "" && value["auth"] != token {
			_ = send(writer, object("profile", protocol, "kind", "handshake", "step", "reject", "error", wireError("AUTH_REJECTED", "authentication rejected", "rpc.transport.process")))
			return nil, errHandshakeInvalid
		}
		if value["step"] == "pending" {
			if remoteHello == nil || !runtimeSchemaEqual(field(remoteHello)["peer"], value["peer"]) {
				return nil, errHandshakeInvalid
			}
			continue
		}
		if value["step"] == "hello" {
			if localID < remoteID {
				remoteHello = remote
				continue
			}
			if !supportsVersion(value) {
				return nil, errHandshakeIncompatible
			}
			if len(entries(value["requiredExtensions"])) > 0 {
				return nil, errHandshakeIncompatible
			}
			accept := acceptance(local)
			if err := send(writer, accept); err != nil {
				return nil, err
			}
			remoteHello, selected = remote, accept
			continue
		}
		if selected != nil {
			for _, key := range []string{"major", "minor", "codec", "extensions"} {
				if !runtimeSchemaEqual(value[key], field(selected)[key]) {
					return nil, errHandshakeInvalid
				}
			}
			if !runtimeSchemaEqual(field(remoteHello)["peer"], value["peer"]) || !runtimeSchemaEqual(field(remoteHello)["directory"], value["directory"]) {
				return nil, errHandshakeInvalid
			}
			return remoteHello, nil
		}
		if localID > remoteID || integerField(value, "major") != 2 || integerField(value, "minor") != 0 || value["codec"] != "json" || len(entries(value["extensions"])) > 0 {
			return nil, errHandshakeInvalid
		}
		if remoteHello != nil && (!runtimeSchemaEqual(field(remoteHello)["peer"], value["peer"]) || !runtimeSchemaEqual(field(remoteHello)["directory"], value["directory"])) {
			return nil, errHandshakeInvalid
		}
		confirmation := acceptance(local)
		if err := send(writer, confirmation); err != nil {
			return nil, err
		}
		return remote, nil
	}
}

// initiator proves canonical directory-bound echo without old batch or reserved describe traffic.
func initiator(reader io.Reader, writer io.Writer) error {
	identity := localIdentity()
	local := localOffer(identity, false)
	remote, err := handshake(reader, writer, local, "", "")
	if err != nil {
		return err
	}
	peer := field(field(remote)["directory"])["self"]
	task := object("mode", "request", "callerId", field(identity)["instanceId"], "callerGeneration", field(identity)["generation"], "targetGeneration", field(peer)["generation"], "method", "echo")
	payload := object("probe", "go")
	request := object("profile", protocol, "kind", "call", "id", "go-echo-1", "route", route("go-peer", stringField(field(peer), "instanceId"), nil), "task", task, "options", object(), "payload", payload)
	if err = send(writer, request); err != nil {
		return err
	}
	reply, err := receive(reader, false)
	if err != nil || !validFrame(reply) || field(reply)["kind"] != "result" || field(reply)["id"] != "go-echo-1" || !runtimeSchemaEqual(field(reply)["task"], task) || !runtimeSchemaEqual(field(reply)["result"], payload) {
		return errProtocol
	}
	fmt.Fprintln(os.Stderr, "RESULT ok")
	return nil
}

// responder shares the same actual provider/session owner as the business CLI.
func responder(reader io.Reader, writer io.Writer) error {
	return serveBusiness(reader, writer, localIdentity(), "", "", false)
}

// serveUnix retains the existing single socket acquisition and exact native cleanup owner.
func serveUnix(path, role string) error {
	if role == "initiator" {
		connection, err := net.Dial("unix", path)
		if err != nil {
			return err
		}
		defer connection.Close()
		fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
		return initiator(connection, connection)
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(path)
	fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
	connection, err := listener.Accept()
	if err != nil {
		return err
	}
	defer connection.Close()
	return responder(connection, connection)
}

// main keeps the existing CLI/transport owner while removing semantic-v1/JSON-RPC/remote-Host selectors.
func main() {
	business := flag.Bool("business", false, "serve published providers")
	jsonrpc := flag.Bool("jsonrpc", false, "historical pure JSON baseline label only")
	bareJSON := flag.Bool("bare-jsonrpc", false, "parse and write JSON only; no RPC profile")
	descendant := flag.Bool("descendant", false, "own child until EOF")
	bootstrap := flag.String("bootstrap", "none", "native launch bootstrap")
	authFD := flag.Int("auth-fd", -1, "inherited auth descriptor")
	nonIdempotent := flag.Bool("non-idempotent-request", false, "declare business request non-idempotent")
	role := flag.String("role", "responder", "responder or initiator")
	stdio := flag.Bool("stdio", false, "framed stdin/stdout")
	listenUnix := flag.String("listen-unix", "", "listen on Unix socket")
	connectUnix := flag.String("connect-unix", "", "connect Unix socket")
	selftest := flag.Bool("selftest", false, "run existing vector owner")
	vectors := flag.String("vectors", "", "schema/vectors path")
	flag.Parse()
	if *jsonrpc != *bareJSON || *bareJSON && (!*business || !*stdio) {
		fmt.Fprintln(os.Stderr, "ERROR retired semantic profile")
		os.Exit(2)
	}
	businessRequestIdempotent = !*nonIdempotent
	if *selftest {
		os.Exit(runSelftest(*vectors))
	}
	if *role != "responder" && *role != "initiator" || *listenUnix != "" && *connectUnix != "" || *stdio && (*listenUnix != "" || *connectUnix != "") {
		fmt.Fprintln(os.Stderr, "ERROR invalid transport selection")
		os.Exit(2)
	}
	var err error
	if *business {
		err = runBusiness(*stdio, *listenUnix, *bootstrap, *authFD, *descendant, *bareJSON)
	} else if *listenUnix != "" {
		err = serveUnix(*listenUnix, *role)
	} else if *connectUnix != "" {
		err = serveUnix(*connectUnix, "initiator")
	} else {
		fmt.Fprintf(os.Stderr, "READY pid=%d\n", os.Getpid())
		if *role == "initiator" {
			err = initiator(os.Stdin, os.Stdout)
		} else {
			err = responder(os.Stdin, os.Stdout)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "PEER_FAIL SESSION_ERROR")
		os.Exit(1)
	}
}
