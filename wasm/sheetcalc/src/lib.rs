//! The bridge between RunButter's Docs sheets and GridCraft's spreadsheet engine.
//!
//! One call, JSON in and JSON out, no state between calls: the sheet is a few
//! hundred cells at most, so rebuilding the workbook and recalculating
//! everything costs well under a millisecond, and a stateless engine cannot
//! drift from the markdown table that is the real document.
//!
//!   in:  {"cells": [["Item","Qty","=B2*2"], …], "now": 46302.5}
//!   out: {"cells": [[["Item","s",null], ["3","n",3], ["6","n",6]], …]}
//!
//! Each output cell is `[display text, kind, number]` where kind is
//! `s` text · `n` number · `b` boolean · `e` error · `` empty, and the number is
//! there for numeric cells so a chart or a sum can use the value rather than
//! re-parse the display text. A formula that cannot be parsed comes back as
//! `["#ERROR!", "e", null, "<why>"]`.
//!
//! The raw C ABI (no wasm-bindgen) keeps the browser side to a dozen lines and
//! the build to `cargo build`; the only `unsafe` is handing bytes across it.

use gridcraft_calc::Calc;
use gridcraft_core::{CellRef, Value};
use gridcraft_model::{Cell, Formula, NumFmt, Workbook};
use gridcraft_numfmt::{format_value, NumberFormat};
use serde_json::{json, Value as Json};

/// A Docs sheet is a document, not a database: past this it is the wrong tool.
const MAX_CELLS: usize = 20_000;

/// What typing `input` into a cell produces — a constant (with the number format
/// Excel would pick: "50%" stays a percentage, "$3" currency, "2026-03-04" a
/// date) or a formula. Mirrors GridCraft's own `input_to_cell`, which is
/// crate-private to its engine.
fn input_to_cell(input: &str, wb: &mut Workbook) -> Result<Option<Cell>, String> {
    if input.trim().is_empty() {
        return Ok(None);
    }
    let is_formula = input.starts_with('=') && input.len() > 1;
    if is_formula {
        let mut text = input[1..].to_string();
        // Excel closes missing parentheses for you.
        let mut parsed = gridcraft_formula::parse(&text);
        for _ in 0..8 {
            if parsed.is_ok() {
                break;
            }
            text.push(')');
            parsed = gridcraft_formula::parse(&text);
        }
        let expr = parsed.map_err(|e| format!("{e}"))?;
        let expr = wb.name_call_case(expr);
        let mut cell = Cell::formula(Formula::from_expr(expr));
        let f = text.to_ascii_uppercase();
        let auto = if f.starts_with("TODAY(") || f.starts_with("DATE(") || f.starts_with("EDATE(") || f.starts_with("EOMONTH(") || f.starts_with("WORKDAY(") {
            Some("d mmm yyyy")
        } else if f.starts_with("NOW(") {
            Some("d mmm yyyy h:mm")
        } else {
            None
        };
        if let Some(code) = auto {
            cell.style = wb.styles.derive(cell.style, |s| s.num_fmt = NumFmt::new(code));
        }
        return Ok(Some(cell));
    }
    let parsed = gridcraft_core::parse::parse_input(input, wb.date_system);
    let mut cell = Cell::value(parsed.value);
    if let Some(code) = parsed.format {
        // Dates read the way the rest of RunButter writes them ("30 Sep 2026"),
        // not m/d/yyyy, which half the world reads as a different day.
        let code = if code.contains('y') && code.contains('d') && !code.contains(':') { "d mmm yyyy" } else { code };
        cell.style = wb.styles.derive(cell.style, |s| s.num_fmt = NumFmt::new(code));
    }
    Ok(Some(cell))
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Empty => "",
        Value::Number(_) => "n",
        Value::Text(_) => "s",
        Value::Bool(_) => "b",
        Value::Error(_) => "e",
        Value::Array(a) => a.data.first().map(kind).unwrap_or(""),
    }
}

fn number(v: &Value) -> Json {
    match v {
        Value::Number(n) if n.is_finite() => json!(n),
        Value::Array(a) => a.data.first().map(number).unwrap_or(Json::Null),
        _ => Json::Null,
    }
}

