const store = require("./transcript-store.cjs");
const youtube = require("./transcript-youtube.cjs");

module.exports = {
  ensureSchema: store.ensureSchema,
  getTranscript: store.getTranscript,
  getSourceTranscript: store.getSourceTranscript,
  saveTranscript: store.saveTranscript,
  saveSourceTranscript: store.saveSourceTranscript,
  deleteTranscript: store.deleteTranscript,
  ytDlpStatus: youtube.ytDlpStatus,
  fetchYoutubeTranscript: youtube.fetchYoutubeTranscript,
  vttToPlainText: youtube.vttToPlainText,
  transcriptStats: store.transcriptStats,
  subtitleAttemptArgs: youtube.subtitleAttemptArgs,
  chooseSubtitleFile: youtube.chooseSubtitleFile,
  subtitleFailureMessage: youtube.subtitleFailureMessage,
};
