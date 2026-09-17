/*global nobleCiphers:true */

/*
  Encryption primitives for 0bin, built on @noble/ciphers (see noble-ciphers.js
  and vendor_noble_ciphers.sh). This file has no DOM dependency so it can be
  exercised outside a browser.

  Paste payload format, version 2:

    {"v":2,"cipher":"xchacha20poly1305","nonce":"<base64url>","ct":"<base64url>"}

  The key carried in the URL hash is 32 random bytes encoded as unpadded
  base64url. Each paste gets a fresh key and a fresh 24-byte nonce.

  Pastes created by the previous SJCL based versions start with {"iv": and
  cannot be decrypted anymore; see isLegacyPayload().
*/

window.zerobinCrypto = (function () {
  'use strict';

  var FORMAT_VERSION = 2;
  var CIPHER_NAME = 'xchacha20poly1305';
  var KEY_BYTES = 32;
  var NONCE_BYTES = 24;

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

  return {
    /** Create a new random 256-bit key, encoded to fit in a URL hash. */
    makeKey: function () {
      return bytesToBase64Url(nobleCiphers.randomBytes(KEY_BYTES));
    },

    /** Encrypt a string. Returns the JSON payload sent to the server. */
    encrypt: function (key, text) {
      var nonce = nobleCiphers.randomBytes(NONCE_BYTES);
      var cipher = nobleCiphers.xchacha20poly1305(keyToBytes(key), nonce);
      var ciphertext = cipher.encrypt(nobleCiphers.utf8ToBytes(text));
      return JSON.stringify({
        v: FORMAT_VERSION,
        cipher: CIPHER_NAME,
        nonce: bytesToBase64Url(nonce),
        ct: bytesToBase64Url(ciphertext)
      });
    },

    /** Decrypt a payload produced by encrypt(). Throws on a wrong key, a
        tampered payload or an unknown format. */
    decrypt: function (key, payload) {
      var data = JSON.parse(payload);
      if (data.v !== FORMAT_VERSION || data.cipher !== CIPHER_NAME) {
        throw new Error('Unsupported paste format');
      }
      var cipher = nobleCiphers.xchacha20poly1305(
        keyToBytes(key), base64UrlToBytes(data.nonce));
      return nobleCiphers.bytesToUtf8(cipher.decrypt(base64UrlToBytes(data.ct)));
    },

    /** True for payloads written by the SJCL based versions of 0bin. */
    isLegacyPayload: function (payload) {
      return payload.indexOf('{"iv":') === 0;
    }
  };
})();
