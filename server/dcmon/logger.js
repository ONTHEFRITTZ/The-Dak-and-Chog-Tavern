const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const { CONFIG } = require('./config');

let encryptionKey = null;
if (CONFIG.encryptionKeyHex) {
  const hex = CONFIG.encryptionKeyHex.startsWith('0x') ? CONFIG.encryptionKeyHex.slice(2) : CONFIG.encryptionKeyHex;
  encryptionKey = crypto.createHash('sha256').update(hex, 'hex').digest();
}

const logger = pino({ level: CONFIG.logLevel });
const LOG_FILE = path.join(CONFIG.logDir, 'operations.log');

function encrypt(payloadBuffer) {
  if (!encryptionKey) {
    return { plaintext: payloadBuffer.toString('utf8') };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function persistLog(eventType, payload) {
  const entry = {
    timestamp: new Date().toISOString(),
    eventType,
    ...encrypt(Buffer.from(JSON.stringify(payload, null, 2))),
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

module.exports = {
  logger,
  persistLog,
};
