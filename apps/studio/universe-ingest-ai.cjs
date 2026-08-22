const base = require("./universe-merge-ai.cjs");
const { collectVideoIds, normalizeUniverse } = require("./universe-normalizer.cjs");

const NO_STORY_PREFIX = "[CHANNEL_FOUNDRY_TEMPORARY_SCOPE]";

function hasStoryMaterial(video) {
  return (Array.isArray(video?.storyHints) && video.storyHints.length > 0)
    || (Array.isArray(video?.storyBeats) && video.storyBeats.length > 0);
}

function storyEligibleIds(input) {
  const ids = new Set();
  for (const video of Array.isArray(input?.videos) ? input.videos : []) {
    if (hasStoryMaterial(video) && video?.videoId) ids.add(String(video.videoId));
  }
  for (const partial of Array.isArray(input?.partials) ? input.partials : []) collectVideoIds(partial?.stories, ids);
  if (input?.universe && typeof input.universe === "object") collectVideoIds(input.universe.stories, ids);
  return ids;
}

function stripEditorialContext(video) {
  if (!video || typeof video !== "object") return video;
  const { context: _context, ...rest } = video;
  return rest;
}

function prepareInput(input) {
  if (!Array.isArray(input?.videos)) return input;
  return {
    ...input,
    videos: input.videos.map((source) => {
      const video = stripEditorialContext(source);
      return hasStoryMaterial(video) ? video : {
        ...video,
        storyHints: [`${NO_STORY_PREFIX} ${String(video?.videoId || "kaynak")}: Bu geçici işaret yalnız kaynak kapsam kontrolü içindir; nihai hikâye kaydı değildir.`],
      };
    }),
  };
}

function pruneDetailSources(values, allowed) {
  return (Array.isArray(values) ? values : []).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const sourceVideoIds = (Array.isArray(entry.sourceVideoIds) ? entry.sourceVideoIds : []).map(String).filter((id) => allowed.has(id));
    return sourceVideoIds.length ? { ...entry, sourceVideoIds } : null;
  }).filter(Boolean);
}

function pruneStories(universe, originalInput) {
  const eligible = storyEligibleIds(originalInput);
  const stories = (Array.isArray(universe?.stories) ? universe.stories : []).map((story) => {
    const sourceVideoIds = (Array.isArray(story?.sourceVideoIds) ? story.sourceVideoIds : []).map(String).filter((id) => eligible.has(id));
    if (!sourceVideoIds.length) return null;
    return {
      ...story,
      sourceVideoIds,
      sequence: pruneDetailSources(story.sequence, eligible),
    };
  }).filter(Boolean);
  return { ...universe, stories };
}

async function mergePayload(userDataPath, input, level, options = {}) {
  const prepared = prepareInput(input);
  const merged = await base.mergePayload(userDataPath, prepared, level, options);
  const allowed = collectVideoIds(input);
  const pruned = pruneStories(merged.universe, input);
  pruned.relations = base._test.deriveRelations(input, pruned, allowed);
  const universe = normalizeUniverse(pruned, allowed);
  const covered = collectVideoIds(universe);
  const missing = [...allowed].filter((id) => !covered.has(id));
  if (missing.length) {
    const error = new Error(`Evrene İşleme ${missing.length}/${allowed.size} seçilmiş kaynak videoyu sonuçta kaybetti: ${missing.slice(0, 5).join(", ")}`);
    error.code = "UNIVERSE_COVERAGE_MISSING";
    throw error;
  }
  return { ...merged, universe };
}

module.exports = {
  mergePayload,
  privateConfig: base.privateConfig,
  _test: { hasStoryMaterial, prepareInput, pruneStories, storyEligibleIds, stripEditorialContext },
};
