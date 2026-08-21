const text = { type: "string" };
const nullableText = { anyOf: [text, { type: "null" }] };

function array(items) {
  return { type: "array", items };
}

function object(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const textArray = array(text);
const visual = object({
  description: text,
  attributes: textArray,
  atmosphere: text,
  prompt: text,
  negativePrompt: text,
});

const namedVisual = object({
  name: text,
  details: textArray,
  visual,
});

const ANALYSIS_OUTPUT_SCHEMA = object({
  title: text,
  summary: text,
  topics: textArray,
  storyBeats: textArray,
  storyHints: textArray,
  coverVisual: visual,
  characters: array(object({
    name: text,
    aliases: textArray,
    role: text,
    details: textArray,
    visual,
  })),
  locations: array(namedVisual),
  objects: array(namedVisual),
  scenes: array(object({
    name: text,
    description: text,
    visual,
  })),
  sponsors: textArray,
  contributors: textArray,
});

const SUGGESTION_OUTPUT_SCHEMA = object({
  title: text,
  summary: text,
  relations: array(object({ key: text, label: text, reason: text })),
});

const sourcedDetail = object({ text, sourceVideoIds: textArray });
const universeSchemas = {
  stories: object({
    name: text,
    aliases: textArray,
    summary: text,
    sourceVideoIds: textArray,
    sequence: array(sourcedDetail),
    characterNames: textArray,
    locationNames: textArray,
    objectNames: textArray,
    visual,
  }),
  characters: object({
    name: text,
    aliases: textArray,
    summary: text,
    roles: textArray,
    details: array(sourcedDetail),
    storyNames: textArray,
    sourceVideoIds: textArray,
    visual,
  }),
  events: object({
    name: text,
    summary: text,
    sourceVideoIds: textArray,
    storyNames: textArray,
    characterNames: textArray,
    locationNames: textArray,
    visual,
  }),
  locations: object({
    name: text,
    aliases: textArray,
    summary: text,
    details: array(sourcedDetail),
    storyNames: textArray,
    sourceVideoIds: textArray,
    visual,
  }),
  objects: object({
    name: text,
    aliases: textArray,
    summary: text,
    details: array(sourcedDetail),
    storyNames: textArray,
    sourceVideoIds: textArray,
    visual,
  }),
};

const narrativeSpan = {
  anyOf: [
    object({ type: { type: "string", enum: ["text", "emphasis"] }, text }),
    object({ type: { type: "string", enum: ["reference"] }, entityId: text, label: text }),
  ],
};

const narrativeMedia = {
  type: "object",
  properties: {
    assetId: text,
    role: { type: "string", enum: ["scene", "portrait", "location", "artifact", "supporting"] },
    entityId: nullableText,
    alt: text,
    caption: text,
  },
  required: ["assetId", "role", "entityId", "alt", "caption"],
  additionalProperties: false,
};

const narrativeBlock = {
  anyOf: [
    object({ type: { type: "string", enum: ["paragraph"] }, spans: array(narrativeSpan) }),
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["figure"] },
        assetId: text,
        role: { type: "string", enum: ["scene", "portrait", "location", "artifact", "supporting"] },
        entityId: nullableText,
        alt: text,
        caption: text,
      },
      required: ["type", "assetId", "role", "entityId", "alt", "caption"],
      additionalProperties: false,
    },
  ],
};

const narrativeSection = {
  type: "object",
  properties: {
    sectionId: nullableText,
    order: { type: "integer", minimum: 0 },
    title: text,
    sourceKeys: textArray,
    blocks: array(narrativeBlock),
    media: array(narrativeMedia),
    retire: { type: "boolean" },
  },
  required: ["sectionId", "order", "title", "sourceKeys", "blocks", "media", "retire"],
  additionalProperties: false,
};

const NARRATIVE_OUTPUT_SCHEMA = object({
  contractVersion: { type: "integer", enum: [1] },
  sections: array(narrativeSection),
});

function universeKindOutputSchema(key) {
  const item = universeSchemas[key];
  if (!item) throw new Error(`Bilinmeyen evren çıktı şeması: ${String(key)}`);
  return object({ items: array(item) });
}

module.exports = {
  ANALYSIS_OUTPUT_SCHEMA,
  NARRATIVE_OUTPUT_SCHEMA,
  SUGGESTION_OUTPUT_SCHEMA,
  universeKindOutputSchema,
};
