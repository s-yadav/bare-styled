// just-styled transform (decoupled).
//
// The compile step's only job now: rewrite a `styled` tagged template into a
// `createStyled(component, { componentId, displayName })`...`` call, keeping the
// template's interpolations LIVE so the runtime can resolve them on first
// render. All CSS analysis (minify, static extraction, stylis) moved to the
// runtime `flatten`, so this plugin no longer forks babel-plugin-styled-
// components' heavy machinery — it just detects the styled form, generates a
// stable componentId + displayName, and injects the runtime import.
//
// Only the simple forms compile: `styled.tag`, `styled('tag')`, `styled(Ident)`.
// Anything with a chain (`.attrs`, `.withConfig`), the helpers (`css`,
// `keyframes`, `createGlobalStyle`), css-prop, and exotic tag shapes are left
// untouched and render through real styled-components.
import syntax from '@babel/plugin-syntax-jsx'
import path from 'path'
import { addNamed, addSideEffect } from '@babel/helper-module-imports'
import { isStyled } from './utils/detectors'
import getName from './utils/getName'
import prefixLeadingDigit from './utils/prefixDigit'
import { getFileHash } from './visitors/displayNameAndId'
import { useDisplayName, useRuntimeImportPath, useMeaninglessFileNames, useNamespace } from './utils/options'

const CREATE_IMPORT_NAME = 'just-styled-create-name'
const PATCH_IMPORT_ADDED = 'just-styled-patch-added'
const POSITION = 'just-styled-position'

// Reject anything that isn't exactly `styled.tag`, `styled('tag')`, or
// `styled(Ident)`. Returns the component node (a string literal for native
// tags, a cloned identifier for component refs) or null to leave the node be.
const parseSimpleTag = (t, tag) => {
  // styled.div
  if (
    t.isMemberExpression(tag) &&
    !tag.computed &&
    t.isIdentifier(tag.object) &&
    t.isIdentifier(tag.property)
  ) {
    return t.stringLiteral(tag.property.name)
  }
  // styled('div') | styled(Component)
  if (
    t.isCallExpression(tag) &&
    t.isIdentifier(tag.callee) &&
    tag.arguments.length === 1
  ) {
    const arg = tag.arguments[0]
    if (t.isStringLiteral(arg)) return t.stringLiteral(arg.value)
    if (t.isIdentifier(arg)) return t.cloneNode(arg, true)
  }
  return null
}

const getBlockName = (file, meaningless) => {
  const name = path.basename(file.opts.filename, path.extname(file.opts.filename))
  return meaningless.includes(name)
    ? path.basename(path.dirname(file.opts.filename))
    : name
}

const getDisplayName = (t, componentPath, state) => {
  const componentName = getName(t)(componentPath)
  const file = state.file
  if (!file || !file.opts.filename) return componentName
  const blockName = getBlockName(file, useMeaninglessFileNames(state))
  if (blockName === componentName) return componentName
  return componentName
    ? `${prefixLeadingDigit(blockName)}__${componentName}`
    : prefixLeadingDigit(blockName)
}

const nextComponentId = state => {
  const id = state.file.get(POSITION) || 0
  state.file.set(POSITION, id + 1)
  return `${useNamespace(state)}sc-${getFileHash(state)}-${id}`
}

export default function ({ types: t }) {
  return {
    inherits: syntax,
    visitor: {
      TaggedTemplateExpression(path, state) {
        const tag = path.node.tag
        if (!isStyled(t)(tag, state)) return
        const componentNode = parseSimpleTag(t, tag)
        if (!componentNode) return // chains / helpers / exotic shapes -> untouched

        const componentId = nextComponentId(state)
        const configProps = [
          t.objectProperty(t.identifier('componentId'), t.stringLiteral(componentId)),
        ]
        if (useDisplayName(state)) {
          const displayName = getDisplayName(t, path, state)
          if (displayName) {
            configProps.push(
              t.objectProperty(
                t.identifier('displayName'),
                t.stringLiteral(displayName.replace(/[^_a-zA-Z0-9-]/g, ''))
              )
            )
          }
        }

        const runtimeImportPath = useRuntimeImportPath(state)
        let createName = state.file.get(CREATE_IMPORT_NAME)
        if (!createName) {
          createName = addNamed(path, 'createStyled', runtimeImportPath, {
            nameHint: 'createStyled',
          }).name
          state.file.set(CREATE_IMPORT_NAME, createName)
        }
        if (!state.file.get(PATCH_IMPORT_ADDED)) {
          addSideEffect(path, `${runtimeImportPath}/patch`)
          state.file.set(PATCH_IMPORT_ADDED, true)
        }

        // Rewrite the tag; the quasi (with live interpolations) stays intact.
        path.node.tag = t.callExpression(t.identifier(createName), [
          componentNode,
          t.objectExpression(configProps),
        ])
      },
    },
  }
}
