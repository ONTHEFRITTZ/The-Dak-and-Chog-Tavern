// poker-rt.js — DEPRECATED SHIM
// Back-compat only. Starts the unified realtime server.
// Do NOT run this alongside realtime.js or you'll get a port conflict.

if (!process.env.PORT) process.env.PORT = '3100';            // align with Nginx upstream
if (!process.env.GAME_TYPES) process.env.GAME_TYPES = 'POKER'; // legacy behavior: poker-only

console.warn('[poker-rt.js] Deprecated. Use realtime.js everywhere.');
console.warn(`[poker-rt.js] Booting unified server on PORT=${process.env.PORT}, GAME_TYPES=${process.env.GAME_TYPES}`);

require('./realtime.js');
