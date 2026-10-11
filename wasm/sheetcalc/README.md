# sheetcalc — formulas for Docs sheets

`public/sheetcalc.wasm` is **GridCraft's spreadsheet engine** compiled to WebAssembly:
its formula parser, 501 worksheet functions, Excel number formats and
dependency-driven recalculation (dynamic arrays, spills, cycle detection).

- Engine: [storytold/gridcraft](https://github.com/storytold/gridcraft), pinned to the
  commit in `Cargo.toml`. Copyright (c) 2026 ArtCraft Team and the GridCraft
  contributors, used under the MIT License (`LICENSE-GRIDCRAFT`; the project is
  MIT OR Apache-2.0). The ArtCraft/GridCraft names and logos are their trademarks
  and are not used here.
- This crate is only the bridge (`src/lib.rs`): one JSON-in/JSON-out call over a
  raw C ABI, no wasm-bindgen, no imports. `lib/sheets/calc.ts` is the browser side.

## Rebuild

Needs Rust with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`). Nobody needs Rust to build the app:
the compiled file is committed, and CI and the host only serve it.

```bash
npm run build:sheetcalc
```

That runs the bridge's tests natively, builds the WebAssembly, copies it to
`public/sheetcalc.wasm` and records its size and SHA-256 in
`lib/sheets/sheetcalc-meta.json` (the browser uses the hash to bust its cache).
To take a newer GridCraft, change `rev` in `Cargo.toml` (all six lines), run
`cargo update`, rebuild, and open a sheet with formulas before shipping.
