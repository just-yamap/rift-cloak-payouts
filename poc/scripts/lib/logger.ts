const C = {
  g: "\x1b[32m",
  r: "\x1b[31m",
  y: "\x1b[33m",
  c: "\x1b[36m",
  b: "\x1b[1m",
  d: "\x1b[2m",
  n: "\x1b[0m",
} as const;

export const log = {
  step: (title: string) =>
    console.log(`\n${C.b}${C.c}=== ${title} ===${C.n}\n`),
  ok: (msg: string) => console.log(`${C.g}  OK${C.n} ${msg}`),
  fail: (msg: string) => {
    console.log(`${C.r}  FAIL${C.n} ${msg}`);
    process.exit(1);
  },
  info: (msg: string) => console.log(`${C.y}  ->${C.n} ${msg}`),
  dim: (msg: string) => console.log(`${C.d}     ${msg}${C.n}`),
  progress: (label: string, msg: string) =>
    console.log(`  ${C.c}[${label}]${C.n} ${msg}`),
  banner: (msg: string) =>
    console.log(`\n${C.g}${C.b}=== ${msg} ===${C.n}\n`),
  hint: (msg: string) => console.log(`${C.y}${msg}${C.n}`),
  error: (msg: string, e?: any) => {
    console.error(`\n${C.r}ERROR:${C.n} ${msg}`);
    if (e?.category) console.error(`${C.r}Category:${C.n} ${e.category}`);
    if (e?.cause) console.error(`${C.r}Cause:${C.n}`, e.cause);
    if (e?.stack && process.env.DEBUG) console.error(e.stack);
  },
};

export { C };
