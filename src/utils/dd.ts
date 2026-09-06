export function dd(data: unknown): never {
  console.dir(data, { depth: null });
  process.exit(0);
}
