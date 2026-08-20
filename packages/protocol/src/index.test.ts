import { describe, expect, test } from "bun:test";
import {
  MNP_PREFACE,
  MnpFrameCodec,
  MnpFrameDecoder,
  decodeChunk,
  encodeChunk,
  parsePreface,
} from "./index";

describe("MNP/1 frame codec", () => {
  test("decodes fragmented and multiplexed frames", () => {
    const codec = new MnpFrameCodec();
    const decoder = new MnpFrameDecoder();
    const first = codec.encodeJson("PING", { sequence: 1 });
    const second = codec.encodeJson("REQUEST", { requestId: "req-1" });
    const wire = new Uint8Array(first.length + second.length);
    wire.set(first);
    wire.set(second, first.length);

    expect(decoder.push(wire.slice(0, 3))).toEqual([]);
    expect(decoder.pendingBytes).toBe(3);
    const frames = decoder.push(wire.slice(3));

    expect(frames.map((frame) => frame.type)).toEqual(["PING", "REQUEST"]);
    expect(codec.decodeJson<{ sequence: number }>(frames[0]!)).toEqual({ sequence: 1 });
    expect(codec.decodeJson<{ requestId: string }>(frames[1]!)).toEqual({ requestId: "req-1" });
  });

  test("rejects declared payload before waiting for allocation", () => {
    const decoder = new MnpFrameDecoder({ maxPayloadBytes: 4 });
    const header = new Uint8Array(5);
    new DataView(header.buffer).setUint32(0, 5, false);
    header[4] = 1;
    expect(() => decoder.push(header)).toThrow("Peer declared 5 bytes");
  });
});

test("binary chunk envelope preserves offset and bytes", () => {
  const bytes = new TextEncoder().encode("payload");
  const payload = encodeChunk({ streamId: "stream-1", offset: 7, length: bytes.length }, bytes);
  const decoded = decodeChunk(payload);
  expect(decoded.header).toEqual({ streamId: "stream-1", offset: 7, length: 7 });
  expect(new TextDecoder().decode(decoded.bytes)).toBe("payload");
});

test("recognizes protocol preface", () => {
  expect(parsePreface(new TextEncoder().encode(MNP_PREFACE))).toBe("request");
  expect(() => parsePreface(new TextEncoder().encode("HTTP/1.1"))).toThrow("Expected MNP/1 preface");
});
