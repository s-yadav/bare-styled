// Side-effect entry point (`bare-styled/runtime/patch`). The babel plugin
// injects an import of this module into every file where it emits a
// descriptor, so the patch is installed before any descriptor renders.
'use strict'

require('./patch-impl').installCreateElementPatch()
