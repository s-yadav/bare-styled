// CSS value-position scanner, shared by both transform engines so their
// classification can never drift.
//
// An interpolation is in VALUE position when it sits inside a declaration's
// value — after a `:` and before the declaration terminates (`;`, `}`, or a
// `{` that reveals the `:` belonged to a pseudo-selector). Only value-position
// interpolations can become skeleton placeholders: a placeholder there can't
// change the compiled structure, so the whole rule can be stylis-compiled at
// build time and finished with a string substitution at render.
//
// The scanner is a tiny state machine fed the template's static text chunks in
// order; between chunks the engine asks `inValue()` to classify the
// interpolation that sits there. Quoted strings ('/") with escapes, block
// comments (/* */) and stylis line comments (//) are skipped so their contents
// can't confuse the `:;{}` tracking (e.g. `content: "a:b{"`).
export function createScanner() {
  let inValue = false
  let quote = 0 // charCode of open quote, 0 outside strings
  let comment = 0 // 0 none, 1 block, 2 line

  return {
    feed(text) {
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (comment === 1) {
          if (c === 42 /* * */ && text.charCodeAt(i + 1) === 47 /* / */) {
            comment = 0
            i++
          }
          continue
        }
        if (comment === 2) {
          if (c === 10 /* \n */) comment = 0
          continue
        }
        if (quote) {
          if (c === 92 /* \\ */) i++
          else if (c === quote) quote = 0
          continue
        }
        if (c === 34 /* " */ || c === 39 /* ' */) quote = c
        else if (c === 47 /* / */) {
          const n = text.charCodeAt(i + 1)
          if (n === 42) {
            comment = 1
            i++
          } else if (n === 47) {
            comment = 2
            i++
          }
        } else if (c === 58 /* : */) inValue = true
        else if (c === 59 /* ; */ || c === 125 /* } */) inValue = false
        else if (c === 123 /* { */) inValue = false // the `:` was a pseudo-selector
      }
    },
    // Classification for an interpolation at the current point. Inside a
    // string or comment is never a substitutable value slot.
    inValue() {
      return inValue && quote === 0 && comment === 0
    },
    // After the engine decides an interpolation could NOT be a value slot
    // (block/selector position), its runtime content is unknown — reset so
    // subsequent text is classified from a clean state.
    resetAfterBlockInterp() {
      inValue = false
    },
  }
}
