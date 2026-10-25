package main

import (
	"strconv"
	"unicode/utf8"
)

// validUnicodeEscapes scans JSON string tokens so Go's replacement of lone surrogates cannot hide them.
func validUnicodeEscapes(payload []byte) bool {
	inString := false
	pendingHigh := false
	for index := 0; index < len(payload); index++ {
		current := payload[index]
		if current == '"' {
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
