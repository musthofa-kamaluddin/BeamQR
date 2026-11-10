import jsQR from 'jsqr';
import {
  decodeFrameQrs,
  type JsQrDecoderFn,
  type OpticalColorScanMode,
} from '../protocol/qrOptical';

export interface DecodeWorkerRequest {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  attemptBoth: boolean;
  multiScan: boolean;
  colorMode: OpticalColorScanMode;
}

export interface DecodeWorkerResponse {
  id: number;
  texts: string[];
  usedRgb: boolean;
}

const decodeQr: JsQrDecoderFn | undefined =
  typeof jsQR === 'function'
    ? jsQR
    : (jsQR as unknown as { default?: JsQrDecoderFn })?.default ??
      (globalThis as unknown as { jsQR?: JsQrDecoderFn }).jsQR;

self.onmessage = (event: MessageEvent<DecodeWorkerRequest>) => {
  const { id, width, height, buffer, attemptBoth, multiScan, colorMode } = event.data;
  if (!decodeQr) {
    self.postMessage({ id, texts: [], usedRgb: false } satisfies DecodeWorkerResponse);
    return;
  }

  const clamped = new Uint8ClampedArray(buffer);
  const { texts, usedRgb } = decodeFrameQrs(decodeQr, clamped, width, height, {
    multiScan,
    colorMode,
    attemptBoth,
  });

  const response: DecodeWorkerResponse = {
    id,
    texts,
    usedRgb,
  };
  self.postMessage(response);
};
