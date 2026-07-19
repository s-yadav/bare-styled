const __importMetaUrl = require("url").pathToFileURL(__filename).href;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../../../tmp/jsdeps/node_modules/oxc-parser/src-js/index.js
var src_js_exports = {};
__export(src_js_exports, {
  ExportExportNameKind: () => ExportExportNameKind,
  ExportImportNameKind: () => ExportImportNameKind,
  ExportLocalNameKind: () => ExportLocalNameKind,
  ImportNameKind: () => ImportNameKind,
  ParseResult: () => ParseResult,
  Severity: () => Severity,
  Visitor: () => Visitor,
  experimentalGetLazyVisitor: () => experimentalGetLazyVisitor,
  parse: () => parse2,
  parseSync: () => parseSync2,
  rawTransferSupported: () => rawTransferSupported2,
  visitorKeys: () => keys_default
});
module.exports = __toCommonJS(src_js_exports);
var import_node_module2 = require("node:module");

// ../../../../tmp/jsdeps/node_modules/oxc-parser/src-js/bindings.js
var import_module = require("module");
var require2 = (0, import_module.createRequire)(__importMetaUrl);
var __dirname = new URL(".", __importMetaUrl).pathname;
var { readFileSync } = require2("fs");
var nativeBinding = null;
var loadErrors = [];
var isMusl = () => {
  let musl = false;
  if (process.platform === "linux") {
    musl = isMuslFromFilesystem();
    if (musl === null) {
      musl = isMuslFromReport();
    }
    if (musl === null) {
      musl = isMuslFromChildProcess();
    }
  }
  return musl;
};
var isFileMusl = (f) => f.includes("libc.musl-") || f.includes("ld-musl-");
var isMuslFromFilesystem = () => {
  try {
    return readFileSync("/usr/bin/ldd", "utf-8").includes("musl");
  } catch {
    return null;
  }
};
var isMuslFromReport = () => {
  let report = null;
  if (process.report && typeof process.report.getReport === "function") {
    process.report.excludeNetwork = true;
    report = process.report.getReport();
  }
  if (!report) {
    return null;
  }
  if (report.header && report.header.glibcVersionRuntime) {
    return false;
  }
  if (Array.isArray(report.sharedObjects)) {
    if (report.sharedObjects.some(isFileMusl)) {
      return true;
    }
  }
  return false;
};
var isMuslFromChildProcess = () => {
  try {
    return require2("child_process").execSync("ldd --version", { encoding: "utf8" }).includes("musl");
  } catch (e) {
    return false;
  }
};
function requireNative() {
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
    try {
      return require2(process.env.NAPI_RS_NATIVE_LIBRARY_PATH);
    } catch (err) {
      loadErrors.push(err);
    }
  } else if (process.platform === "android") {
    if (process.arch === "arm64") {
      try {
        return require2("./parser.android-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-android-arm64");
        const bindingPackageVersion = require2("@oxc-parser/binding-android-arm64/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm") {
      try {
        return require2("./parser.android-arm-eabi.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-android-arm-eabi");
        const bindingPackageVersion = require2("@oxc-parser/binding-android-arm-eabi/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on Android ${process.arch}`));
    }
  } else if (process.platform === "win32") {
    if (process.arch === "x64") {
      if (process.config && process.config.variables && process.config.variables.shlib_suffix === "dll.a" || process.config && process.config.variables && process.config.variables.node_target_type === "shared_library") {
        try {
          return require2("./parser.win32-x64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-win32-x64-gnu");
          const bindingPackageVersion = require2("@oxc-parser/binding-win32-x64-gnu/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require2("./parser.win32-x64-msvc.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-win32-x64-msvc");
          const bindingPackageVersion = require2("@oxc-parser/binding-win32-x64-msvc/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "ia32") {
      try {
        return require2("./parser.win32-ia32-msvc.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-win32-ia32-msvc");
        const bindingPackageVersion = require2("@oxc-parser/binding-win32-ia32-msvc/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm64") {
      try {
        return require2("./parser.win32-arm64-msvc.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-win32-arm64-msvc");
        const bindingPackageVersion = require2("@oxc-parser/binding-win32-arm64-msvc/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on Windows: ${process.arch}`));
    }
  } else if (process.platform === "darwin") {
    try {
      return require2("./parser.darwin-universal.node");
    } catch (e) {
      loadErrors.push(e);
    }
    try {
      const binding = require2("@oxc-parser/binding-darwin-universal");
      const bindingPackageVersion = require2("@oxc-parser/binding-darwin-universal/package.json").version;
      if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
        throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
      }
      return binding;
    } catch (e) {
      loadErrors.push(e);
    }
    if (process.arch === "x64") {
      try {
        return require2("./parser.darwin-x64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-darwin-x64");
        const bindingPackageVersion = require2("@oxc-parser/binding-darwin-x64/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm64") {
      try {
        return require2("./parser.darwin-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-darwin-arm64");
        const bindingPackageVersion = require2("@oxc-parser/binding-darwin-arm64/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on macOS: ${process.arch}`));
    }
  } else if (process.platform === "freebsd") {
    if (process.arch === "x64") {
      try {
        return require2("./parser.freebsd-x64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-freebsd-x64");
        const bindingPackageVersion = require2("@oxc-parser/binding-freebsd-x64/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm64") {
      try {
        return require2("./parser.freebsd-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-freebsd-arm64");
        const bindingPackageVersion = require2("@oxc-parser/binding-freebsd-arm64/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on FreeBSD: ${process.arch}`));
    }
  } else if (process.platform === "linux") {
    if (process.arch === "x64") {
      if (isMusl()) {
        try {
          return require2("./parser.linux-x64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-x64-musl");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-x64-musl/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require2("./parser.linux-x64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-x64-gnu");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-x64-gnu/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "arm64") {
      if (isMusl()) {
        try {
          return require2("./parser.linux-arm64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-arm64-musl");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-arm64-musl/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require2("./parser.linux-arm64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-arm64-gnu");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-arm64-gnu/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "arm") {
      if (isMusl()) {
        try {
          return require2("./parser.linux-arm-musleabihf.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-arm-musleabihf");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-arm-musleabihf/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require2("./parser.linux-arm-gnueabihf.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-arm-gnueabihf");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-arm-gnueabihf/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "loong64") {
      if (isMusl()) {
        try {
          return require2("./parser.linux-loong64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-loong64-musl");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-loong64-musl/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require2("./parser.linux-loong64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-loong64-gnu");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-loong64-gnu/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "riscv64") {
      if (isMusl()) {
        try {
          return require2("./parser.linux-riscv64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-riscv64-musl");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-riscv64-musl/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require2("./parser.linux-riscv64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require2("@oxc-parser/binding-linux-riscv64-gnu");
          const bindingPackageVersion = require2("@oxc-parser/binding-linux-riscv64-gnu/package.json").version;
          if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "ppc64") {
      try {
        return require2("./parser.linux-ppc64-gnu.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-linux-ppc64-gnu");
        const bindingPackageVersion = require2("@oxc-parser/binding-linux-ppc64-gnu/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "s390x") {
      try {
        return require2("./parser.linux-s390x-gnu.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-linux-s390x-gnu");
        const bindingPackageVersion = require2("@oxc-parser/binding-linux-s390x-gnu/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on Linux: ${process.arch}`));
    }
  } else if (process.platform === "openharmony") {
    if (process.arch === "arm64") {
      try {
        return require2("./parser.openharmony-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-openharmony-arm64");
        const bindingPackageVersion = require2("@oxc-parser/binding-openharmony-arm64/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "x64") {
      try {
        return require2("./parser.openharmony-x64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-openharmony-x64");
        const bindingPackageVersion = require2("@oxc-parser/binding-openharmony-x64/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm") {
      try {
        return require2("./parser.openharmony-arm.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require2("@oxc-parser/binding-openharmony-arm");
        const bindingPackageVersion = require2("@oxc-parser/binding-openharmony-arm/package.json").version;
        if (bindingPackageVersion !== "0.139.0" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 0.139.0 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on OpenHarmony: ${process.arch}`));
    }
  } else {
    loadErrors.push(new Error(`Unsupported OS: ${process.platform}, architecture: ${process.arch}`));
  }
}
nativeBinding = requireNative();
var forceWasi = process.env.NAPI_RS_FORCE_WASI === "true" || process.env.NAPI_RS_FORCE_WASI === "error";
if (!nativeBinding || forceWasi) {
  let wasiBinding = null;
  let wasiBindingError = null;
  try {
    wasiBinding = require2("./parser.wasi.cjs");
    nativeBinding = wasiBinding;
  } catch (err) {
    if (forceWasi) {
      wasiBindingError = err;
    }
  }
  if (!nativeBinding || forceWasi) {
    try {
      wasiBinding = require2("@oxc-parser/binding-wasm32-wasi");
      nativeBinding = wasiBinding;
    } catch (err) {
      if (forceWasi) {
        if (!wasiBindingError) {
          wasiBindingError = err;
        } else {
          wasiBindingError.cause = err;
        }
        loadErrors.push(err);
      }
    }
  }
  if (process.env.NAPI_RS_FORCE_WASI === "error" && !wasiBinding) {
    const error = new Error("WASI binding not found and NAPI_RS_FORCE_WASI is set to error");
    error.cause = wasiBindingError;
    throw error;
  }
}
if (!nativeBinding && globalThis.process?.versions?.["webcontainer"]) {
  try {
    nativeBinding = require2("./webcontainer-fallback.cjs");
  } catch (err) {
    loadErrors.push(err);
  }
}
if (!nativeBinding) {
  if (loadErrors.length > 0) {
    const error = new Error(
      `Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try \`npm i\` again after removing both package-lock.json and node_modules directory.`
    );
    error.cause = loadErrors.reduce((err, cur) => {
      cur.cause = err;
      return cur;
    });
    throw error;
  }
  throw new Error(`Failed to load native binding`);
}
var { Severity, ParseResult, ExportExportNameKind, ExportImportNameKind, ExportLocalNameKind, ImportNameKind, parse, parseSync, rawTransferSupported } = nativeBinding;
var { getBufferOffset, parseRaw, parseRawSync } = nativeBinding;

// ../../../../tmp/jsdeps/node_modules/oxc-parser/src-js/wrap.js
function wrap(result) {
  let program, module2, comments, errors;
  return {
    get program() {
      if (!program) program = jsonParseAst(result.program);
      return program;
    },
    get module() {
      if (!module2) module2 = result.module;
      return module2;
    },
    get comments() {
      if (!comments) comments = result.comments;
      return comments;
    },
    get errors() {
      if (!errors) errors = result.errors;
      return errors;
    }
  };
}
function jsonParseAst(programJson) {
  const { node: program, fixes } = JSON.parse(programJson);
  for (const fixPath of fixes) {
    applyFix(program, fixPath);
  }
  return program;
}
function applyFix(program, fixPath) {
  let node = program;
  for (const key of fixPath) {
    node = node[key];
  }
  if (node.bigint) {
    node.value = BigInt(node.bigint);
  } else {
    try {
      node.value = RegExp(node.regex.pattern, node.regex.flags);
    } catch {
    }
  }
}

// ../../../../tmp/jsdeps/node_modules/oxc-parser/src-js/generated/visit/keys.js
var { freeze } = Object;
var $EMPTY = freeze([]);
var DECORATORS__KEY__TYPE_ANNOTATION__VALUE = freeze([
  "decorators",
  "key",
  "typeAnnotation",
  "value"
]);
var LEFT__RIGHT = freeze(["left", "right"]);
var ARGUMENT = freeze(["argument"]);
var BODY = freeze(["body"]);
var LABEL = freeze(["label"]);
var CALLEE__TYPE_ARGUMENTS__ARGUMENTS = freeze(["callee", "typeArguments", "arguments"]);
var EXPRESSION = freeze(["expression"]);
var DECORATORS__ID__TYPE_PARAMETERS__SUPER_CLASS__SUPER_TYPE_ARGUMENTS__IMPLEMENTS__BODY = freeze([
  "decorators",
  "id",
  "typeParameters",
  "superClass",
  "superTypeArguments",
  "implements",
  "body"
]);
var TEST__CONSEQUENT__ALTERNATE = freeze(["test", "consequent", "alternate"]);
var LEFT__RIGHT__BODY = freeze(["left", "right", "body"]);
var ID__TYPE_PARAMETERS__PARAMS__RETURN_TYPE__BODY = freeze([
  "id",
  "typeParameters",
  "params",
  "returnType",
  "body"
]);
var KEY__VALUE = freeze(["key", "value"]);
var LOCAL = freeze(["local"]);
var OBJECT__PROPERTY = freeze(["object", "property"]);
var DECORATORS__KEY__TYPE_ANNOTATION = freeze(["decorators", "key", "typeAnnotation"]);
var EXPRESSION__TYPE_ANNOTATION = freeze(["expression", "typeAnnotation"]);
var TYPE_PARAMETERS__PARAMS__RETURN_TYPE = freeze(["typeParameters", "params", "returnType"]);
var EXPRESSION__TYPE_ARGUMENTS = freeze(["expression", "typeArguments"]);
var MEMBERS = freeze(["members"]);
var ID__BODY = freeze(["id", "body"]);
var TYPES = freeze(["types"]);
var TYPE_ANNOTATION = freeze(["typeAnnotation"]);
var PARAMS = freeze(["params"]);
var keys_default = freeze({
  // Leaf nodes
  DebuggerStatement: $EMPTY,
  EmptyStatement: $EMPTY,
  Literal: $EMPTY,
  PrivateIdentifier: $EMPTY,
  Super: $EMPTY,
  TemplateElement: $EMPTY,
  ThisExpression: $EMPTY,
  JSXClosingFragment: $EMPTY,
  JSXEmptyExpression: $EMPTY,
  JSXIdentifier: $EMPTY,
  JSXOpeningFragment: $EMPTY,
  JSXText: $EMPTY,
  TSAnyKeyword: $EMPTY,
  TSBigIntKeyword: $EMPTY,
  TSBooleanKeyword: $EMPTY,
  TSIntrinsicKeyword: $EMPTY,
  TSJSDocUnknownType: $EMPTY,
  TSNeverKeyword: $EMPTY,
  TSNullKeyword: $EMPTY,
  TSNumberKeyword: $EMPTY,
  TSObjectKeyword: $EMPTY,
  TSStringKeyword: $EMPTY,
  TSSymbolKeyword: $EMPTY,
  TSThisType: $EMPTY,
  TSUndefinedKeyword: $EMPTY,
  TSUnknownKeyword: $EMPTY,
  TSVoidKeyword: $EMPTY,
  // Non-leaf nodes
  AccessorProperty: DECORATORS__KEY__TYPE_ANNOTATION__VALUE,
  ArrayExpression: freeze(["elements"]),
  ArrayPattern: freeze(["decorators", "elements", "typeAnnotation"]),
  ArrowFunctionExpression: freeze(["typeParameters", "params", "returnType", "body"]),
  AssignmentExpression: LEFT__RIGHT,
  AssignmentPattern: freeze(["decorators", "left", "right", "typeAnnotation"]),
  AwaitExpression: ARGUMENT,
  BinaryExpression: LEFT__RIGHT,
  BlockStatement: BODY,
  BreakStatement: LABEL,
  CallExpression: CALLEE__TYPE_ARGUMENTS__ARGUMENTS,
  CatchClause: freeze(["param", "body"]),
  ChainExpression: EXPRESSION,
  ClassBody: BODY,
  ClassDeclaration: DECORATORS__ID__TYPE_PARAMETERS__SUPER_CLASS__SUPER_TYPE_ARGUMENTS__IMPLEMENTS__BODY,
  ClassExpression: DECORATORS__ID__TYPE_PARAMETERS__SUPER_CLASS__SUPER_TYPE_ARGUMENTS__IMPLEMENTS__BODY,
  ConditionalExpression: TEST__CONSEQUENT__ALTERNATE,
  ContinueStatement: LABEL,
  Decorator: EXPRESSION,
  DoWhileStatement: freeze(["body", "test"]),
  ExportAllDeclaration: freeze(["exported", "source", "attributes"]),
  ExportDefaultDeclaration: freeze(["declaration"]),
  ExportNamedDeclaration: freeze(["declaration", "specifiers", "source", "attributes"]),
  ExportSpecifier: freeze(["local", "exported"]),
  ExpressionStatement: EXPRESSION,
  ForInStatement: LEFT__RIGHT__BODY,
  ForOfStatement: LEFT__RIGHT__BODY,
  ForStatement: freeze(["init", "test", "update", "body"]),
  FunctionDeclaration: ID__TYPE_PARAMETERS__PARAMS__RETURN_TYPE__BODY,
  FunctionExpression: ID__TYPE_PARAMETERS__PARAMS__RETURN_TYPE__BODY,
  Identifier: freeze(["decorators", "typeAnnotation"]),
  IfStatement: TEST__CONSEQUENT__ALTERNATE,
  ImportAttribute: KEY__VALUE,
  ImportDeclaration: freeze(["specifiers", "source", "attributes"]),
  ImportDefaultSpecifier: LOCAL,
  ImportExpression: freeze(["source", "options"]),
  ImportNamespaceSpecifier: LOCAL,
  ImportSpecifier: freeze(["imported", "local"]),
  LabeledStatement: freeze(["label", "body"]),
  LogicalExpression: LEFT__RIGHT,
  MemberExpression: OBJECT__PROPERTY,
  MetaProperty: freeze(["meta", "property"]),
  MethodDefinition: freeze(["decorators", "key", "value"]),
  NewExpression: CALLEE__TYPE_ARGUMENTS__ARGUMENTS,
  ObjectExpression: freeze(["properties"]),
  ObjectPattern: freeze(["decorators", "properties", "typeAnnotation"]),
  ParenthesizedExpression: EXPRESSION,
  Program: BODY,
  Property: KEY__VALUE,
  PropertyDefinition: DECORATORS__KEY__TYPE_ANNOTATION__VALUE,
  RestElement: freeze(["decorators", "argument", "typeAnnotation"]),
  ReturnStatement: ARGUMENT,
  SequenceExpression: freeze(["expressions"]),
  SpreadElement: ARGUMENT,
  StaticBlock: BODY,
  SwitchCase: freeze(["test", "consequent"]),
  SwitchStatement: freeze(["discriminant", "cases"]),
  TaggedTemplateExpression: freeze(["tag", "typeArguments", "quasi"]),
  TemplateLiteral: freeze(["quasis", "expressions"]),
  ThrowStatement: ARGUMENT,
  TryStatement: freeze(["block", "handler", "finalizer"]),
  UnaryExpression: ARGUMENT,
  UpdateExpression: ARGUMENT,
  V8IntrinsicExpression: freeze(["name", "arguments"]),
  VariableDeclaration: freeze(["declarations"]),
  VariableDeclarator: freeze(["id", "init"]),
  WhileStatement: freeze(["test", "body"]),
  WithStatement: freeze(["object", "body"]),
  YieldExpression: ARGUMENT,
  JSXAttribute: freeze(["name", "value"]),
  JSXClosingElement: freeze(["name"]),
  JSXElement: freeze(["openingElement", "children", "closingElement"]),
  JSXExpressionContainer: EXPRESSION,
  JSXFragment: freeze(["openingFragment", "children", "closingFragment"]),
  JSXMemberExpression: OBJECT__PROPERTY,
  JSXNamespacedName: freeze(["namespace", "name"]),
  JSXOpeningElement: freeze(["name", "typeArguments", "attributes"]),
  JSXSpreadAttribute: ARGUMENT,
  JSXSpreadChild: EXPRESSION,
  TSAbstractAccessorProperty: DECORATORS__KEY__TYPE_ANNOTATION,
  TSAbstractMethodDefinition: KEY__VALUE,
  TSAbstractPropertyDefinition: DECORATORS__KEY__TYPE_ANNOTATION,
  TSArrayType: freeze(["elementType"]),
  TSAsExpression: EXPRESSION__TYPE_ANNOTATION,
  TSCallSignatureDeclaration: TYPE_PARAMETERS__PARAMS__RETURN_TYPE,
  TSClassImplements: EXPRESSION__TYPE_ARGUMENTS,
  TSConditionalType: freeze(["checkType", "extendsType", "trueType", "falseType"]),
  TSConstructSignatureDeclaration: TYPE_PARAMETERS__PARAMS__RETURN_TYPE,
  TSConstructorType: TYPE_PARAMETERS__PARAMS__RETURN_TYPE,
  TSDeclareFunction: ID__TYPE_PARAMETERS__PARAMS__RETURN_TYPE__BODY,
  TSEmptyBodyFunctionExpression: freeze(["id", "typeParameters", "params", "returnType"]),
  TSEnumBody: MEMBERS,
  TSEnumDeclaration: ID__BODY,
  TSEnumMember: freeze(["id", "initializer"]),
  TSExportAssignment: EXPRESSION,
  TSExternalModuleReference: EXPRESSION,
  TSFunctionType: TYPE_PARAMETERS__PARAMS__RETURN_TYPE,
  TSImportEqualsDeclaration: freeze(["id", "moduleReference"]),
  TSImportType: freeze(["source", "options", "qualifier", "typeArguments"]),
  TSIndexSignature: freeze(["parameters", "typeAnnotation"]),
  TSIndexedAccessType: freeze(["objectType", "indexType"]),
  TSInferType: freeze(["typeParameter"]),
  TSInstantiationExpression: EXPRESSION__TYPE_ARGUMENTS,
  TSInterfaceBody: BODY,
  TSInterfaceDeclaration: freeze(["id", "typeParameters", "extends", "body"]),
  TSInterfaceHeritage: EXPRESSION__TYPE_ARGUMENTS,
  TSIntersectionType: TYPES,
  TSJSDocNonNullableType: TYPE_ANNOTATION,
  TSJSDocNullableType: TYPE_ANNOTATION,
  TSLiteralType: freeze(["literal"]),
  TSMappedType: freeze(["key", "constraint", "nameType", "typeAnnotation"]),
  TSMethodSignature: freeze(["key", "typeParameters", "params", "returnType"]),
  TSModuleBlock: BODY,
  TSModuleDeclaration: ID__BODY,
  TSNamedTupleMember: freeze(["label", "elementType"]),
  TSNamespaceExportDeclaration: freeze(["id"]),
  TSNonNullExpression: EXPRESSION,
  TSOptionalType: TYPE_ANNOTATION,
  TSParameterProperty: freeze(["decorators", "parameter"]),
  TSParenthesizedType: TYPE_ANNOTATION,
  TSPropertySignature: freeze(["key", "typeAnnotation"]),
  TSQualifiedName: LEFT__RIGHT,
  TSRestType: TYPE_ANNOTATION,
  TSSatisfiesExpression: EXPRESSION__TYPE_ANNOTATION,
  TSTemplateLiteralType: freeze(["quasis", "types"]),
  TSTupleType: freeze(["elementTypes"]),
  TSTypeAliasDeclaration: freeze(["id", "typeParameters", "typeAnnotation"]),
  TSTypeAnnotation: TYPE_ANNOTATION,
  TSTypeAssertion: freeze(["typeAnnotation", "expression"]),
  TSTypeLiteral: MEMBERS,
  TSTypeOperator: TYPE_ANNOTATION,
  TSTypeParameter: freeze(["name", "constraint", "default"]),
  TSTypeParameterDeclaration: PARAMS,
  TSTypeParameterInstantiation: PARAMS,
  TSTypePredicate: freeze(["parameterName", "typeAnnotation"]),
  TSTypeQuery: freeze(["exprName", "typeArguments"]),
  TSTypeReference: freeze(["typeName", "typeArguments"]),
  TSUnionType: TYPES
});

// ../../../../tmp/jsdeps/node_modules/oxc-parser/src-js/visit/index.js
var import_node_module = require("node:module");
var walkProgram = null;
var addVisitorToCompiled;
var createCompiledVisitor;
var finalizeCompiledVisitor;
var Visitor = class {
  #compiledVisitor = null;
  constructor(visitor) {
    if (walkProgram === null) {
      const require4 = (0, import_node_module.createRequire)(__importMetaUrl);
      ({ walkProgram } = require4("../generated/visit/walk.js"));
      ({
        addVisitorToCompiled,
        createCompiledVisitor,
        finalizeCompiledVisitor
      } = require4("./visitor.js"));
    }
    const compiledVisitor = createCompiledVisitor();
    addVisitorToCompiled(visitor);
    const needsVisit = finalizeCompiledVisitor();
    if (needsVisit) this.#compiledVisitor = compiledVisitor;
  }
  /**
   * Visit AST.
   * @param program - The AST to visit.
   * @returns {undefined}
   */
  visit(program) {
    const compiledVisitor = this.#compiledVisitor;
    if (compiledVisitor !== null) walkProgram(program, compiledVisitor);
  }
};

// ../../../../tmp/jsdeps/node_modules/oxc-parser/src-js/raw-transfer/supported.js
var rawTransferIsSupported = null;
function rawTransferSupported2() {
  if (rawTransferIsSupported === null) {
    rawTransferIsSupported = rawTransferRuntimeSupported() && rawTransferSupported();
  }
  return rawTransferIsSupported;
}
function rawTransferRuntimeSupported() {
  let global;
  try {
    global = globalThis;
  } catch {
    return false;
  }
  const isBun = !!global.Bun || !!global.process?.versions?.bun;
  if (isBun) return false;
  const isDeno = !!global.Deno;
  if (isDeno) {
    const match2 = Deno.version?.deno?.match(/^(\d+)\./);
    return !!match2 && match2[1] * 1 >= 2;
  }
  const isNode = global.process?.release?.name === "node";
  if (!isNode) return false;
  const match = process.version?.match(/^v(\d+)\./);
  return !!match && match[1] * 1 >= 22;
}

// ../../../../tmp/jsdeps/node_modules/oxc-parser/src-js/index.js
var require3 = (0, import_node_module2.createRequire)(__importMetaUrl);
var parseSyncRaw = null;
var parseRaw2;
var parseSyncLazy = null;
var parseLazy;
var LazyVisitor;
function loadRawTransfer() {
  if (parseSyncRaw === null) {
    ({ parseSyncRaw, parse: parseRaw2 } = require3("./raw-transfer/eager.js"));
  }
}
function loadRawTransferLazy() {
  if (parseSyncLazy === null) {
    ({ parseSyncLazy, parse: parseLazy, Visitor: LazyVisitor } = require3("./raw-transfer/lazy.js"));
  }
}
function parseSync2(filename, sourceText, options) {
  if (options?.experimentalRawTransfer) {
    loadRawTransfer();
    return parseSyncRaw(filename, sourceText, options);
  }
  if (options?.experimentalLazy) {
    loadRawTransferLazy();
    return parseSyncLazy(filename, sourceText, options);
  }
  return wrap(parseSync(filename, sourceText, options));
}
async function parse2(filename, sourceText, options) {
  if (options?.experimentalRawTransfer) {
    loadRawTransfer();
    return await parseRaw2(filename, sourceText, options);
  }
  if (options?.experimentalLazy) {
    loadRawTransferLazy();
    return await parseLazy(filename, sourceText, options);
  }
  return wrap(await parse(filename, sourceText, options));
}
function experimentalGetLazyVisitor() {
  loadRawTransferLazy();
  return LazyVisitor;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ExportExportNameKind,
  ExportImportNameKind,
  ExportLocalNameKind,
  ImportNameKind,
  ParseResult,
  Severity,
  Visitor,
  experimentalGetLazyVisitor,
  parse,
  parseSync,
  rawTransferSupported,
  visitorKeys
});
