function clean(value, max = 12000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalized(value) {
  return clean(value, 12000).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function uniqueStrings(...values) {
  const result = [];
  const seen = new Set();
  for (const value of values.flat()) {
    const text = clean(value, 1200);
    if (!text) continue;
    const key = normalized(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function mergeNarrative(left, right, max = 12000) {
  const first = clean(left, max);
  const second = clean(right, max);
  if (!first) return second;
  if (!second) return first;
  const a = normalized(first);
  const b = normalized(second);
  if (a === b) return first.length >= second.length ? first : second;
  if (a.includes(b)) return first;
  if (b.includes(a)) return second;
  return clean(`${first}\n\n${second}`, max);
}

function identity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const name = clean(value.name, 500);
  if (name) return `name:${normalized(name)}`;
  const text = clean(value.text, 1200);
  if (text) return `text:${normalized(text)}`;
  return "";
}

function mergeArray(left, right, key) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if ([...a, ...b].every((entry) => typeof entry !== "object" || entry == null)) return uniqueStrings(a, b);

  const result = [];
  const index = new Map();
  const append = (entry) => {
    if (entry == null) return;
    if (typeof entry !== "object" || Array.isArray(entry)) {
      const marker = `value:${normalized(entry)}`;
      if (!marker.endsWith(":" ) && !index.has(marker)) {
        index.set(marker, result.length);
        result.push(entry);
      }
      return;
    }
    const marker = identity(entry) || `json:${JSON.stringify(entry)}`;
    if (!index.has(marker)) {
      index.set(marker, result.length);
      result.push(entry);
      return;
    }
    const position = index.get(marker);
    result[position] = mergeValue(result[position], entry, key === "sequence" || key === "details" ? "detail" : key);
  };
  a.forEach(append);
  b.forEach(append);
  return result;
}

function mergeObject(left, right, parentKey = "") {
  const first = left && typeof left === "object" && !Array.isArray(left) ? left : {};
  const second = right && typeof right === "object" && !Array.isArray(right) ? right : {};
  const result = { ...first };
  for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) {
    result[key] = mergeValue(first[key], second[key], key || parentKey);
  }
  return result;
}

function mergeValue(left, right, key = "") {
  if (right == null || right === "") return left;
  if (left == null || left === "") return right;
  if (Array.isArray(left) || Array.isArray(right)) return mergeArray(left, right, key);
  if (typeof left === "object" || typeof right === "object") return mergeObject(left, right, key);
  if (typeof left === "string" || typeof right === "string") {
    if (["name", "fromName", "toName", "label"].includes(key)) return clean(left || right, 1200);
    if (["summary", "description", "atmosphere", "prompt", "negativePrompt", "text", "role"].includes(key)) return mergeNarrative(left, right, key === "summary" ? 12000 : 6000);
    return normalized(left) === normalized(right) ? left : mergeNarrative(left, right, 6000);
  }
  return left === right ? left : right;
}

function accumulateNode(current, incoming, runId) {
  if (!current) return { ...incoming, runId: Number(runId || incoming?.runId || 0) };
  const aliases = uniqueStrings(
    current.aliases || [],
    incoming?.aliases || [],
    incoming?.name && normalized(incoming.name) !== normalized(current.name) ? [incoming.name] : [],
  );
  return {
    key: String(current.key),
    runId: Number(runId || incoming?.runId || current.runId || 0),
    kind: String(current.kind || incoming?.kind || ""),
    name: clean(current.name || incoming?.name, 260),
    summary: mergeNarrative(current.summary, incoming?.summary, 12000),
    aliases,
    sourceVideoIds: uniqueStrings(current.sourceVideoIds || [], incoming?.sourceVideoIds || []),
    payload: mergeObject(current.payload, incoming?.payload),
    state: current.state === "approved" ? "approved" : "draft",
    updatedAt: String(current.updatedAt || ""),
  };
}

function accumulateRelation(current, incoming, runId) {
  if (!current) return { ...incoming, runId: Number(runId || incoming?.runId || 0) };
  return {
    ...current,
    runId: Number(runId || incoming?.runId || current.runId || 0),
    sourceVideoIds: uniqueStrings(current.sourceVideoIds || [], incoming?.sourceVideoIds || []),
    payload: mergeObject(current.payload, incoming?.payload),
  };
}

module.exports = {
  accumulateNode,
  accumulateRelation,
  mergeNarrative,
  mergeObject,
  mergeValue,
  uniqueStrings,
};
