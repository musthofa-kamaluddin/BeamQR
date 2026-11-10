import jsQR from 'jsqr';
import { decodeSingleQr, type JsQrDecoderFn } from '../protocol/qrOptical';

export interface DecodeWorkerRequest {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  attemptBoth: boolean;
}

export interface DecodeWorkerResponse {
  id: number;
  text: string | null;
}

const decodeQr: JsQrDecoderFn | undefined =
  typeof jsQR === 'function'
    ? jsQR
    : (jsQR as unknown as { default?: JsQrDecoderFn })?.default ??
      (globalThis as unknown as { jsQR?: JsQrDecoderFn }).jsQR;

self.onmessage = (event: MessageEvent<DecodeWorkerRequest>) => {
  const { id, width, height, buffer, attemptBoth } = event.data;
  if (!decodeQr) {
    self.postMessage({ id, text: null } satisfies DecodeWorkerResponse);
    return;
  }

  const clamped = new Uint8ClampedArray(buffer);
  const text = decodeSingleQr(decodeQr, clamped, width, height, attemptBoth);

  const response: DecodeWorkerResponse = { id, text };
  self.postMessage(response);
};
