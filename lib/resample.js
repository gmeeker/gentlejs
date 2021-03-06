const { spawn } = require('child_process');
const fs = require('fs-extra');
const { getBinary, tmpName } = require('./util');
const { wavHeader } = require('./wav');

const resample = async (infile, outfile, offsetIn, durationIn) => {
  await fs.stat(infile).then(stat => stat.isFile())
    .catch(() => false)
    .then(isfile => {
      if (!isfile) {
        throw new Error(`Not a file: ${infile}`);
      }
    });
  const FFMPEG = await getBinary('ffmpeg');

  // Use FFMPEG to convert a media file to a wav file sampled at 8K
  let offset;
  let duration;
  if (offsetIn === undefined) {
    offset = [];
  } else {
    offset = ['-ss', offsetIn.toString()];
  }
  if (durationIn === undefined) {
    duration = [];
  } else {
    duration = ['-t', durationIn.toString()];
  }

  const args = [
    '-loglevel', 'panic',
    '-y',
  ].concat(offset, [
    '-i', infile,
  ], duration, [
    '-ac', '1', '-ar', '8000',
    '-acodec', 'pcm_s16le',
    outfile
  ]);
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    proc.on('close', code => {
      if (code === 0) {
        resolve(outfile);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
};

const resampled = async (infile, offset, duration) => {
  if (infile.toLowerCase().endsWith('.wav')) {
    try {
      const header = await wavHeader(infile);
      if (header.channels === 1 && header.sampleRate === 8000) {
        return infile;
      }
    } catch (e) {
      // try running FFMPEG
    }
  }
  const dstFilename = (await tmpName()) + '.wav';
  return resample(infile, dstFilename, offset, duration);
};

module.exports = {
  resample,
  resampled,
};
