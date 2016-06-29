const Wakeword = require('./index');
const Fs = require('fs');

function listen() {
  var rawStream = null;
  var wakeTime = 0;
  Wakeword.listen(['record'], 0.87, (data, word) => {
    if (!rawStream) {
      console.log('Detected wake word, recording');
      wakeTime = Date.now();
      rawStream = Fs.createWriteStream('recording.raw', {
        defaultEncoding: 'binary'
      });
    }

    rawStream.write(data);

    if (Date.now() - wakeTime > 5000) {
      rawStream.end();
      console.log('Wrote ~5 seconds of audio to recording.raw');
      console.log(`Try playing with 'aplay -r 16000 -f S16_LE recording.raw'`);
      listen();
    }
  });
}

listen();
