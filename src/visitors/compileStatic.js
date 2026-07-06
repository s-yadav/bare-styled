import { addNamed, addSideEffect } from '@babel/helper-module-imports'
import annotateAsPure from '@babel/helper-annotate-as-pure'
import { compile, middleware, prefixer, serialize, stringify } from 'stylis'
import { useCompileStatic, useRuntimeImportPath } from '../utils/options'
import { isStyled } from '../utils/detectors'
import { makePlaceholder } from '../css/placeholderUtils'
import hash from '../utils/hash'
import { getFileHash } from './displayNameAndId'

const PROCESSED_TEMPLATES = 'just-styled-compiled-templates'
const CREATE_IMPORT_NAME = 'just-styled-create-styled-element-name'
const PATCH_IMPORT_ADDED = 'just-styled-patch-import-added'
const STATIC_COMPONENT_POSITION = 'just-styled-static-component-position'

// Native element tags are lowercase-first identifiers; this also covers SVG
// camelCase tags (feGaussianBlur) and, in the styled('...') form, custom
// elements with dashes.
const NATIVE_TAG_NAME = /^[a-z][a-zA-Z0-9-]*$/

const readStringProperty = (t, prop) => {
  if (!t.isObjectProperty(prop) || prop.computed) return null
  if (!t.isStringLiteral(prop.value)) return null
  if (t.isIdentifier(prop.key)) return { key: prop.key.name, value: prop.value.value }
  if (t.isStringLiteral(prop.key)) return { key: prop.key.value, value: prop.value.value }
  return null
}

// Accepts styled.tag, styled('tag'), styled(Component) where Component is a
// plain identifier in scope, and any of these wrapped in a single
// .withConfig({...}) whose properties are only the string-literal
// displayName/componentId that displayNameAndId emits. Anything else
// (.attrs chains, styled(obj.Component), styled(call()), spread/computed
// config) is ineligible.
const parseEligibleTag = (t, tag) => {
  let base = tag
  let displayName = null
  let componentId = null

  if (
    t.isCallExpression(tag) &&
    t.isMemberExpression(tag.callee) &&
    !tag.callee.computed &&
    t.isIdentifier(tag.callee.property, { name: 'withConfig' })
  ) {
    if (tag.arguments.length !== 1 || !t.isObjectExpression(tag.arguments[0])) {
      return null
    }
    for (const prop of tag.arguments[0].properties) {
      const entry = readStringProperty(t, prop)
      if (!entry) return null
      if (entry.key === 'displayName') displayName = entry.value
      else if (entry.key === 'componentId') componentId = entry.value
      else return null
    }
    base = tag.callee.object
  }

  let element = null
  let componentRef = null
  if (
    t.isMemberExpression(base) &&
    !base.computed &&
    t.isIdentifier(base.object) &&
    t.isIdentifier(base.property) &&
    NATIVE_TAG_NAME.test(base.property.name)
  ) {
    element = base.property.name
  } else if (
    t.isCallExpression(base) &&
    t.isIdentifier(base.callee) &&
    base.arguments.length === 1
  ) {
    if (
      t.isStringLiteral(base.arguments[0]) &&
      NATIVE_TAG_NAME.test(base.arguments[0].value)
    ) {
      element = base.arguments[0].value
    } else if (t.isIdentifier(base.arguments[0])) {
      componentRef = base.arguments[0]
    }
  }

  return element || componentRef
    ? { element, componentRef, displayName, componentId }
    : null
}

const isThemeKey = (t, key, computed) =>
  (t.isIdentifier(key, { name: 'theme' }) && !computed) ||
  (t.isStringLiteral(key) && key.value === 'theme')

