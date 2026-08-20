import { MarcusError, type JsonValue, type Principal } from "@marcus/contracts";

export const MNP_PROTOCOL_VERSION = 1 as const;
export const MNP_PREFACE = "MNP/1\n" as const;
export const MNP_PREFACE_OK = "MNP/1 OK\n" as const;

export const MnpFrameType = {
  HELLO: 1,
  AUTH: 2,
  AUTH_OK: 3,
  AUTH_ERROR: 4,
  REQUEST: 5,
  RESPONSE: 6,
  ERROR: 7,
  EVENT: 8,
  STREAM_OPEN: 9,
  STREAM_CHUNK: 10,
  STREAM_END: 11,
  UPLOAD_OPEN: 12,
  UPLOAD_CHUNK: 13,
  UPLOAD_COMMIT: 14,
  UPLOAD_ABORT: 15,
  PING: 16,
  PONG: 17,
  CLOSE: 18,
} as const;

export type MnpFrameTypeName = keyof typeof MnpFrameType;
export type MnpFrameTypeCode = (typeof MnpFrameType)[MnpFrameTypeName];

const frameNames = new Map<number, MnpFrameTypeName>(
  Object.entries(MnpFrameType).map(([name, code]) => [code, name as MnpFrameTypeName]),
);

export interface MnpFrame {
  type: MnpFrameTypeName;
  payload: Uint8Array;
}

export interface MnpHello {
  protocolVersion: 1;
  productVersion: string;
  name: string;
  capabilities: readonly string[];
  platform?: string;
  nodeId?: string;
}

export type MnpAuthentication =
  | { method: "username-password"; username: string; password: string }
  | { method: "personal-access-token" | "service-account-token"; token: string }
  | { method: "bootstrap-token"; token: string };

export interface MnpAuthOk {
  sessionId: string;
  principal: Principal;
  permissions: readonly string[];
  expiresAt?: string;
}

export interface MnpRequest<TPayload = unknown> {
  requestId: string;
  operation: string;
  protocolVersion: 1;
  projectId?: string;
  idempotencyKey?: string;
  deadlineAt?: string;
  payload: TPayload;
}

export interface MnpResponse<TData = unknown> {
  requestId: string;
  ok: true;
  data: TData;
  serverTime: string;
}

export interface MnpErrorResponse {
  requestId?: string;
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: JsonValue;
    traceId?: string;
  };
}

export interface MnpEvent<TPayload = unknown> {
  subscriptionId: string;
  eventSeq?: number;
  topic: string;
  timestamp: string;
  payload: TPayload;
}

export interface MnpStreamOpen {
  streamId: string;
  requestId?: string;
  mediaType?: string;
  size?: number;
  sha256?: string;
  sensitive?: boolean;
}

