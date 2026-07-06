import pureAnnotation from './pure'
import minify from './minify'
import displayNameAndId from './displayNameAndId'
import compileStatic from './compileStatic'
import templateLiterals from './templateLiterals'

export const processTaggedTemplate = t => {
  const minifyVisit = minify(t)
  const displayNameAndIdVisit = displayNameAndId(t)
  const compileStaticVisit = compileStatic(t)
  const templateLiteralsVisit = templateLiterals(t)
  const pureAnnotationVisit = pureAnnotation(t)
  return (path, state) => {
    minifyVisit(path, state)
    displayNameAndIdVisit(path, state)
    // Replaces the tagged template with a descriptor call; the remaining
    // visitors then only apply to the original template inside its fallback,
    // which the requeued traversal visits on its own.
    if (compileStaticVisit(path, state)) return
    templateLiteralsVisit(path, state)
    pureAnnotationVisit(path, state)
  }
}

export const processCallExpression = t => {
  const displayNameAndIdVisit = displayNameAndId(t)
  const pureAnnotationVisit = pureAnnotation(t)
  return (path, state) => {
    displayNameAndIdVisit(path, state)
    pureAnnotationVisit(path, state)
  }
}
