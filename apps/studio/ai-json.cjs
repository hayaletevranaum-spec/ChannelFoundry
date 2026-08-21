const fs = require("node:fs");
const path = require("node:path");

function cleanInput(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function stripCodeFences(value) {
  const text = cleanInput(value);
  if (!text.includes("```")) return text;
  return text
    .replace(/^\s*```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function balancedCandidate(text, start) {
  const opening = text[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : "";
  if (!closing) return "";
  const stack = [closing];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack[stack.length - 1] !== char) return "";
      stack.pop();
      if (!stack.length) return text.slice(start, index + 1);
    }
  }
  return "";
}

function candidates(value) {
  const raw = cleanInput(value);
  const stripped = stripCodeFences(raw);
  const list = [];
  const add = (entry) => {
    const text = cleanInput(entry);
    if (text && !list.includes(text)) list.push(text);
  };
  add(raw);
  add(stripped);

  for (const source of [stripped, raw]) {
    const startsWithStructure = /^[{[]/.test(source);
    for (let index = 0; index < source.length; index += 1) {
      if (index > 0 && startsWithStructure) break;
      if (source[index] !== "{" && source[index] !== "[") continue;
      const candidate = balancedCandidate(source, index);
      if (candidate) add(candidate);
    }
  }
  return list;
}

function parseLoose(value) {
  let lastError = null;
  for (const candidate of candidates(value)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return { value: parsed, normalized: candidate };
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error("AI yanıtı beklenen JSON biçiminde değil.");
  error.code = "AI_JSON_PARSE";
  error.cause = lastError;
  throw error;
}

function repairStructure(value) {
  const source = stripCodeFences(value);
  const start = source.search(/[\[{]/);
  if (start < 0) return "";

  const text = source.slice(start);
  const output = [];
  const stack = [];
  let inString = false;
  let escaped = false;
  let rootStarted = false;

  const closeTop = () => {
    const opening = stack.pop();
    if (opening) output.push(opening === "{" ? "}" : "]");
  };
  const finish = (index) => {
    const remainder = text.slice(index + 1).trim();
    // Do not silently discard another named field or a prose continuation.
    if (remainder && /[\p{L}\p{N}_:]/u.test(remainder)) return "";
    return output.join("");
  };
  const continuesRootObject = (index) => {
    const remainder = text.slice(index + 1).trimStart().replace(/^[}\]]+\s*/, "");
    return /^,\s*"/.test(remainder);
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      output.push(char);
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      output.push(char);
      continue;
    }
    if (char === "{" || char === "[") {
      rootStarted = true;
      stack.push(char);
      output.push(char);
      continue;
    }
    if (!rootStarted) continue;

    // Some providers occasionally emit `,."field"` between otherwise valid
    // object properties. A standalone dot cannot be valid JSON here.
    if (char === ".") {
      let previousIndex = output.length - 1;
      while (previousIndex >= 0 && /\s/.test(output[previousIndex])) previousIndex -= 1;
      let nextIndex = index + 1;
      while (nextIndex < text.length && /\s/.test(text[nextIndex])) nextIndex += 1;
      if (output[previousIndex] === "," && text[nextIndex] === '"') continue;
      if (output[previousIndex] === "," && /^[A-Za-z_][A-Za-z0-9_]*"\s*:/.test(text.slice(nextIndex))) {
        output.push('"');
        inString = true;
        continue;
      }
    }

    if (char === ",") {
      let nextIndex = index + 1;
      while (nextIndex < text.length && /\s/.test(text[nextIndex])) nextIndex += 1;
      const next = text[nextIndex];
      // Inside an array item, `},{` after a nested object means the item itself
      // is missing its closing brace. A bare object cannot follow a comma in an object.
      if (stack.at(-1) === "{" && stack.at(-2) === "[" && next === "{") closeTop();
      if (next === "}" || next === "]") continue;
      output.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      // A duplicated nested closer can appear immediately before the next
      // root property (for example `}]}],"storyHints"`). Do not let that
      // accidental closer terminate the root and discard valid later fields.
      if (stack.length === 1 && stack[0] === "{" && continuesRootObject(index)) continue;
      // A mismatched closer can only become valid by closing the inner
      // containers first; no content is invented or removed here.
      while (stack.length && stack.at(-1) !== expected) closeTop();
      if (stack.at(-1) === expected) {
        stack.pop();
        output.push(char);
        if (!stack.length) return finish(index);
      }
      continue;
    }

    output.push(char);
  }

  // Only close containers at EOF when the response ended on a structural
  // closer. Never guess the remainder of a truncated string or property value.
  if (inString || !/[}\]]\s*$/.test(text)) return "";
  while (stack.length) closeTop();
  return output.join("");
}

function parseLocallyRepaired(value) {
  const repaired = repairStructure(value);
  if (!repaired || repaired === cleanInput(value)) return null;
  try {
    const parsed = parseLoose(repaired);
    return { ...parsed, locallyRepaired: true };
  } catch {
    return null;
  }
}

function safeName(value) {
  return String(value ?? "ai-json")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ai-json";
}

function writeDebug(userDataPath, label, payload) {
  try {
    const directory = path.join(userDataPath, "ai-debug");
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(directory, `${stamp}-${safeName(label)}.json`);
    fs.writeFileSync(file, `${JSON.stringify({ createdAt: new Date().toISOString(), label, ...payload }, null, 2)}\n`, "utf8");
    return file;
  } catch {
    return "";
  }
}

async function parseWithRepair(userDataPath, content, options = {}) {
  try {
    const parsed = parseLoose(content);
    return { ...parsed, repaired: false, debugFile: "" };
  } catch (firstError) {
    const locallyRepaired = parseLocallyRepaired(content);
    if (locallyRepaired) {
      const debugFile = writeDebug(userDataPath, options.label || "ai-json-local-repair", {
        outcome: "repaired-locally",
        rawResponse: cleanInput(content),
        normalizedResponse: locallyRepaired.normalized,
      });
      return { ...locallyRepaired, repaired: true, debugFile };
    }
    if (typeof options.repair !== "function") throw firstError;

    let repairContent = "";
    let repairError = null;
    try {
      repairContent = await options.repair(cleanInput(content));
      let repaired;
      try {
        repaired = parseLoose(repairContent);
      } catch (error) {
        repaired = parseLocallyRepaired(repairContent);
        if (!repaired) throw error;
      }
      const debugFile = writeDebug(userDataPath, options.label || "ai-json-repair", {
        outcome: repaired.locallyRepaired ? "repaired-locally-after-ai" : "repaired",
        rawResponse: cleanInput(content),
        repairResponse: cleanInput(repairContent),
        normalizedResponse: repaired.normalized,
      });
      return { ...repaired, repaired: true, debugFile };
    } catch (error) {
      if (error?.code === "AI_REQUEST_CANCELED") throw error;
      repairError = error;
    }

    const debugFile = writeDebug(userDataPath, options.label || "ai-json-repair", {
      outcome: "failed",
      rawResponse: cleanInput(content),
      repairResponse: cleanInput(repairContent),
      firstError: firstError instanceof Error ? firstError.message : String(firstError),
      repairError: repairError instanceof Error ? repairError.message : String(repairError ?? ""),
    });
    const suffix = debugFile ? ` Debug kaydı: ${debugFile}` : "";
    const error = new Error(`AI yanıtı JSON olarak çözümlenemedi; otomatik onarım da başarısız oldu.${suffix}`);
    error.code = "AI_JSON_REPAIR_FAILED";
    throw error;
  }
}

module.exports = {
  repairStructure,
  stripCodeFences,
  parseLoose,
  parseWithRepair,
  writeDebug,
};
