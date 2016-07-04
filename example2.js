const Wakeword = require('./index');

Wakeword.logFile = '/dev/null';

function listen() {
  console.log('Say \'quick\', \'brown\', \'fox\' or \'stop\'');

  Wakeword.listen(['quick', 'brown', 'fox', 'stop'], 0.87, (data, word) => {
    console.log('Detected \'' + word + '\'');
    if (word !== 'stop') {
      Wakeword.resume();
    } else {
      Wakeword.stop();
    }
  });
}

listen();
