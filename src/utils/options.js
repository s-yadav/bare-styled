import pm from 'picomatch'

function getOption({ opts }, name, defaultValue = true) {
  return opts[name] === undefined || opts[name] === null ? defaultValue : opts[name]
}

// Options the decoupled transform actually reads. (The old compile-time options
// — minify, transpileTemplateLiterals, compileStatic, cssProp, ssr, fileName,
// pure — were removed with the machinery that used them.)
export const useDisplayName = state => getOption(state, 'displayName')

export const useTopLevelImportPathMatchers = state =>
  getOption(state, 'topLevelImportPaths', []).map(pattern => pm(pattern))

export const useMeaninglessFileNames = state =>
  getOption(state, 'meaninglessFileNames', ['index'])

export const useNamespace = state => {
  const namespace = getOption(state, 'namespace', '')
  return namespace ? `${namespace}__` : ''
}

export const useRuntimeImportPath = state =>
  getOption(state, 'runtimeImportPath', 'just-styled/runtime')
