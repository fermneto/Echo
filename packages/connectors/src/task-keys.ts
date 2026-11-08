// Linear e Jira podem estar ligados juntos, e a chave da tarefa (ECH-128) é única na empresa.
// Por isso os dois precisam de prefixos de projeto diferentes; aqui se descobre quando não têm.

/** Prefixo da chave: "ECH-128" → "ECH". Sem hífen, a chave inteira. */
export const keyPrefix = (key: string): string => {
  const i = key.lastIndexOf("-");
  return (i > 0 ? key.slice(0, i) : key).toUpperCase();
};

/** Prefixos que aparecem nas chaves dos dois trackers, em ordem alfabética. */
export function sharedKeyPrefixes(linearKeys: readonly string[], jiraKeys: readonly string[]): string[] {
  const linear = new Set(linearKeys.map(keyPrefix));
  return [...new Set(jiraKeys.map(keyPrefix))].filter((p) => linear.has(p)).sort();
}
