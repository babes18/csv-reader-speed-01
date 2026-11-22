// Fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01-run-20261121).
//
// Returns exactly csv-reader 1.0.0's answer for every input: {columns, rows, errors}.
// The text is read once, left to right. Semantics replicated exactly:
//  - a U+FEFF at the very start is dropped;
//  - a record ends at LF or CRLF; a line with no characters is no record;
//  - outside quotes a CR not followed by LF is dropped (stray_cr);
//  - a field opening with a quote runs to the next non-doubled quote, "" inside is one
//    quote, each CRLF or lone CR inside is read as LF; what follows the closing quote
//    up to the next comma or line break is appended as it stands (quote_junk); a quote
//    that never closes is a literal and the text after it is read again as unquoted
//    (unterminated_quote); a quote inside an unquoted field is literal;
//  - fields stay strings, never trimmed or converted;
//  - columns is the first record when header is true, else null; rows are padded with ""
//    (short_row) or cut (long_row) to the first record's width;
//  - each error is {code, line, row}, line the 1-based line its record starts on, row its
//    record's index in rows (null for the header), in the order met.
//
// Speed: lines with no quote and no stray CR are split in bulk (slice + split); the
// rest are read field by field, scanned by two sticky regexes (one exec per field
// segment instead of three indexOf calls). Dependency-free ES module. Pure: nothing
// kept from one call to the next.

/** Unquoted field content: every character up to the next comma, LF or CR. */
const RE_UNQ = /[^,\n\r]*/y;
/** Quoted field clean segment: every character up to the next quote, LF or CR. */
const RE_QUO = /[^"\n\r]*/y;
/** A quote or a CR anywhere ahead: one scan for the fast-path line check. */
const RE_CHK = /["\r]/g;

/** Field end: 0 comma, 1 line break, 2 end of text. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read (helpers below close over these).
  let recordLine = 1;
  let recordRow = null;
  // How the field just read ended.
  let fe = 0;

  // Reads an unquoted field starting at pos, starting from `init` (a string, or null
  // for an empty field). Returns the field and sets fe. A CR not followed by LF is
  // dropped and records stray_cr; anything else is kept as it stands.
  function readUnquoted(init) {
    let value = init;
    for (;;) {
      RE_UNQ.lastIndex = pos;
      const seg = RE_UNQ.exec(text)[0];
      pos = RE_UNQ.lastIndex;
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fe = 0;
        return value === null ? seg : value + seg;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fe = 1;
        return value === null ? seg : value + seg;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fe = 1;
          return value === null ? seg : value + seg;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value = value === null ? seg : value + seg;
        pos += 1;
        continue;
      }
      fe = 2;
      return value === null ? seg : value + seg;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field and sets fe.
  // On a quote that never closes, records unterminated_quote and re-reads from after
  // the opening quote as an unquoted field whose first character is the quote itself.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = null;
    pos += 1;
    let closed = false;
    for (;;) {
      RE_QUO.lastIndex = pos;
      const seg = RE_QUO.exec(text)[0];
      pos = RE_QUO.lastIndex;
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          value = value === null ? seg + '"' : value + seg + '"';
          pos += 2;
          continue;
        }
        value = value === null ? seg : value + seg;
        pos += 1;
        closed = true;
        break;
      }
      if (c === 10) {
        value = value === null ? seg + '\n' : value + seg + '\n';
        line += 1;
        pos += 1;
        continue;
      }
      if (c === 13) {
        value = value === null ? seg + '\n' : value + seg + '\n';
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        continue;
      }
      value = value === null ? seg : value + seg;
      break;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    if (pos >= n) {
      fe = 2;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fe = 0;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fe = 1;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fe = 1;
      return value;
    }
    const qlen = value.length;
    const out = readUnquoted(value);
    if (out.length > qlen) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return out;
  }

  // Finishes a record: drops a line that held only stray CRs, takes the header, or
  // pads/cuts the row to the first record's width.
  function finishRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the rest of this line holds no quote and no stray CR, so the whole
    // line is one record of unquoted fields. A CR is allowed only as the CRLF that
    // ends the line (a trailing lone CR at the end of the text is not one). One regex
    // scan finds the nearest quote or CR; a match at or past the line end, or the
    // CRLF's own CR, leaves the line clean.
    const lf = text.indexOf('\n', pos);
    const end = lf === -1 ? n : lf;
    RE_CHK.lastIndex = pos;
    const chk = RE_CHK.exec(text);
    const clean =
      chk === null ||
      chk.index >= end ||
      (chk.index === end - 1 && lf !== -1 && chk[0] === '\r');
    if (clean) {
      const fieldEnd = chk !== null && chk.index === end - 1 && chk[0] === '\r' ? end - 1 : end;
      const fields = text.slice(pos, fieldEnd).split(',');
      pos = lf === -1 ? n : lf + 1;
      if (lf !== -1) line += 1;
      finishRecord(fields, false);
      continue;
    }

    // Careful path: a quote or a stray CR is in this record, so read it field by field.
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(null));
    } while (fe === 0);
    finishRecord(fields, quoted);
  }

  return { columns: header ? columns ?? [] : null, rows, errors };
}