/// The whole computation, testable without the FFI.
pub fn compute(input: &str) -> String {
    let req: Json = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => return json!({ "error": format!("bad input: {e}") }).to_string(),
    };
    let rows: Vec<Vec<String>> = req["cells"]
        .as_array()
        .map(|rs| {
            rs.iter()
                .map(|r| r.as_array().map(|cs| cs.iter().map(|c| c.as_str().unwrap_or("").to_string()).collect()).unwrap_or_default())
                .collect()
        })
        .unwrap_or_default();
    let total: usize = rows.iter().map(Vec::len).sum();
    if total > MAX_CELLS {
        return json!({ "error": format!("too many cells ({total}); a sheet holds up to {MAX_CELLS}") }).to_string();
    }

    let mut wb = Workbook::new();
    let mut parse_errors: Vec<(usize, usize, String)> = Vec::new();
    let mut cells: Vec<(CellRef, Cell)> = Vec::new();
    for (r, row) in rows.iter().enumerate() {
        for (c, text) in row.iter().enumerate() {
            match input_to_cell(text, &mut wb) {
                Ok(Some(cell)) => cells.push((CellRef::new(r as u32, c as u32), cell)),
                Ok(None) => {}
                Err(why) => parse_errors.push((r, c, why)),
            }
        }
    }
    if let Some(sheet) = wb.sheet_mut(0) {
        for (at, cell) in cells {
            sheet.set_cell(at, cell);
        }
    }

    let mut calc = Calc::new();
    // The browser's local "now", so TODAY() is today where the reader is.
    // GridCraft's own web build has no clock and falls back to a fixed date.
    calc.fixed_now = req["now"].as_f64();
    calc.recalc_all(&mut wb);

    let Some(sheet) = wb.sheet(0) else { return json!({ "error": "no sheet" }).to_string() };
    let derived = carried_formats(&wb, sheet);
    let out: Vec<Json> = rows
        .iter()
        .enumerate()
        .map(|(r, row)| {
            let width = row.len();
            Json::Array(
                (0..width)
                    .map(|c| {
                        if let Some((_, _, why)) = parse_errors.iter().find(|(pr, pc, _)| *pr == r && *pc == c) {
                            return json!(["#ERROR!", "e", null, why]);
                        }
                        let at = CellRef::new(r as u32, c as u32);
                        let v = sheet.value(at);
                        let code = derived
                            .get(&(r as u32, c as u32))
                            .cloned()
                            .unwrap_or_else(|| wb.styles.get(sheet.style_id(at)).num_fmt.as_str().to_string());
                        let shown = format_value(&v, &NumberFormat::parse(&code), wb.date_system).text;
                        json!([shown, kind(&v), number(&v)])
                    })
                    .collect(),
            )
        })
        .collect();
    json!({ "cells": out }).to_string()
}

/// An amount format: currency, thousands separators, fixed decimals. Not a
/// percentage, a date or a time — those describe their own cell, not a result.
fn is_amount_format(code: &str) -> bool {
    if code == "General" || code.contains('%') || code == "@" {
        return false;
    }
    // Ignore [$PLN], [Red] and "quoted text" when looking for date letters.
    let mut plain = String::new();
    let (mut in_br, mut in_q) = (false, false);
    for ch in code.chars() {
        match ch {
            '[' if !in_q => in_br = true,
            ']' if !in_q => in_br = false,
            '"' => in_q = !in_q,
            _ if !in_br && !in_q => plain.push(ch),
            _ => {}
        }
    }
    let p = plain.to_ascii_lowercase();
    (p.contains('#') || p.contains('0')) && !p.chars().any(|c| matches!(c, 'd' | 'm' | 'y' | 'h' | 's' | 'e'))
}

/// Excel carries an amount format into a formula over amounts:
/// `=B2*C2` with C2 = "$1,250.00" shows "$3,750.00", not "3750", and a sum of
/// "8,500"s shows "50,900". A formula left in General takes the format of the
/// first amount it refers to, and formulas over those formulas follow, a few
/// passes deep. Percentages and dates do not travel — "23% × amount" is an
/// amount, and "date + 30" is GridCraft's own business (it formats DATE()).
fn carried_formats(wb: &Workbook, sheet: &gridcraft_model::Sheet) -> std::collections::HashMap<(u32, u32), String> {
    use std::collections::HashMap;
    let refs = regex::Regex::new(r"\$?([A-Za-z]{1,3})\$?([0-9]{1,6})").expect("static pattern");
    let formulas: Vec<(CellRef, String)> = sheet
        .cells
        .iter()
        .filter_map(|(at, cell)| cell.formula.as_ref().map(|f| (at, f.text.to_string())))
        .filter(|(at, _)| wb.styles.get(sheet.style_id(*at)).num_fmt.as_str() == "General" && matches!(sheet.value(*at), Value::Number(_)))
        .collect();
    let mut derived: HashMap<(u32, u32), String> = HashMap::new();
    for _ in 0..6 {
        let mut changed = false;
        for (at, text) in &formulas {
            if derived.contains_key(&(at.row, at.col)) {
                continue;
            }
            for m in refs.captures_iter(text) {
                // "LOG10(" is a function, not column LOG row 10; "AB12" inside "XAB12" is not a reference.
                let whole = m.get(0).expect("match 0");
                if text[whole.end()..].starts_with('(') || text[..whole.start()].chars().last().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_') {
                    continue;
                }
                let col = gridcraft_core::letters_to_col(&m[1].to_ascii_uppercase());
                let Ok(row) = m[2].parse::<u32>() else { continue };
                let (Some(col), true) = (col, row >= 1) else { continue };
                let key = (row - 1, col);
                let code = derived.get(&key).cloned().unwrap_or_else(|| {
                    wb.styles.get(sheet.style_id(CellRef::new(key.0, key.1))).num_fmt.as_str().to_string()
                });
                if is_amount_format(&code) {
                    derived.insert((at.row, at.col), code);
                    changed = true;
                    break;
                }
            }
        }
        if !changed {
            break;
        }
    }
    derived
}