// A function interpolation qualifies for a css variable when it is a plain
// arrow/function expression of at most one param that reads nothing but its
// own bindings (no outer scope, no globals, no `this`) and never touches a
// theme, either via member access or by destructuring a `theme` key.
const isVarCompatibleFunction = (t, exprPath) => {
  const node = exprPath.node
  if (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node)) {
    return false
  }
  if (node.params.length > 1 || node.async || node.generator) return false

  let compatible = true
  exprPath.traverse({
    ThisExpression() {
      compatible = false
    },
    'MemberExpression|OptionalMemberExpression'(memberPath) {
      if (isThemeKey(t, memberPath.node.property, memberPath.node.computed)) {
        compatible = false
      }
    },
    ObjectProperty(propPath) {
      if (
        propPath.parentPath.isObjectPattern() &&
        isThemeKey(t, propPath.node.key, propPath.node.computed)
      ) {
        compatible = false
      }
    },
    ReferencedIdentifier(idPath) {
      // Identifiers inside TypeScript type annotations (the `Props` in
      // `(p: Props) => ...`, `Array<Props>`, `x as Props`, etc.) are visited
      // as referenced identifiers when only the TS *syntax* plugin is active
      // (no TS transform — the normal case in a Vite/oxc build, where oxc
      // strips types later). They carry no value binding, so counting them as
      // references would bail every typed interpolation. Skip any identifier
      // sitting under a TS type node.
      for (let p = idPath.parentPath; p && p !== exprPath; p = p.parentPath) {
        if (t.isTSType(p.node)) return
      }
      const binding = idPath.scope.getBinding(idPath.node.name)
      if (!binding || !exprPath.isAncestor(binding.path)) {
        compatible = false
      }
    },
  })
  return compatible
}

// Declaration-value-position heuristic: walking left from the placeholder,
// the nearest `{`, `}`, or `;` must be followed by a property name and a
// single `:` with nothing suspicious (quotes, at-rules, more colons) between
// the colon and the token. Selector, property, and at-rule prelude positions
// all fail this and force a bail-out.
const VALUE_POSITION = /^\s*(?:--|[a-zA-Z-])[a-zA-Z0-9-]*\s*:[^:;{}@"']*$/

// A `var()` reference must stand alone as a value token. Glued neighbors
// (`${x}px`, `-${x}`) concatenate at runtime in styled-components but are
// invalid CSS around `var()`, so they disqualify the component.
const CHAR_BEFORE_TOKEN = /[\s:(,]/
const CHAR_AFTER_TOKEN = /[\s;}),!]/

const isDeclarationValuePosition = (css, index, length) => {
  let boundary = -1
  for (let i = index - 1; i >= 0; i--) {
    const ch = css[i]
    if (ch === '{' || ch === '}' || ch === ';') {
      boundary = i
      break
    }
  }
  if (!VALUE_POSITION.test(css.slice(boundary + 1, index))) return false
  if (!CHAR_BEFORE_TOKEN.test(css[index - 1])) return false
  const after = css[index + length]
  return after === undefined || CHAR_AFTER_TOKEN.test(after)
}

const getProcessedTemplates = state => {
  let processed = state.file.get(PROCESSED_TEMPLATES)
  if (!processed) {
    processed = new WeakSet()
    state.file.set(PROCESSED_TEMPLATES, processed)
  }
  return processed
}

// componentId for var names when displayNameAndId emitted no withConfig
// (displayName and ssr both off). Own counter so the sc- counter stays
// untouched; same per-file hash, js- prefix.
const getGeneratedComponentId = state => {
  const id = state.file.get(STATIC_COMPONENT_POSITION) || 0
  state.file.set(STATIC_COMPONENT_POSITION, id + 1)
  return `js-${getFileHash(state)}-${id}`
}

