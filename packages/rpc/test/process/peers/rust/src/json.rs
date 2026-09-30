//! Small bounded JSON codec for the standalone standard-library peer.
use std::fmt::Write as _;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Self::Object(fields) => fields
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            _ => None,
        }
    }
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Self::Number(value) => value.parse().ok(),
            _ => None,
        }
    }
    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Self::Array(value) => Some(value),
            _ => None,
        }
    }
    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }
    pub fn text(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }
    fn write(&self, out: &mut String) {
        match self {
            Self::Null => out.push_str("null"),
            Self::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Self::Number(value) => out.push_str(value),
            Self::String(value) => {
                out.push('"');
                for ch in value.chars() {
                    match ch {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        '\n' => out.push_str("\\n"),
                        '\r' => out.push_str("\\r"),
                        '\t' => out.push_str("\\t"),
                        '\u{8}' => out.push_str("\\b"),
                        '\u{c}' => out.push_str("\\f"),
                        ch if ch <= '\u{1f}' => {
                            let _ = write!(out, "\\u{:04x}", ch as u32);
                        }
                        ch => out.push(ch),
                    }
                }
                out.push('"');
            }
            Self::Array(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Self::Object(fields) => {
                out.push('{');
                for (index, (key, value)) in fields.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    Self::String(key.clone()).write(out);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

pub fn parse(input: &[u8]) -> Result<Value, String> {
    parse_impl(input, false)
}

/// Vector documents may contain an intentionally invalid lone surrogate case.
pub fn parse_vector(input: &[u8]) -> Result<Value, String> {
    parse_impl(input, true)
}

fn parse_impl(input: &[u8], allow_lone_surrogate: bool) -> Result<Value, String> {
    let mut parser = Parser {
        bytes: input,
        offset: 0,
        allow_lone_surrogate,
    };
    let value = parser
        .value(0)
        .map_err(|reason| format!("{reason} at offset {}", parser.offset))?;
    parser.space();
    if parser.offset != input.len() {
        return Err(format!("trailing JSON bytes at offset {}", parser.offset));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    offset: usize,
    allow_lone_surrogate: bool,
}
impl Parser<'_> {
    fn space(&mut self) {
        while self.offset < self.bytes.len()
            && matches!(self.bytes[self.offset], b' ' | b'\n' | b'\r' | b'\t')
        {
            self.offset += 1;
        }
    }
    fn byte(&mut self, byte: u8) -> Result<(), &'static str> {
        if self.bytes.get(self.offset) == Some(&byte) {
            self.offset += 1;
            Ok(())
        } else {
            Err("invalid JSON syntax")
        }
    }
    fn value(&mut self, depth: usize) -> Result<Value, &'static str> {
        if depth > 128 {
            return Err("JSON depth exceeded");
        }
        self.space();
        match self.bytes.get(self.offset).copied() {
            Some(b'n') => {
                self.literal(b"null")?;
                Ok(Value::Null)
            }
            Some(b't') => {
                self.literal(b"true")?;
                Ok(Value::Bool(true))
            }
            Some(b'f') => {
                self.literal(b"false")?;
                Ok(Value::Bool(false))
            }
            Some(b'"') => Ok(Value::String(self.string()?)),
            Some(b'[') => self.array(depth),
            Some(b'{') => self.object(depth),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err("invalid JSON value"),
        }
    }
    fn literal(&mut self, bytes: &[u8]) -> Result<(), &'static str> {
        if self.bytes.get(self.offset..self.offset + bytes.len()) != Some(bytes) {
            return Err("invalid JSON literal");
        }
        self.offset += bytes.len();
        Ok(())
    }
    fn string(&mut self) -> Result<String, &'static str> {
        self.byte(b'"')?;
        let mut out = String::new();
        let mut start = self.offset;
        while let Some(&byte) = self.bytes.get(self.offset) {
            if byte == b'"' || byte == b'\\' || byte < 0x20 {
                out.push_str(
                    std::str::from_utf8(&self.bytes[start..self.offset])
                        .map_err(|_| "invalid UTF-8")?,
                );
                if byte == b'"' {
                    self.offset += 1;
                    return Ok(out);
                }
                if byte < 0x20 {
                    return Err("control character in JSON string");
                }
                self.offset += 1;
                let escape = *self
                    .bytes
                    .get(self.offset)
                    .ok_or("unterminated JSON escape")?;
                self.offset += 1;
                match escape {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{8}'),
                    b'f' => out.push('\u{c}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => {
                        let first = self.hex4()?;
                        let code = if (0xd800..=0xdbff).contains(&first) {
                            if self.bytes.get(self.offset..self.offset + 2) == Some(b"\\u") {
                                self.byte(b'\\')?;
                                self.byte(b'u')?;
                                let second = self.hex4()?;
                                if !(0xdc00..=0xdfff).contains(&second) {
                                    return Err("invalid surrogate pair");
                                }
                                0x10000 + ((first as u32 - 0xd800) << 10) + (second as u32 - 0xdc00)
                            } else if self.allow_lone_surrogate {
                                0xfffd
                            } else {
                                return Err("lone surrogate");
                            }
                        } else if (0xdc00..=0xdfff).contains(&first) {
                            if self.allow_lone_surrogate {
                                0xfffd
                            } else {
                                return Err("lone surrogate");
                            }
                        } else {
                            first as u32
                        };
                        out.push(char::from_u32(code).ok_or("invalid Unicode scalar")?);
                    }
                    _ => return Err("invalid JSON escape"),
                }
                start = self.offset;
            } else {
                self.offset += 1;
            }
        }
        Err("unterminated JSON string")
    }
    fn hex4(&mut self) -> Result<u16, &'static str> {
        let mut value = 0u16;
        for _ in 0..4 {
            let byte = *self.bytes.get(self.offset).ok_or("short Unicode escape")?;
            self.offset += 1;
            value = (value << 4)
                | (byte as char)
                    .to_digit(16)
                    .ok_or("invalid Unicode escape")? as u16;
        }
        Ok(value)
    }
    fn number(&mut self) -> Result<Value, &'static str> {
        let start = self.offset;
        if self.bytes.get(self.offset) == Some(&b'-') {
            self.offset += 1;
        }
        match self.bytes.get(self.offset) {
            Some(b'0') => self.offset += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.bytes.get(self.offset), Some(b'0'..=b'9')) {
                    self.offset += 1;
                }
            }
            _ => return Err("invalid JSON number"),
        }
        if self.bytes.get(self.offset) == Some(&b'.') {
            self.offset += 1;
            let begin = self.offset;
            while matches!(self.bytes.get(self.offset), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
            if begin == self.offset {
                return Err("invalid JSON fraction");
            }
        }
        if matches!(self.bytes.get(self.offset), Some(b'e' | b'E')) {
            self.offset += 1;
            if matches!(self.bytes.get(self.offset), Some(b'+' | b'-')) {
                self.offset += 1;
            }
            let begin = self.offset;
            while matches!(self.bytes.get(self.offset), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
            if begin == self.offset {
                return Err("invalid JSON exponent");
            }
        }
        Ok(Value::Number(
            std::str::from_utf8(&self.bytes[start..self.offset])
                .map_err(|_| "invalid number bytes")?
                .to_owned(),
        ))
    }
    fn array(&mut self, depth: usize) -> Result<Value, &'static str> {
        self.byte(b'[')?;
        self.space();
        let mut values = Vec::new();
        if self.bytes.get(self.offset) == Some(&b']') {
            self.offset += 1;
            return Ok(Value::Array(values));
        }
        loop {
            values.push(self.value(depth + 1)?);
            self.space();
            if self.bytes.get(self.offset) == Some(&b']') {
                self.offset += 1;
                return Ok(Value::Array(values));
            }
            self.byte(b',')?;
        }
    }
    fn object(&mut self, depth: usize) -> Result<Value, &'static str> {
        self.byte(b'{')?;
        self.space();
        let mut values = Vec::new();
        if self.bytes.get(self.offset) == Some(&b'}') {
            self.offset += 1;
            return Ok(Value::Object(values));
        }
        loop {
            self.space();
            let key = self.string()?;
            if values
                .iter()
                .any(|(name, _): &(String, Value)| name == &key)
            {
                return Err("duplicate JSON field");
            }
            self.space();
            self.byte(b':')?;
            values.push((key, self.value(depth + 1)?));
            self.space();
            if self.bytes.get(self.offset) == Some(&b'}') {
                self.offset += 1;
                return Ok(Value::Object(values));
            }
            self.byte(b',')?;
        }
    }
}

pub fn object(fields: &[(&str, Value)]) -> Value {
    Value::Object(
        fields
            .iter()
            .map(|(name, value)| ((*name).to_owned(), value.clone()))
            .collect(),
    )
}
pub fn string(value: &str) -> Value {
    Value::String(value.to_owned())
}
pub fn number(value: u64) -> Value {
    Value::Number(value.to_string())
}
