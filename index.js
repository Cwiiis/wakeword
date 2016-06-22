const Concat = require('concat-stream');
const ChildProcess = require('child_process');
const Fs = require('fs');
const Mic = require('mic');
const Path = require('path');
const PocketSphinx = require('pocketsphinx').ps;
const Which = require('which');

module.exports = {

  sphinxConfig: null,
  decoder: null,
  detected: null,

  listen: function(words, listenTime, onwake) {
    if (!this.sphinxConfig) {
      Which('pocketsphinx_continuous', (e, path) => {
        if (e) {
          console.error('Error searching for pocketsphinx', e);
          return;
        }

        path = Path.join(Path.dirname(path), '..', 'share',
                         'pocketsphinx', 'model', 'en-us');
        if (!Fs.statSync(path).isDirectory()) {
          console.error('Pocketsphinx en-us model not found at ' + path);
          return;
        }

        var config = this.sphinxConfig = PocketSphinx.Decoder.defaultConfig();
        config.setString("-hmm", Path.join(path, 'en-us'));
        config.setString("-dict", Path.join(path, 'cmudict-en-us.dict'));
        config.setString("-lm", Path.join(path, 'en-us.lm.bin'));
        config.setString('-logfn', '/dev/null');

        this.listen(words, listenTime, onwake);
      });

      return;
    }

    if (this.decoder) {
      this.stop();
    }

    this.decoder = new PocketSphinx.Decoder(this.sphinxConfig);
    for (var word of words) {
      this.decoder.setKeyphrase('wakeword', word);
    }
    this.decoder.setSearch('wakeword');
    this.decoder.startUtt();

    if (!this.mic) {
      this.mic = Mic(
        { rate: '16000',
          channels: '1',
          encoding: 'signed-integer',
          device: 'default' });
      this.mic.getAudioStream().on('error', e => {
        console.error('Error streaming from microphone', e);
      });
    }

    var startTime = Date.now();
    var setWakewordUtt = data => {
      if (this.detected) {
        this.detected.data = data;
      };
    }
    var wakeBuffer = Concat(setWakewordUtt);
    var decode = data => {
      if (!this.detected) {
        wakeBuffer.write(data);
        this.decoder.processRaw(data, false, false);

        var now = Date.now();
        var hyp = this.decoder.hyp();
        if (hyp && hyp.hypstr) {
          this.detected = {
            word: hyp.hypstr,
          };
          wakeBuffer.end();
        } else if (now - startTime > listenTime) {
          this.decoder.endUtt();
          this.decoder.startUtt();
          wakeBuffer.end();
          wakeBuffer = Concat(setWakewordUtt);
          startTime = now;
        }
        return;
      }

      onwake(data, this.detected.word, this.detected.data);
    };

    var buffer = Concat(decode);
    var speechSampleTime = startTime;

    var stream = this.mic.getAudioStream();
    stream.on('data', data => {
      buffer.write(data);

      var now = Date.now();
      if (now - speechSampleTime > 300) {
        buffer.end();
        buffer = Concat(decode);
        speechSampleTime = now;
      }
    });

    this.mic.start();
  },

  stop: function() {
    this.mic.getAudioStream().removeAllListeners();
    this.mic.stop();
    this.mic = null;  // XXX Doesn't seem like mic is reusable after stopping

    this.decoder.endUtt();
    this.decoder = null;

    this.detected = null;
  }
};
