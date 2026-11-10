// CRC-16/CCITT-FALSE for compact per-frame QR packet integrity verification.

export function crc16(data: Uint8Array, length = data.length): number {
  let crc = 0xffff;
  for (let i = 0; i < length; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}
