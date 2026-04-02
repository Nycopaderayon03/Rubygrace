(function () {
  if (typeof window === 'undefined') return;

  var cryptoObj = window.crypto;
  if (!cryptoObj) {
    cryptoObj = {};
    try {
      Object.defineProperty(window, 'crypto', {
        value: cryptoObj,
        configurable: true,
        writable: true,
      });
    } catch (e) {
      window.crypto = cryptoObj;
    }
  }

  if (typeof cryptoObj.randomUUID === 'function') return;

  var hex = [];
  for (var i = 0; i < 256; i += 1) {
    hex[i] = (i + 256).toString(16).slice(1);
  }

  var fallbackRandomUUID = function () {
    var bytes = new Uint8Array(16);
    if (typeof cryptoObj.getRandomValues === 'function') {
      cryptoObj.getRandomValues(bytes);
    } else {
      for (var j = 0; j < 16; j += 1) {
        bytes[j] = Math.floor(Math.random() * 256);
      }
    }

    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;

    return (
      hex[bytes[0]] + hex[bytes[1]] + hex[bytes[2]] + hex[bytes[3]] +
      '-' +
      hex[bytes[4]] + hex[bytes[5]] +
      '-' +
      hex[bytes[6]] + hex[bytes[7]] +
      '-' +
      hex[bytes[8]] + hex[bytes[9]] +
      '-' +
      hex[bytes[10]] + hex[bytes[11]] + hex[bytes[12]] + hex[bytes[13]] + hex[bytes[14]] + hex[bytes[15]]
    );
  };

  try {
    Object.defineProperty(cryptoObj, 'randomUUID', {
      value: fallbackRandomUUID,
      configurable: true,
      writable: true,
    });
  } catch (e) {
    cryptoObj.randomUUID = fallbackRandomUUID;
  }
})();
