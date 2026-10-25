export type ImportMap = {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
};

// Chrome merges every import map on the page; an entry that would change an already resolved specifier is ignored
export function addImportMap(map: ImportMap) {
  const script = document.createElement("script");
  script.type = "importmap";
  script.textContent = JSON.stringify(map);
  document.head.append(script);
}
