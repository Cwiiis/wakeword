const Concat = require('concat-stream');
const ChildProcess = require('child_process');
const Fs = require('fs');
const Mic = require('mic');
const Path = require('path');
const PocketSphinx = require('pocketsphinx').ps;
const Temp = require('temp').track();
const Which = require('which');

const stateEnum = {
  STOPPED: 0,
  LOADING: 1,
  LISTENING: 2
};

module.exports = {

  state: stateEnum.STOPPED,
  sphinxConfig: null,
  decoder: null,
  detected: null,
  pendingState: null,

  listen: function(words, listenTime, onwake, ignoreState) {
    if (!ignoreState) {
      switch (this.state) {
        case stateEnum.LOADING:
          this.pendingState = {
            state: stateEnum.LISTENING,
            words: words,
            listenTime: listenTime,
            onwake: onwake };
          return;

        case stateEnum.LISTENING:
          this.stop();
          break;
      }
    }

    this.state = stateEnum.LOADING;

    Temp.cleanup((e, stats) => {
      if (e) {
        console.error('Error cleaning temporary files', e);
      }
    });

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
        config.setString('-logfn', '/dev/null');

        this.listen(words, listenTime, onwake, true);
      });

      return;
    }

    // pocketsphinx doesn't allow for multiple keywords or configurable
    // threshold via any public API except for the keyword file.
    Temp.open('kws', (e, info) => {
      if (e) {
        console.error('Error opening keyword file', e);
        this.state = stateEnum.STOPPED;
        return;
      }

      for (var word of words) {
        Fs.write(info.fd, `${word} /1e-20/`);
      }

      Fs.close(info.fd, e => {
        if (e) {
          console.error('Error closing keyword file', e);
          this.state = stateEnum.STOPPED;
          return;
        }

        if (this.pendingState) {
          var pendingState = this.pendingState;
          this.pendingState = null;

          switch (pendingState.state) {
            case stateEnum.LISTENING:
              this.state = stateEnum.STOPPED;
              this.listen(pendingState.words, pendingState.listenTime,
                          pendingState.onwake);
              return;

            case stateEnum.STOPPED:
              this.state = stateEnum.STOPPED;
              return;

            default:
              console.error('Stopping, invalid pending state',
                            pendingState.state);
              this.state = stateEnum.STOPPED;
              return;
          }
        }

        this.state = stateEnum.LISTENING;
        this.decoder = new PocketSphinx.Decoder(this.sphinxConfig);
        this.decoder.setKws('wakeword', info.path);
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
      });
    });
  },

  stop: function() {
    switch (this.state) {
      case stateEnum.STOPPED:
        return;

      case stateEnum.LOADING:
        this.pendingState = { state: stateEnum.STOPPED };
        return;
    }

    this.mic.getAudioStream().removeAllListeners();
    this.mic.stop();
    this.mic = null;  // XXX Doesn't seem like mic is reusable after stopping

    this.decoder.endUtt();
    this.decoder = null;

    this.detected = null;
    this.state = stateEnum.STOPPED;
  }
};
