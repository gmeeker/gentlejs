const fs = require('fs-extra');
const os = require('os');
const logging = require('loglevel');
const process = require('process');
const { ArgumentParser } = require('argparse');
const gentle = require('.');

const parser = new ArgumentParser({
  version: gentle.version,
  addHelp: true,
  description: 'Align a transcript to audio by generating a new language model.  Outputs JSON',
});

parser.addArgument(
  '--nthreads',
  {
    defaultValue: os.cpus().length,
    type: 'int',
    help: 'number of alignment threads',
  });
parser.addArgument(
  ['-o', '--output'],
  {
    metavar: 'output',
    type: 'string',
    help: 'output filename',
  });
parser.addArgument(
  '--conservative',
  {
    dest: 'conservative',
    action: 'storeTrue',
    help: 'conservative alignment',
  });
parser.setDefaults({ conservative: false });
parser.addArgument(
  '--disfluency',
  {
    dest: 'disfluency',
    action: 'storeTrue',
    help: 'include disfluencies (uh, um) in alignment',
  });
parser.setDefaults({ disfluency: false });
parser.addArgument(
  '--log',
  {
    defaultValue: 'INFO',
    help: 'the log level (DEBUG, INFO, WARNING, ERROR, or CRITICAL)',
  });
parser.addArgument(
  'audiofile',
  {
    type: 'string',
    help: 'audio file',
  });
parser.addArgument(
  'txtfile',
  {
    type: 'string',
    help: 'transcript text file',
  });
const args = parser.parseArgs();

logging.setLevel(args.log);

const disfluencies = ['uh', 'um'];

const onProgress = p => {
  Object.keys(p).forEach(k => {
    const v = p[k];
    logging.debug(`${k}: ${v}`);
  });
};

fs.readFile(args.txtfile)
  .then(transcript => transcript.toString())
  .then(async transcript => {
    const resources = new gentle.Resources();
    await resources.init();

    logging.info('converting audio to 8K sampled wav');

    const wavfile = await gentle.resampled(args.audiofile);
    const aligner = new gentle.ForcedAligner({
      resources,
      transcript,
      nthreads: args.nthreads,
      disfluency: args.disfluency,
      conservative: args.conservative,
      disfluencies,
    });
    const result = await aligner.transcribe(wavfile, { progress: onProgress, logging });

    let fh = process.stdout;
    if (args.output) {
      fh = fs.createWriteStream(args.output);
    }
    fh.write(result.toJSON({ space: 2 }));
    if (args.output) {
      logging.info(`output written to ${args.output}`);
    }
  });
