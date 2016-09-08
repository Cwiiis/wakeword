# Wakeword

Wakeword is a utility library to facilitate responding to particular set words or phrases spoken into a microphone. This is achieved using the Pocketsphinx library, an open source speech recognition library suitable for use on embedded devices.

## Example

```
const Wakeword = require('wakeword');

// Disable log output
Wakeword.logFile = '/dev/null';

function listen() {
  Wakeword.listen(['hello', 'goodbye'], 0.87, (data, word) => {
    console.log(word);

    if (word !== 'goodbye') {
      Wakeword.resume();
    } else {
      Wakeword.stop();
    }
  });
}

listen();
```