export default t => (path, state) => {
  if (!useCompileStatic(state)) return false
  if (!path.node.quasi || !path.node.tag) return false
  if (getProcessedTemplates(state).has(path.node)) return false
  if (!isStyled(t)(path.node.tag, state)) return false

  const tagInfo = parseEligibleTag(t, path.node.tag)
  if (!tagInfo) return false

  const { quasis, expressions } = path.node.quasi
  if (quasis.some(quasi => quasi.value.cooked === undefined)) return false

  let css = ''
  quasis.forEach((quasi, i) => {
    css += quasi.value.cooked
    if (i < expressions.length) css += makePlaceholder(i)
  })

  // Classify each interpolation: confidently-evaluable strings/numbers are
  // inlined, everything else must qualify as a css variable or we bail.
  const expressionPaths = path.get('quasi.expressions')
  const dynamicIndices = []
  for (let i = 0; i < expressions.length; i++) {
    const evaluated = expressionPaths[i].evaluate()
    if (
      evaluated.confident &&
      (typeof evaluated.value === 'string' || typeof evaluated.value === 'number')
    ) {
      css = css.split(makePlaceholder(i)).join(String(evaluated.value))
    } else {
      dynamicIndices.push(i)
    }
  }

  if (dynamicIndices.length) {
    // Escapes would confuse the boundary scan below; too rare to be worth
    // parsing, so any backslash disqualifies the dynamic path.
    if (css.includes('\\')) return false
    for (const i of dynamicIndices) {
      if (!isVarCompatibleFunction(t, expressionPaths[i])) return false
      const placeholder = makePlaceholder(i)
      const tokenIndex = css.indexOf(placeholder)
      if (!isDeclarationValuePosition(css, tokenIndex, placeholder.length)) {
        return false
      }
    }
  }

  const componentId = tagInfo.componentId || getGeneratedComponentId(state)

  const vars = dynamicIndices.map(i => {
    const varName = `--${componentId}-${i}`
    css = css.split(makePlaceholder(i)).join(`var(${varName})`)
    return t.arrayExpression([
      t.stringLiteral(varName),
      t.cloneNode(expressions[i], true),
    ])
  })

  // Hash the pre-stylis substituted css so the class name is independent of
  // the stylis/prefixer version in use.
  const staticClassName = `js-${hash(componentId + css)}`

  let compiledCss
  try {
    compiledCss = serialize(
      compile(`.${staticClassName}{${css}}`),
      middleware([prefixer, stringify])
    )
  } catch (error) {
    return false
  }

  const properties = [
    t.objectProperty(
      t.identifier('component'),
      tagInfo.element
        ? t.stringLiteral(tagInfo.element)
        : t.cloneNode(tagInfo.componentRef, true)
    ),
    t.objectProperty(t.identifier('className'), t.stringLiteral(staticClassName)),
    t.objectProperty(t.identifier('css'), t.stringLiteral(compiledCss)),
  ]
  if (vars.length) {
    properties.push(t.objectProperty(t.identifier('vars'), t.arrayExpression(vars)))
  }
  if (tagInfo.displayName) {
    properties.push(
      t.objectProperty(t.identifier('displayName'), t.stringLiteral(tagInfo.displayName))
    )
  }
  if (tagInfo.componentId) {
    properties.push(
      t.objectProperty(t.identifier('componentId'), t.stringLiteral(tagInfo.componentId))
    )
  }
  // The original tagged template lives on inside the fallback; the requeued
  // traversal runs the remaining visitors over it (withConfig merge skips,
  // templateLiterals transpiles), so mark it to keep this stage from
  // compiling it a second time.
  getProcessedTemplates(state).add(path.node)
  properties.push(
    t.objectProperty(
      t.identifier('fallback'),
      t.arrowFunctionExpression([], path.node)
    )
  )

  const runtimeImportPath = useRuntimeImportPath(state)
  let createName = state.file.get(CREATE_IMPORT_NAME)
  if (!createName) {
    createName = addNamed(path, 'createStyledElement', runtimeImportPath, {
      nameHint: 'createStyledElement',
    }).name
    state.file.set(CREATE_IMPORT_NAME, createName)
  }
  if (!state.file.get(PATCH_IMPORT_ADDED)) {
    addSideEffect(path, `${runtimeImportPath}/patch`)
    state.file.set(PATCH_IMPORT_ADDED, true)
  }

  const call = t.callExpression(t.identifier(createName), [
    t.objectExpression(properties),
  ])
  annotateAsPure(call)
  path.replaceWith(call)
  return true
}
