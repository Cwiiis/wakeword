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

        this.listen(words, onwake);
      });

      return;
    }

    if (!this.decoder) {
      this.stop();
    }

    this.decoder = new PocketSphinx.Decoder(this.sphinxConfig);
    for (var word of words) {
      this.decoder.setKeyphrase('wakeword', word);
    }
    this.decoder.setSearch('wakeword');
    this.decoder.startUtt();

    if (this.mic) {
      this.mic.stop();
    } else {
      this.mic = Mic(
        { rate: '16000',
          channels: '1',
          encoding: 'signed-integer',
          device: 'default' });
      this.mic.getAudioStream().on('error', e => {
        console.error('Error streaming from microphone', e);
      });
    }

    var buffer = Concat(decode);
    var stream = this.mic.getAudioStream();

    var decode = data => {
      if (!this.detected) {
        this.decoder.processRaw(data, false, false);
        var hyp = this.decoder.hyp();
        if (hyp && hyp.hypstr) {
          console.log('Wake word detected: ' + hyp.hypstr);
          this.detected = this.decoder.getRawdata();
        } else if (Date.now() - startTime > listenTime) {
          this.decoder.endUtt();
          this.decoder.startUtt();
        }
        return;
      }

      onwake(data, this.detected);
    };

    var startTime, speechSampleTime;
    startTime = speechSampleTime = Date.now();

    stream.removeAllListeners('data');
    stream.on('data', data => {
      buffer.write(data);

      if (Date.now() - speechSampleTime > 300) {
        buffer.end();
        buffer = Concat(decode);
      }
    });

    this.mic.start();
  },

  stop: function() {
    this.mic.stop();
    this.decoder.endUtt();
    this.decoder = null;
  }
};