export interface MnpChunkHeader {
  streamId: string;
  offset: number;
  length: number;
  sha256?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class MnpFrameCodec {
  readonly maxPayloadBytes: number;

  constructor(options: { maxPayloadBytes?: number } = {}) {
    this.maxPayloadBytes = options.maxPayloadBytes ?? 1024 * 1024;
  }

  encodeJson(type: MnpFrameTypeName, payload: unknown): Uint8Array {
    return this.encode(type, textEncoder.encode(JSON.stringify(payload)));
  }

  encode(type: MnpFrameTypeName, payload: Uint8Array): Uint8Array {
    if (payload.byteLength > this.maxPayloadBytes) {
      throw protocolError("PROTOCOL_FRAME_TOO_LARGE", `Frame is ${payload.byteLength} bytes; maximum is ${this.maxPayloadBytes}`);
    }
    const output = new Uint8Array(5 + payload.byteLength);
    new DataView(output.buffer).setUint32(0, payload.byteLength, false);
    output[4] = MnpFrameType[type];
    output.set(payload, 5);
    return output;
  }

  decodeJson<T>(frame: MnpFrame): T {
    if (frame.type === "STREAM_CHUNK" || frame.type === "UPLOAD_CHUNK") {
      throw protocolError("PROTOCOL_BINARY_FRAME", `${frame.type} is a binary frame`);
    }
    try {
      return JSON.parse(textDecoder.decode(frame.payload)) as T;
    } catch (error) {
      throw protocolError(
        "PROTOCOL_JSON_INVALID",
        `Invalid JSON in ${frame.type} frame: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export class MnpFrameDecoder {
  readonly maxPayloadBytes: number;
  private buffer = new Uint8Array(0);

  constructor(options: { maxPayloadBytes?: number } = {}) {
    this.maxPayloadBytes = options.maxPayloadBytes ?? 1024 * 1024;
  }

  push(chunk: Uint8Array): MnpFrame[] {
    if (chunk.byteLength === 0) return [];
    const next = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    next.set(this.buffer);
    next.set(chunk, this.buffer.byteLength);
    this.buffer = next;

    const frames: MnpFrame[] = [];
    let offset = 0;
    while (this.buffer.byteLength - offset >= 5) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 5);
      const payloadLength = view.getUint32(0, false);
      if (payloadLength > this.maxPayloadBytes) {
        this.buffer = new Uint8Array(0);
        throw protocolError(
          "PROTOCOL_FRAME_TOO_LARGE",
          `Peer declared ${payloadLength} bytes; maximum is ${this.maxPayloadBytes}`,
        );
      }
      const totalLength = 5 + payloadLength;
      if (this.buffer.byteLength - offset < totalLength) break;
      const typeCode = view.getUint8(4);
      const type = frameNames.get(typeCode);
      if (type === undefined) {
        this.buffer = new Uint8Array(0);
        throw protocolError("PROTOCOL_FRAME_TYPE_UNKNOWN", `Unknown MNP frame type ${typeCode}`);
      }
      frames.push({ type, payload: this.buffer.slice(offset + 5, offset + totalLength) });
      offset += totalLength;
    }

    if (offset > 0) this.buffer = this.buffer.slice(offset);
    return frames;
  }

  get pendingBytes(): number {
    return this.buffer.byteLength;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

export function encodeChunk(header: MnpChunkHeader, bytes: Uint8Array): Uint8Array {
  if (header.length !== bytes.byteLength) {
    throw protocolError("PROTOCOL_CHUNK_LENGTH_MISMATCH", "Chunk header length does not match payload");
  }
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  if (headerBytes.byteLength > 65_535) {
    throw protocolError("PROTOCOL_CHUNK_HEADER_TOO_LARGE", "Chunk header exceeds 65535 bytes");
  }
  const output = new Uint8Array(2 + headerBytes.byteLength + bytes.byteLength);
  new DataView(output.buffer).setUint16(0, headerBytes.byteLength, false);
  output.set(headerBytes, 2);
  output.set(bytes, 2 + headerBytes.byteLength);
  return output;
}

export function decodeChunk(payload: Uint8Array): { header: MnpChunkHeader; bytes: Uint8Array } {
  if (payload.byteLength < 2) throw protocolError("PROTOCOL_CHUNK_INVALID", "Chunk frame is truncated");
  const headerLength = new DataView(payload.buffer, payload.byteOffset, 2).getUint16(0, false);
  if (payload.byteLength < 2 + headerLength) {
    throw protocolError("PROTOCOL_CHUNK_INVALID", "Chunk header is truncated");
  }
  let header: MnpChunkHeader;
  try {
    header = JSON.parse(textDecoder.decode(payload.slice(2, 2 + headerLength))) as MnpChunkHeader;
  } catch {
    throw protocolError("PROTOCOL_CHUNK_INVALID", "Chunk header is not valid JSON");
  }
  const bytes = payload.slice(2 + headerLength);
  if (header.length !== bytes.byteLength || !Number.isSafeInteger(header.offset) || header.offset < 0) {
    throw protocolError("PROTOCOL_CHUNK_INVALID", "Chunk metadata does not match bytes");
  }
  return { header, bytes };
}

export function parsePreface(value: Uint8Array): "request" | "response" {
  const text = textDecoder.decode(value);
  if (text === MNP_PREFACE) return "request";
  if (text === MNP_PREFACE_OK) return "response";
  throw protocolError("PROTOCOL_PREFACE_INVALID", "Expected MNP/1 preface");
}

function protocolError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
