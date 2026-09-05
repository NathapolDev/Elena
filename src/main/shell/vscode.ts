/** Builds the narrow external protocol Elena uses for an already-validated file. */
export function vscodeUrlForFile(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const encoded = normalized
    .split('/')
    .map((part, index) => (index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/')
  return `vscode://file${encoded.startsWith('/') ? '' : '/'}${encoded}`
}
