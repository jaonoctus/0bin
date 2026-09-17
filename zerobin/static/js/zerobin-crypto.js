/*global noble:true */

/*
  Encryption primitives for 0bin, built on @noble/ciphers and @noble/hashes
  (see noble.js and vendor_noble.sh). This file has no DOM dependency so it
  can be exercised outside a browser. encrypt() and decrypt() return Promises.

  Paste payload format, version 2:

    {"v":2,"cipher":"xchacha20poly1305","nonce":"<base64url>","ct":"<base64url>"}

  The key carried in the URL hash is 32 random bytes encoded as unpadded
  base64url. Without a password it is the encryption key. With an optional
  password, the encryption key is derived with Argon2id from the password,
  using the URL key as salt, and the payload records the parameters
  (m is memory in KiB, t the number of passes, p the parallelism):

    {"v":2,"cipher":"xchacha20poly1305","kdf":{"name":"argon2id","m":19456,"t":2,"p":1},"nonce":...,"ct":...}

  So the link alone is not enough to read such a paste, and the password
  never leaves the browser. Each paste gets a fresh key and a fresh nonce.

  Pastes created by the previous SJCL based versions start with {"iv": and
  cannot be decrypted anymore; see isLegacyPayload().
*/

window.zerobinCrypto = (function () {
  'use strict';

  var FORMAT_VERSION = 2;
  var CIPHER_NAME = 'xchacha20poly1305';
  var KEY_BYTES = 32;
  var NONCE_BYTES = 24;

  // Argon2id cost for new password protected pastes: the OWASP baseline of
  // 19 MiB of memory and 2 passes, well under a second in a browser. When
  // reading, parameters from the payload are accepted up to ARGON2_MAX so a
  // crafted paste cannot exhaust memory.
  var ARGON2 = { name: 'argon2id', m: 19456, t: 2, p: 1 };
  var ARGON2_MAX = { m: 262144, t: 10, p: 4 };

  function bytesToBase64Url(bytes) {
    var binary = '';
    var chunk = 0x8000; // keep String.fromCharCode.apply under argument limits
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(text) {
    var binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function keyToBytes(key) {
    var bytes = base64UrlToBytes(key);
    if (bytes.length !== KEY_BYTES) {
      throw new Error('Invalid key length');
    }
    return bytes;
  }

  function parsePayload(payload) {
    var data = JSON.parse(payload);
    if (data.v !== FORMAT_VERSION || data.cipher !== CIPHER_NAME) {
      throw new Error('Unsupported paste format');
    }
    return data;
  }

  function isInt(n, min, max) {
    return typeof n === 'number' && Math.floor(n) === n && n >= min && n <= max;
  }

  function checkKdf(kdf) {
    if (!kdf || kdf.name !== ARGON2.name ||
        !isInt(kdf.m, 8 * (kdf.p || 1), ARGON2_MAX.m) ||
        !isInt(kdf.t, 1, ARGON2_MAX.t) ||
        !isInt(kdf.p, 1, ARGON2_MAX.p)) {
      throw new Error('Unsupported key derivation parameters');
    }
    return kdf;
  }

  function deriveKey(urlKeyBytes, password, kdf) {
    return noble.argon2idAsync(password, urlKeyBytes, {
      m: kdf.m, t: kdf.t, p: kdf.p, dkLen: KEY_BYTES
    });
  }

  return {
    /** Create a new random 256-bit key, encoded to fit in a URL hash. */
    makeKey: function () {
      return bytesToBase64Url(noble.randomBytes(KEY_BYTES));
    },

    /** Encrypt a string. With a non empty password, readers will need it in
        addition to the URL key. Resolves to the JSON payload sent to the
        server. */
    encrypt: function (key, text, password) {
      return Promise.resolve().then(function () {
        var urlKeyBytes = keyToBytes(key);
        if (!password) {
          return { keyBytes: urlKeyBytes, kdf: null };
        }
        var kdf = { name: ARGON2.name, m: ARGON2.m, t: ARGON2.t, p: ARGON2.p };
        return deriveKey(urlKeyBytes, password, kdf).then(function (keyBytes) {
          return { keyBytes: keyBytes, kdf: kdf };
        });
      }).then(function (derived) {
        var nonce = noble.randomBytes(NONCE_BYTES);
        var cipher = noble.xchacha20poly1305(derived.keyBytes, nonce);
        var ciphertext = cipher.encrypt(noble.utf8ToBytes(text));
        var data = { v: FORMAT_VERSION, cipher: CIPHER_NAME };
        if (derived.kdf) {
          data.kdf = derived.kdf;
        }
        data.nonce = bytesToBase64Url(nonce);
        data.ct = bytesToBase64Url(ciphertext);
        return JSON.stringify(data);
      });
    },

    /** Decrypt a payload produced by encrypt(). Rejects with an error flagged
        `passwordRequired` when the paste needs a password and none was given,
        `wrongPassword` when a password was given but decryption failed, and
        a plain error for a wrong key, a tampered payload or an unknown
        format. */
    decrypt: function (key, payload, password) {
      var data;
      return Promise.resolve().then(function () {
        data = parsePayload(payload);
        var urlKeyBytes = keyToBytes(key);
        if (!data.kdf) {
          return urlKeyBytes;
        }
        if (!password) {
          var required = new Error('Password required');
          required.passwordRequired = true;
          throw required;
        }
        return deriveKey(urlKeyBytes, password, checkKdf(data.kdf));
      }).then(function (keyBytes) {
        try {
          var cipher = noble.xchacha20poly1305(keyBytes, base64UrlToBytes(data.nonce));
          return noble.bytesToUtf8(cipher.decrypt(base64UrlToBytes(data.ct)));
        } catch (err) {
          if (data.kdf) {
            err.wrongPassword = true;
          }
          throw err;
        }
      });
    },

    /** True when the payload was encrypted with a password. */
    needsPassword: function (payload) {
      try {
        return Boolean(parsePayload(payload).kdf);
      } catch (err) {
        return false;
      }
    },

    /** True for payloads written by the SJCL based versions of 0bin. */
    isLegacyPayload: function (payload) {
      return payload.indexOf('{"iv":') === 0;
    }
  };
})();
