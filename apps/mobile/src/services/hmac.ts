import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { HmacHex } from '@amara/shared';

/**
 * HMAC-SHA256 en hexadecimal para el enlace con la PC (lan-auth).
 * Clave y mensaje se codifican en UTF-8, igual que createHmac('sha256', key).update(msg) de Node en la PC.
 */
export const hmacHex: HmacHex = (key, message) => bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(message)));
