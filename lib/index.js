const { version } = require('../package.json');
const Resources = require('./resources');
const ForcedAligner = require('./forced_aligner');
const FullTranscriber = require('./full_transcriber');
const { resample, resampled } = require('./resample');
const Transcription = require('./transcription');

module.exports = {
  version,
  Resources,
  ForcedAligner,
  FullTranscriber,
  resample,
  resampled,
  Transcription,
};
