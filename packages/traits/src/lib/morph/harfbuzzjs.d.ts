/** harfbuzzjs ships no type declarations for its Emscripten loader and wrapper; `shape.ts` types what is used. */
declare module 'harfbuzzjs/hb.js' {
  const createHarfBuzz: (opts: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (p: string) => string }) => Promise<unknown>;
  export default createHarfBuzz;
}
declare module 'harfbuzzjs/hbjs.js' {
  const hbjs: (module: unknown) => unknown;
  export default hbjs;
}
