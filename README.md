Port of Gentle forced aligner to JavaScript:
https://lowerquality.com/gentle/

The C++ binaries and support files from this repo are required.

In the original python version of Gentle, you can use the REST API:

```
curl -F "audio=@audio.mp3" -F "transcript=@words.txt" "http://localhost:8765/transcriptions?async=false"
```

or call the aligner directly:

```
python3 align.py audio.mp3 words.txt
```

The included examples are `examples/data/lucier.mp3` and `examples/data/lucier.txt`.

To call GentleJS from the command line:
```
GENTLE_RESOURCES_ROOT=/path/to/original/gentle node ./lib/align.js audio.mp3 words.txt
```

To import and call GentleJS:
```
const gentle = require('gentlejs');
const os = require('os');

const aligner = async (audiofile, textfile, options = {}) => {
  const nthreads = options.nthreads || os.cpus().length;
  // conservative alignment
  const conservative = options.conservative !== undefined ? options.conservative : false;
  // include disfluencies (uh, um) in alignment
  const disfluency = options.disfluency !== undefined ? options.disfluency : false;
  const disfluencies = options.disfluencies || ['uh', 'um'];
  const transcript = await fs.readFile(textfile).then(buf => buf.toString());
  const resources = new gentle.Resources({
    projectRoot: options.projectRoot || '/path/to/original/gentle'
  });
  await resources.init();

  const wavfile = await gentle.resampled(audiofile);
  const aligner = new gentle.ForcedAligner({
    resources,
    transcript,
    nthreads,
    disfluency,
    conservative,
    disfluencies,
  });
  const { logging, progress } = options;
  const result = await aligner.transcribe(wavfile, { logging, progress });
  return result.toJSON({ space: 2 });
}
```
