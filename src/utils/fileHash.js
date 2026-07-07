import path from 'path'
import fs from 'fs'
import hash from './hash'

// A stable per-file hash (module name + relative path, or file contents when
// there's no module root) — the seed for componentIds. Cached per file since
// the fs work is costly. Extracted from the original babel-plugin-styled-
// components displayNameAndId visitor; it's the only piece just-styled's
// transform still needs from that (now removed) machinery.

const findModuleRoot = filename => {
  if (!filename) return null
  let dir = path.dirname(filename)
  if (fs.existsSync(path.join(dir, 'package.json'))) {
    return dir
  } else if (dir !== filename) {
    return findModuleRoot(dir)
  } else {
    return null
  }
}

const FILE_HASH = 'styled-components-file-hash'
const separatorRegExp = new RegExp(`\\${path.sep}`, 'g')

export const getFileHash = state => {
  const { file } = state
  if (file.get(FILE_HASH)) return file.get(FILE_HASH)

  const filename = file.opts.filename
  const moduleRoot = findModuleRoot(filename)
  const filePath =
    moduleRoot && path.relative(moduleRoot, filename).replace(separatorRegExp, '/')
  const moduleName =
    moduleRoot && JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'))).name
  const code = file.code

  const stuffToHash = [moduleName]
  if (filePath) stuffToHash.push(filePath)
  else stuffToHash.push(code)

  const fileHash = hash(stuffToHash.join(''))
  file.set(FILE_HASH, fileHash)
  return fileHash
}