/// Every function name the engine knows, for autocomplete.
pub fn functions() -> String {
    let mut names: Vec<&str> = gridcraft_functions::all().iter().map(|f| f.name).collect();
    names.extend(gridcraft_calc::SPECIAL_FUNCTIONS.iter().copied());
    names.sort_unstable();
    names.dedup();
    json!(names).to_string()
}

// ---------------------------------------------------------------- C ABI

/// Hands a string to JS: pointer in the high 32 bits, length in the low.
fn leak(s: String) -> u64 {
    let bytes = s.into_bytes().into_boxed_slice();
    let len = bytes.len() as u64;
    let ptr = Box::into_raw(bytes) as *mut u8 as usize as u64;
    (ptr << 32) | len
}

#[no_mangle]
pub extern "C" fn rb_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must come from `rb_alloc` (input) or a returned string (output).
#[no_mangle]
pub unsafe extern "C" fn rb_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// # Safety
/// `ptr` must point to `len` bytes of UTF-8 written into memory from `rb_alloc`.
#[no_mangle]
pub unsafe extern "C" fn rb_compute(ptr: *const u8, len: usize) -> u64 {
    let input = std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).unwrap_or("");
    leak(compute(input))
}

#[no_mangle]
pub extern "C" fn rb_functions() -> u64 {
    leak(functions())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(out: &str, r: usize, c: usize) -> Json {
        let v: Json = serde_json::from_str(out).unwrap();
        v["cells"][r][c].clone()
    }

    #[test]
    fn sums_and_formats() {
        let out = compute(r#"{"cells":[["Item","Qty","Price","Total"],["Pens","3","$2.50","=B2*C2"],["Pads","2","$4","=B3*C3"],["","","Sum","=SUM(D2:D3)"]],"now":46302.5}"#);
        assert_eq!(cell(&out, 1, 3)[2], json!(7.5));
        assert_eq!(cell(&out, 1, 3)[0], json!("$7.50")); // currency carried into the formula
        assert_eq!(cell(&out, 3, 3)[0], json!("$15.50")); // and into a formula over formulas
        assert_eq!(cell(&out, 3, 3)[2], json!(15.5));
        assert_eq!(cell(&out, 1, 2)[0], json!("$2.50"));
        assert_eq!(cell(&out, 0, 0), json!(["Item", "s", null]));
    }

    #[test]
    fn errors_and_dates() {
        let out = compute(r#"{"cells":[["=1/0","=SUM(1,2","=NOPE(1)","2026-03-04","=TODAY()"]],"now":46302.5}"#);
        assert_eq!(cell(&out, 0, 0)[0], json!("#DIV/0!"));
        assert_eq!(cell(&out, 0, 1)[2], json!(3.0)); // the missing ) is closed for you
        assert_eq!(cell(&out, 0, 2)[0], json!("#NAME?"));
        assert_eq!(cell(&out, 0, 3)[0], json!("4 Mar 2026"));
        assert_eq!(cell(&out, 0, 4)[0], json!("7 Oct 2026"));
    }

    #[test]
    fn amounts_travel_percentages_do_not() {
        let out = compute(r#"{"cells":[["8,500","2","=A1*B1","23%","=C1*D1","=SUM(A1:A1)/3"]]}"#);
        assert_eq!(cell(&out, 0, 2)[0], json!("17,000"));
        assert_eq!(cell(&out, 0, 4)[0], json!("3,910")); // the amount's format, not the percentage's
        assert_eq!(cell(&out, 0, 3)[0], json!("23%"));
    }

    #[test]
    fn spills_and_lookups() {
        let out = compute(r#"{"cells":[["a","1"],["b","2"],["c","3"],["=VLOOKUP(\"b\",A1:B3,2,FALSE)","=SEQUENCE(2)"],["",""]]}"#);
        assert_eq!(cell(&out, 3, 0)[2], json!(2.0));
        assert_eq!(cell(&out, 4, 1)[2], json!(2.0));
    }
}
